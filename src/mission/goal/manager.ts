/**
 * [Goal 管理器]
 *
 * 职责:
 *   - 管理会话级目标(Goal)的生命周期
 *   - 提供 Goal 的创建、暂停、恢复、清除功能
 *   - 管理 Token 预算和消耗统计
 *   - 生成续接提示词(Continuation Prompt)
 *   - 持久化 Goal 状态到磁盘
 *
 * 模块功能:
 *   - createGoal: 创建新目标
 *   - pauseGoal: 暂停目标
 *   - resumeGoal: 恢复目标
 *   - clearGoal: 清除目标
 *   - modelUpdateGoal: 模型标记目标完成状态
 *   - accrueTokens: 累计 Token 使用量
 *   - markPendingContinuation: 标记需要续接
 *   - consumePendingContinuation: 消费续接标记并返回提示词
 *   - migrateGoalToSession: 迁移 Goal 到新会话
 *   - resumeGoalForSession: 跨会话恢复 Goal
 *   - loadGoal/loadAllGoals: 加载 Goal
 *   - formatSummary: 格式化 Goal 摘要
 *
 * 使用场景:
 *   - 用户通过 /goal 命令管理目标
 *   - AI 在 pursuing 状态下自动续接执行
 *   - Token 预算耗尽时优雅收尾
 *   - 会话压缩后迁移 Goal 到新会话
 *
 * 边界:
 *   1. 每个会话同时只能有一个 pursuing 或 paused 的 Goal
 *   2. Goal 状态转换需符合状态机规则
 *   3. Token 预算耗尽自动转为 budget-limited 状态
 *   4. 持久化路径为 .crab/goals/<sessionId>.json
 *
 * 流程:
 *   1. 创建 Goal: createGoal → 持久化 → 发布事件
 *   2. 续接执行: markPendingContinuation → consumePendingContinuation → 注入提示词
 *   3. 完成标记: modelUpdateGoal → 更新状态 → 持久化
 *   4. Token 管理: accrueTokens → 检查预算 → 状态转换
 */

import fs from "node:fs";
import path from "node:path";
import { shortUuid } from "@/core/id";
import { createLogger } from "@/core/logging/logger";
import { globalBus, type EventBus } from "@/bus/core/eventBus";
import { TaskEvents } from "@/bus/events/taskEvents";
import type { GoalCreateOptions, GoalRecord, GoalStatusUpdate } from "../types";
import { DEFAULT_GOAL_TOKEN_BUDGET } from "../types";
import { createInternalError } from "@/core/errors/appError";
import { safeUnlinkSync } from "@/core/utilities";

const log = createLogger("task:goal");

/** Goal 持久化目录名 */
const GOALS_DIR_NAME = "goals";

// ─── 续接提示词 ──────────────────────────────────────────────

/**
 * 构建续接提示词。
 * 完整版:包含 TODOLIST DISCIPLINE 段落，要求 AI 每轮自动维护任务清单。
 */
function buildContinuationPrompt(goal: GoalRecord): string {
  const budget = goal.tokenBudget ?? DEFAULT_GOAL_TOKEN_BUDGET;
  const remaining = budget - goal.tokensUsed;
  return [
    "[GOAL CONTINUATION]",
    `Active goal (id=${goal.id}, run #${goal.runCount + 1}):`,
    `"${goal.objective}"`,
    "",
    "MANDATORY — TODOLIST DISCIPLINE (basic requirement of goal mode):",
    "- Maintain a COMPLETE, up-to-date todolist for this goal using the `todo` tool.",
    '- FIRST action every turn: call `todo` with action="list" to inspect the current list. If empty or stale, immediately decompose the objective into concrete actionable items via action="add" (batch the full plan in one call).',
    '- Update item status IMMEDIATELY after each step is verified: action="update" with status="in_progress" when you start and status="completed" when you finish — do NOT batch-update at the end of the turn.',
    '- Delete obsolete or superseded items via action="delete" so the list stays focused; refine wording via action="update" content when scope clarifies.',
    "- The todolist must remain a faithful mirror of progress toward the objective: every remaining deliverable has an item, every completed deliverable is marked completed.",
    "",
    "Instructions for this turn:",
    "1. Sync the todolist first (see TODOLIST DISCIPLINE above) before doing any other work.",
    "2. Restate the objective as concrete, testable deliverables (and reflect them as todolist items).",
    "3. Build an audit checklist mapping each requirement to verification evidence.",
    '4. Inspect actual files, outputs, and test results — DO NOT infer from proxy signals (e.g. "tests pass" alone is not proof).',
    `5. If the audit confirms the objective is fully achieved, ensure every todolist item is marked completed, then call \`goal\` tool with action="complete" and status="achieved" and a short explanation.`,
    `6. If the goal cannot be achieved (blocked, requires user input, contradictory requirements), record the blocker as a todolist item and call \`goal\` tool with action="complete" and status="unmet" and explain why.`,
    "7. Otherwise, execute the next concrete step toward the objective (updating todolist status as you go) and the loop will re-prompt you next turn.",
    "",
    `Token budget: ~${remaining} tokens remaining (used ${goal.tokensUsed} / ${budget}). Prefer small, verifiable steps.`,
    "",
    `CRITICAL: Do not declare completion by chat text alone. The loop only stops when you call \`goal\` with action="complete". A stale or missing todolist is itself a violation of goal-mode requirements.`,
  ].join("\n");
}

/**
 * 预算耗尽提示词。
 * 要求模型优雅收尾:不开启新任务、同步 todolist、总结进展。
 */
function buildBudgetLimitPrompt(goal: GoalRecord): string {
  return [
    "[GOAL BUDGET LIMIT REACHED]",
    `Active goal (id=${goal.id}): "${goal.objective}"`,
    `Token budget exhausted: ${goal.tokensUsed} / ${goal.tokenBudget}.`,
    "",
    "This is your FINAL turn for this goal. You MUST:",
    "1. NOT start any new substantive work.",
    `2. Sync the todolist via \`todo\` to its final state: mark completed items as "completed", leave remaining items as "pending" with clear wording so a human or new session can pick them up. Do NOT delete unfinished items.`,
    "3. Summarize useful progress made so far.",
    "4. Identify remaining work and any blockers (these should also appear as pending todolist items).",
    "5. Provide a clear next step (file, function, command) that a human or new session can pick up.",
    `6. DO NOT falsely call \`goal\` with action="complete" and status="achieved" just because the budget is exhausted. Only mark "achieved" if the audit truly confirms completion.`,
    "",
    'After this turn, the goal will automatically remain in "budget-limited" state. The user can clear it or raise the budget and resume.',
  ].join("\n");
}

// ─── Goal Manager ────────────────────────────────────────────

/** 运行时校验 JSON 解析结果是否符合 GoalRecord 基本结构 */
function isValidGoalRecord(obj: unknown): obj is GoalRecord {
  if (typeof obj !== "object" || obj === null) return false;
  const r = obj as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.sessionId === "string" &&
    typeof r.objective === "string" &&
    typeof r.status === "string" &&
    typeof r.createdAt === "number"
  );
}

/**
 * Goal 管理器(单例模式)。
 *
 * 状态机:
 *   none → pursuing (创建)
 *   pursuing → paused / achieved / unmet / budget-limited
 *   paused → pursuing (resume)
 *   * → none (clear)
 */
export class GoalManager {
  private cache = new Map<string, GoalRecord>();
  private listeners = new Set<(goal: GoalRecord | null) => void>();
  private projectDir: string | null = null;
  private readonly eventBus?: EventBus;

  constructor(eventBus?: EventBus) {
    this.eventBus = eventBus;
  }

  private getEventBus(): EventBus {
    return this.eventBus ?? globalBus;
  }

  /** 设置项目目录(用于持久化) */
  setProjectDir(dir: string): void {
    this.projectDir = dir;
  }

  // ─── 目录与路径 ────────────────────────────────────────────

  private getGoalDir(): string {
    return path.join(this.projectDir ?? process.cwd(), ".crab", GOALS_DIR_NAME);
  }

  private getGoalPath(sessionId: string): string {
    return path.join(this.getGoalDir(), `${sessionId}.json`);
  }

  private ensureDir(): void {
    const dir = this.getGoalDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // ─── 监听器 ────────────────────────────────────────────────

  subscribe(cb: (goal: GoalRecord | null) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private notify(goal: GoalRecord | null): void {
    for (const cb of this.listeners) {
      try {
        cb(goal);
      } catch {
        /* 忽略监听器异常 */
      }
    }
  }

  // ─── 持久化 ────────────────────────────────────────────────

  private persist(goal: GoalRecord): void {
    try {
      this.ensureDir();
      const goalPath = this.getGoalPath(goal.sessionId);
      fs.writeFileSync(goalPath, JSON.stringify(goal, null, 2), "utf8");
      this.cache.set(goal.sessionId, goal);
      this.notify(goal);
      log.debug(`Goal 持久化: ${goal.id} → ${goal.status}`);
    } catch (error) {
      log.error(`Goal 持久化失败 ${goal.id}: ${error instanceof Error ? error.message : String(error)}`);
      // 即使持久化失败，仍保持内存缓存一致
      this.cache.set(goal.sessionId, goal);
      this.notify(goal);
    }
  }

  // ─── 加载 ──────────────────────────────────────────────────

  /** 加载指定会话的 Goal */
  loadGoal(sessionId: string): GoalRecord | null {
    if (this.cache.has(sessionId)) {
      return this.cache.get(sessionId)!;
    }
    try {
      const goalPath = this.getGoalPath(sessionId);
      if (fs.existsSync(goalPath)) {
        const content = fs.readFileSync(goalPath, "utf8");
        const parsed = JSON.parse(content);
        if (isValidGoalRecord(parsed) && parsed.sessionId === sessionId) {
          this.cache.set(sessionId, parsed);
          return parsed;
        }
      }
    } catch {
      /* 文件不存在或损坏 */
    }
    return null;
  }

  /** 加载所有 Goal(扫描 .crab/goals/ 目录) */
  loadAllGoals(): GoalRecord[] {
    const goals: GoalRecord[] = [];
    const dir = this.getGoalDir();
    try {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
        for (const file of files) {
          try {
            const content = fs.readFileSync(path.join(dir, file), "utf8");
            const parsed = JSON.parse(content);
            if (isValidGoalRecord(parsed)) {
              goals.push(parsed);
            }
          } catch {
            /* 跳过损坏文件 */
          }
        }
      }
    } catch {
      /* 目录不存在 */
    }

    // 也加入缓存中的(可能还没有落盘的)
    for (const [, goal] of this.cache) {
      if (!goals.find((g) => g.id === goal.id)) {
        goals.push(goal);
      }
    }

    return goals.toSorted((a, b) => b.createdAt - a.createdAt);
  }

  // ─── CRUD ─────────────────────────────────────────────────

  /** 创建新目标 */
  createGoal(options: GoalCreateOptions): GoalRecord {
    const existing = this.loadGoal(options.sessionId);
    if (existing && existing.status === "pursuing") {
      throw createInternalError("INTERNAL_ERROR", `已有活跃目标 (id=${existing.id})。请先使用 /goal clear。`);
    }
    if (existing && existing.status === "paused") {
      throw createInternalError(
        "INTERNAL_ERROR",
        `已有暂停目标 (id=${existing.id})。请先使用 /goal resume 或 /goal clear。`,
      );
    }

    const objective = options.objective.trim();
    if (!objective) {
      throw createInternalError("INTERNAL_ERROR", "目标描述不能为空。");
    }

    const now = Date.now();
    const goal: GoalRecord = {
      createdAt: now,
      id: shortUuid().slice(0, 8),
      objective,
      pendingContinuation: true,
      runCount: 0,
      sessionId: options.sessionId,
      status: "pursuing",
      tokenBudget: options.tokenBudget ?? DEFAULT_GOAL_TOKEN_BUDGET,
      tokensUsed: 0,
      updatedAt: now,
    };

    this.persist(goal);

    this.getEventBus().publish(TaskEvents.GoalStatusChanged, {
      id: goal.id,
      sessionId: goal.sessionId,
      status: goal.status,
    });

    log.info(`Goal 已创建: ${goal.id} - ${objective}`);
    return goal;
  }

  /** 暂停目标 */
  pauseGoal(sessionId: string): GoalRecord | null {
    const goal = this.loadGoal(sessionId);
    if (!goal || goal.status !== "pursuing") {
      return goal;
    }
    goal.status = "paused";
    goal.updatedAt = Date.now();
    goal.pendingContinuation = false;
    this.persist(goal);

    this.getEventBus().publish(TaskEvents.GoalStatusChanged, {
      id: goal.id,
      sessionId: goal.sessionId,
      status: goal.status,
    });

    return goal;
  }

  /** 恢复目标 */
  resumeGoal(sessionId: string): GoalRecord | null {
    const goal = this.loadGoal(sessionId);
    if (!goal) {
      return null;
    }
    if (goal.status !== "paused" && goal.status !== "budget-limited") {
      return goal;
    }
    goal.status = "pursuing";
    goal.updatedAt = Date.now();
    goal.pendingContinuation = true;
    this.persist(goal);

    this.getEventBus().publish(TaskEvents.GoalStatusChanged, {
      id: goal.id,
      sessionId: goal.sessionId,
      status: goal.status,
    });

    return goal;
  }

  /** 清除目标 */
  clearGoal(sessionId: string): GoalRecord | null {
    const goal = this.loadGoal(sessionId);
    if (!goal) {
      return null;
    }

    // 先清除缓存，确保后续 loadGoal 不会命中缓存
    this.cache.delete(sessionId);

    // 删除持久化文件（降级策略: unlink → 覆盖空内容）
    const goalPath = this.getGoalPath(sessionId);
    safeUnlinkSync(goalPath);

    this.notify(null);

    this.getEventBus().publish(TaskEvents.GoalStatusChanged, {
      id: goal.id,
      sessionId: goal.sessionId,
      status: "cleared",
    });

    return goal;
  }

  /** 模型通过工具调用标记完成(仅 pursuing → achieved/unmet) */
  modelUpdateGoal(sessionId: string, update: GoalStatusUpdate): GoalRecord | null {
    const goal = this.loadGoal(sessionId);
    if (!goal) {
      return null;
    }
    if (goal.status !== "pursuing") {
      throw createInternalError(
        "INTERNAL_ERROR",
        `无法更新目标: 状态为 ${goal.status}，只有 "pursuing" 可被标记完成。`,
      );
    }

    goal.status = update.status;
    goal.updatedAt = Date.now();
    goal.pendingContinuation = false;
    if (update.explanation) {
      goal.lastExplanation = update.explanation;
    }
    this.persist(goal);

    this.getEventBus().publish(TaskEvents.GoalStatusChanged, {
      id: goal.id,
      sessionId: goal.sessionId,
      status: goal.status,
    });

    return goal;
  }

  // ─── Token 预算管理 ────────────────────────────────────────

  /** 累计 Token 使用量；超出预算自动转为 budget-limited */
  accrueTokens(
    sessionId: string,
    deltaTokens: number,
  ): {
    exceeded: boolean;
    goal: GoalRecord | null;
  } {
    const goal = this.loadGoal(sessionId);
    if (!goal || goal.status !== "pursuing" || deltaTokens <= 0) {
      return { exceeded: false, goal };
    }

    goal.tokensUsed += deltaTokens;
    goal.updatedAt = Date.now();
    const budget = goal.tokenBudget ?? DEFAULT_GOAL_TOKEN_BUDGET;
    const exceeded = goal.tokensUsed >= budget;
    if (exceeded) {
      goal.status = "budget-limited";
      goal.pendingContinuation = true;
    }
    this.persist(goal);
    return { exceeded, goal };
  }

  // ─── 续接管理 ──────────────────────────────────────────────

  /** 标记下一轮需要续接 */
  markPendingContinuation(sessionId: string): GoalRecord | null {
    const goal = this.loadGoal(sessionId);
    if (!goal || goal.status !== "pursuing") {
      return goal;
    }
    goal.runCount += 1;
    goal.pendingContinuation = true;
    goal.updatedAt = Date.now();
    this.persist(goal);
    return goal;
  }

  /** 消费续接标记，返回应注入的提示词 */
  consumePendingContinuation(sessionId: string): string | null {
    const goal = this.loadGoal(sessionId);
    if (!goal || !goal.pendingContinuation) {
      return null;
    }

    if (goal.status === "pursuing") {
      goal.pendingContinuation = false;
      goal.updatedAt = Date.now();
      this.persist(goal);
      return buildContinuationPrompt(goal);
    }

    if (goal.status === "budget-limited") {
      goal.pendingContinuation = false;
      goal.updatedAt = Date.now();
      this.persist(goal);
      return buildBudgetLimitPrompt(goal);
    }

    // Paused / achieved / unmet 不续接
    goal.pendingContinuation = false;
    this.persist(goal);
    return null;
  }

  // ─── 会话迁移 ──────────────────────────────────────────────

  /**
   * 将 Goal 从旧会话迁移到新会话(压缩后调用)。
   * 保留目标状态，仅更新 sessionId 关联。
   */
  migrateGoalToSession(oldSessionId: string, newSessionId: string): GoalRecord | null {
    const goal = this.loadGoal(oldSessionId);
    if (!goal) {
      return null;
    }
    // 只迁移活跃或暂停的 Goal
    if (goal.status !== "pursuing" && goal.status !== "paused" && goal.status !== "budget-limited") {
      return null;
    }

    // 删除旧文件
    this.cache.delete(oldSessionId);
    const oldPath = this.getGoalPath(oldSessionId);
    safeUnlinkSync(oldPath);

    // 更新关联
    goal.sessionId = newSessionId;
    goal.updatedAt = Date.now();
    this.cache.set(newSessionId, goal);
    this.persist(goal);

    this.getEventBus().publish(TaskEvents.GoalStatusChanged, {
      id: goal.id,
      sessionId: newSessionId,
      status: goal.status,
    });

    log.info(`Goal 迁移: ${goal.id} 从 ${oldSessionId} → ${newSessionId}`);
    return goal;
  }

  /**
   * 跨会话恢复 Goal(按 goalId 查找并关联到新会话)。
   */
  resumeGoalForSession(goalId: string, newSessionId: string): GoalRecord | null {
    const allGoals = this.loadAllGoals();
    const goal = allGoals.find((g) => g.id === goalId);
    if (!goal) {
      return null;
    }
    if (goal.status === "pursuing" && goal.sessionId === newSessionId) {
      return goal;
    }
    if (goal.status !== "paused" && goal.status !== "budget-limited" && goal.status !== "pursuing") {
      return goal;
    }

    const migrated = goal.sessionId === newSessionId ? goal : this.migrateGoalToSession(goal.sessionId, newSessionId);
    if (!migrated) {
      return null;
    }

    if (migrated.status === "paused" || migrated.status === "budget-limited") {
      return this.resumeGoal(newSessionId);
    }
    return migrated;
  }

  // ─── 展示 ─────────────────────────────────────────────────

  /** 格式化 Goal 摘要(用于状态栏/命令面板) */
  formatSummary(goal: GoalRecord): string {
    const budget = goal.tokenBudget ?? DEFAULT_GOAL_TOKEN_BUDGET;
    const usedPct = budget > 0 ? Math.min(100, (goal.tokensUsed / budget) * 100) : 0;
    const lines = [
      `id: ${goal.id}`,
      `status: ${goal.status}`,
      `objective: ${goal.objective}`,
      `runs: ${goal.runCount}`,
      `tokens: ${goal.tokensUsed} / ${budget} (${usedPct.toFixed(1)}%)`,
    ];
    if (goal.lastExplanation) {
      lines.push(`explanation: ${goal.lastExplanation}`);
    }
    return lines.join("\n");
  }
}

/** 全局 Goal 管理器实例 */
export const goalManager = new GoalManager();
