/**
 * [Team 状态追踪器]
 *
 * 职责:
 *   - 追踪队友状态变化
 *   - 管理消息路由(队友 ↔ Lead)
 *   - 处理 Plan Approval 请求
 *   - 实现 Standby 等待机制
 *   - 管理队友生命周期
 *
 * 模块功能:
 *   - register/unregister:队友注册/注销
 *   - updateStatus:更新队友状态
 *   - sendMessageToLead:队友发送消息给 Lead
 *   - sendMessageToTeammate:发送消息给指定队友
 *   - broadcastToTeammates:广播消息给所有队友
 *   - requestPlanApproval:请求计划审批
 *   - resolvePlanApproval:审批/拒绝计划
 *   - setStandby/clearStandby:Standby 状态管理
 *   - waitForAllTeammates:等待所有队友进入 Standby
 *   - createAbortController:创建中止控制器
 *   - abortAllTeammates:中止所有队友
 *
 * 使用场景:
 *   - TeamExecutor 管理队友状态
 *   - 队友间消息通信
 *   - Plan Approval 工作流
 *   - 会话回滚时清理状态
 *
 * 边界:
 *   1. 内存存储，非持久化
 *   2. 需要配合 TeamExecutor 使用
 *   3. 消息队列在内存中，重启丢失
 *   4. AbortController 需外部触发
 *
 * 流程:
 *   1. 注册队友到 tracker
 *   2. 更新状态并发布事件
 *   3. 处理消息路由(入队/出队)
 *   4. 管理 Plan Approval 请求
 *   5. 等待 Standby 状态完成
 *   6. 清理时注销所有队友
 */
import type { TeamConfig, Teammate, TeammateStatus } from "../types";
import type { TeamSnapshot } from "../types";
import { globalBus, type EventBus } from "@/bus/core/eventBus";
import { TeamEvents } from "@/bus/events/teamEvents";
import { createLogger } from "@/core/logging/logger";
import { loadStateSnapshot, saveStateSnapshot } from "../persist/teamStateSnapshot";

const log = createLogger("team:tracker");

// ─── Plan Approval token 协议 ─────────────────────────────────

/** 结构化 plan approval token:lead 端可解析识别，避免误把"Plan Approval Request"当作普通文本。 */
export const PLAN_APPROVAL_TOKEN_PREFIX = "[CRAB_PLAN_APPROVAL_REQUEST v1]";
export const PLAN_APPROVAL_TOKEN_POSTFIX = "[CRAB_PLAN_APPROVAL_END]";

/** 构造可被 parsePlanApprovalMessage 还原的结构化 plan approval 消息 */
export function wrapPlanApprovalMessage(plan: string): string {
  return `${PLAN_APPROVAL_TOKEN_PREFIX}\n${plan}\n${PLAN_APPROVAL_TOKEN_POSTFIX}`;
}

/** 解析 plan approval 消息:返回 plan 内容(已剥离 token)，未匹配则返回 null。 */
export function parsePlanApprovalMessage(content: string): string | null {
  if (typeof content !== "string") {
    return null;
  }
  const startIdx = content.indexOf(PLAN_APPROVAL_TOKEN_PREFIX);
  if (startIdx === -1) {
    return null;
  }
  const afterPrefix = startIdx + PLAN_APPROVAL_TOKEN_PREFIX.length;
  const endIdx = content.indexOf(PLAN_APPROVAL_TOKEN_POSTFIX, afterPrefix);
  if (endIdx === -1) {
    return null;
  }
  return content.slice(afterPrefix, endIdx).replace(/^\n+|\n+$/g, "");
}

// ─── 消息类型 ────────────────────────────────────────────────

/** 队友消息 */
export interface TeammateMessage {
  fromId: string;
  fromName: string;
  content: string;
  sentAt: number;
}

/** Plan approval 请求 */
export interface PlanApprovalRequest {
  fromTeammateId: string;
  fromName: string;
  plan: string;
  requestedAt: number;
  status: "pending" | "approved" | "rejected";
  feedback?: string;
}

/** 消息路由事件 */
export interface TeammateMessageEvent {
  fromId: string | "lead";
  fromName: string;
  toId: string | "lead";
  toName: string;
  content: string;
  isBroadcast: boolean;
  sentAt: number;
}

// ─── Team 状态追踪器 ──────────────────────────────────────────

type Listener = () => void;
type MessageListener = (event: TeammateMessageEvent) => void;

/** Team 状态追踪器 */
export class TeamTracker {
  private teammates = new Map<string, Teammate>();
  private readonly eventBus?: EventBus;

  /** 消息队列:teammate → lead */
  private leadMessageQueue: TeammateMessage[] = [];

  /** 消息队列:lead/teammate → teammate */
  private teammateMessageQueues = new Map<string, TeammateMessage[]>();

  /** 已完成队友的结果 */
  private completedResults: {
    teammateId: string;
    name: string;
    success: boolean;
    result: string;
    error?: string;
    completedAt: number;
  }[] = [];

  /** Plan approval 请求队列 */
  private planApprovals: PlanApprovalRequest[] = [];

  /** 队友 AbortController */
  private abortControllers = new Map<string, AbortController>();

  /** Standby 状态(wait_for_messages 后进入) */
  private standbySet = new Set<string>();

  /** 队友当前任务 ID */
  private currentTaskIds = new Map<string, string>();

  /** 活跃 team 名称 */
  private activeTeamName: string | null = null;

  /** 变更监听器 */
  private listeners = new Set<Listener>();

  /** 消息路由事件监听器 */
  private messageListeners = new Set<MessageListener>();

  constructor(eventBus?: EventBus) {
    this.eventBus = eventBus;
  }

  private getEventBus(): EventBus {
    return this.eventBus ?? globalBus;
  }

  // ─── Team 生命周期 ─────────────────────────────────────────

  setActiveTeam(teamName: string): void {
    this.activeTeamName = teamName;
  }

  getActiveTeamName(): string | null {
    return this.activeTeamName;
  }

  clearActiveTeam(): void {
    this.activeTeamName = null;
    this.clear();
  }

  // ─── 队友注册 ──────────────────────────────────────────────

  /** 注册队友 */
  register(teammate: Teammate): void {
    this.teammates.set(teammate.id, teammate);
    this.teammateMessageQueues.set(teammate.id, []);
    log.info(`队友已注册: ${teammate.id} (${teammate.name})`);
  }

  /** 注销队友 */
  unregister(teammateId: string): void {
    if (this.teammates.delete(teammateId)) {
      this.teammateMessageQueues.delete(teammateId);
      this.abortControllers.delete(teammateId);
      this.standbySet.delete(teammateId);
      this.notifyListeners();
    }
  }

  /** 更新队友状态 */
  updateStatus(teammateId: string, status: TeammateStatus, extra?: Partial<Teammate>): boolean {
    const mate = this.teammates.get(teammateId);
    if (!mate) {
      log.warn(`队友不存在: ${teammateId}`);
      return false;
    }

    const oldStatus = mate.status;
    mate.status = status;

    if (extra) {
      Object.assign(mate, extra);
    }

    if (status === "running" && !mate.startedAt) {
      mate.startedAt = Date.now();
    }
    if ((status === "completed" || status === "failed") && !mate.completedAt) {
      mate.completedAt = Date.now();
    }

    log.info(`队友 ${teammateId} 状态: ${oldStatus} → ${status}`);

    // 发布状态变更事件
    this.getEventBus().publish(TeamEvents.TeamMateStatusChanged, {
      error: mate.error,
      name: mate.name,
      newStatus: status,
      oldStatus,
      result: mate.result,
      teammateId,
    });

    this.notifyListeners();
    return true;
  }

  /** 获取队友信息 */
  get(teammateId: string): Teammate | undefined {
    return this.teammates.get(teammateId);
  }

  /** 按名称查找队友 */
  findByName(name: string): Teammate | undefined {
    const lower = name.toLowerCase();
    for (const mate of this.teammates.values()) {
      if (mate.name.toLowerCase() === lower) {
        return mate;
      }
    }
    return undefined;
  }

  /** 列出所有队友 */
  list(): Teammate[] {
    return [...this.teammates.values()];
  }

  /** 按状态过滤 */
  listByStatus(status: TeammateStatus): Teammate[] {
    return this.list().filter((m) => m.status === status);
  }

  /** 移除队友 */
  remove(teammateId: string): boolean {
    this.teammateMessageQueues.delete(teammateId);
    this.abortControllers.delete(teammateId);
    this.standbySet.delete(teammateId);
    return this.teammates.delete(teammateId);
  }

  /** 队友总数 */
  get size(): number {
    return this.teammates.size;
  }

  // ─── AbortController ───────────────────────────────────────

  /** 为队友创建 AbortController */
  createAbortController(teammateId: string, parentSignal?: AbortSignal): AbortController {
    const controller = new AbortController();
    this.abortControllers.set(teammateId, controller);
    if (parentSignal) {
      const onParentAbort = () => controller.abort();
      parentSignal.addEventListener("abort", onParentAbort, { once: true });
    }
    return controller;
  }

  /** 获取队友的 AbortController */
  getAbortController(teammateId: string): AbortController | undefined {
    return this.abortControllers.get(teammateId);
  }

  /** 中止所有队友 */
  abortAllTeammates(): void {
    for (const controller of this.abortControllers.values()) {
      try {
        controller.abort();
      } catch {
        /* Noop */
      }
    }
    this.abortControllers.clear();
  }

  // ─── Standby 机制 ──────────────────────────────────────────

  /** 标记队友进入 standby */
  setStandby(teammateId: string): void {
    if (this.teammates.has(teammateId)) {
      this.standbySet.add(teammateId);
      this.notifyListeners();
    }
  }

  /** 清除 standby */
  clearStandby(teammateId: string): void {
    if (this.standbySet.delete(teammateId)) {
      this.notifyListeners();
    }
  }

  /** 是否在 standby */
  isOnStandby(teammateId: string): boolean {
    return this.standbySet.has(teammateId);
  }

  /** 所有队友都在 standby(或已完成/失败)，无需再等待 */
  allInStandby(): boolean {
    if (this.teammates.size === 0) {
      return true;
    }
    for (const [id, mate] of this.teammates.entries()) {
      if (mate.status === "completed" || mate.status === "failed") {
        continue;
      }
      if (!this.standbySet.has(id)) {
        return false;
      }
    }
    return true;
  }

  // ─── 消息路由:teammate → lead ─────────────────────────────

  /** 队友发送消息给 lead */
  sendMessageToLead(fromId: string, content: string): boolean {
    const from = this.teammates.get(fromId);
    if (!from) {
      return false;
    }

    this.leadMessageQueue.push({
      content,
      fromId,
      fromName: from.name,
      sentAt: Date.now(),
    });

    this.getEventBus().publish(TeamEvents.TeamMateMessage, {
      from: from.name,
      message: `[→lead] ${content}`,
      teammateId: fromId,
    });

    log.info(`消息 ${from.name} → lead: ${content.slice(0, 60)}`);
    return true;
  }

  /** Lead 消费来自队友的消息 */
  dequeueLeadMessages(): TeammateMessage[] {
    if (this.leadMessageQueue.length === 0) {
      return [];
    }
    const messages = [...this.leadMessageQueue];
    this.leadMessageQueue.length = 0;
    return messages;
  }

  // ─── 消息路由:lead/teammate → teammate ────────────────────

  /** 发送消息给指定队友 */
  sendMessageToTeammate(fromId: string | "lead", targetId: string, content: string): boolean {
    const queue = this.teammateMessageQueues.get(targetId);
    if (!queue) {
      return false;
    }

    const from = fromId === "lead" ? null : this.teammates.get(fromId);

    const message: TeammateMessage = {
      content,
      fromId: fromId === "lead" ? "lead" : fromId,
      fromName: from?.name ?? "Team Lead",
      sentAt: Date.now(),
    };
    queue.push(message);

    const target = this.teammates.get(targetId);
    if (target) {
      this.getEventBus().publish(TeamEvents.TeamMateMessage, {
        from: from?.name ?? "lead",
        message: `[${from?.name ?? "lead"} → ${target.name}] ${content}`,
        teammateId: targetId,
      });
    }

    log.info(`消息 ${from?.name ?? "lead"} → ${target?.name ?? targetId}: ${content.slice(0, 60)}`);
    return true;
  }

  /** 队友消费自己的消息队列 */
  dequeueTeammateMessages(teammateId: string): TeammateMessage[] {
    const queue = this.teammateMessageQueues.get(teammateId);
    if (!queue || queue.length === 0) {
      return [];
    }
    const messages = [...queue];
    queue.length = 0;
    return messages;
  }

  /** 查看队友是否有待处理消息(不消费队列) */
  hasPendingTeammateMessages(teammateId: string): boolean {
    const queue = this.teammateMessageQueues.get(teammateId);
    return Boolean(queue) && Boolean(queue!.length > 0);
  }

  /** 广播给所有队友 */
  broadcastToTeammates(fromId: string | "lead", content: string): number {
    let count = 0;
    for (const id of this.teammates.keys()) {
      if (id !== fromId) {
        this.sendMessageToTeammate(fromId, id, content);
        count++;
      }
    }
    return count;
  }

  // ─── 已完成结果 ─────────────────────────────────────────────

  /** 存储队友完成结果 */
  storeResult(result: { teammateId: string; name: string; success: boolean; result: string; error?: string }): void {
    this.completedResults.push({ ...result, completedAt: Date.now() });
    this.notifyListeners();
  }

  /** 消费所有完成结果 */
  drainResults(): typeof this.completedResults {
    if (this.completedResults.length === 0) {
      return [];
    }
    const results = [...this.completedResults];
    this.completedResults.length = 0;
    return results;
  }

  /** 是否有待消费结果 */
  hasResults(): boolean {
    return this.completedResults.length > 0;
  }

  // ─── Plan Approval ─────────────────────────────────────────

  /** 请求 plan approval */
  requestPlanApproval(fromId: string, plan: string): boolean {
    const from = this.teammates.get(fromId);
    if (!from) {
      return false;
    }

    this.planApprovals.push({
      fromName: from.name,
      fromTeammateId: fromId,
      plan,
      requestedAt: Date.now(),
      status: "pending",
    });

    // 通知 lead(使用结构化 token，便于 lead 端解析识别)
    this.sendMessageToLead(fromId, wrapPlanApprovalMessage(plan));
    return true;
  }

  /** 获取待审批的 plan */
  getPendingApprovals(): PlanApprovalRequest[] {
    return this.planApprovals.filter((a) => a.status === "pending");
  }

  /** 获取某个队友最近一次 plan approval 状态 */
  getLatestPlanApprovalStatus(fromId: string): PlanApprovalRequest["status"] | null {
    for (let i = this.planApprovals.length - 1; i >= 0; i--) {
      const approval = this.planApprovals[i];
      if (approval?.fromTeammateId === fromId) {
        return approval.status;
      }
    }
    return null;
  }

  /** 审批/拒绝 plan */
  resolvePlanApproval(fromId: string, approved: boolean, feedback?: string): boolean {
    const approval = this.planApprovals.find((a) => a.fromTeammateId === fromId && a.status === "pending");
    if (!approval) {
      return false;
    }

    approval.status = approved ? "approved" : "rejected";
    approval.feedback = feedback;

    const content = approved
      ? `你的计划已批准。${feedback ? ` 反馈: ${feedback}` : ""}`
      : `你的计划被拒绝。${feedback ? ` 反馈: ${feedback}` : " 请修改后重新提交。"}`;

    this.sendMessageToTeammate("lead", fromId, content);
    return true;
  }

  // ─── 等待所有队友 ───────────────────────────────────────────

  /** 等待直到所有队友都在 standby 或被注销 */
  async waitForAllTeammates(timeoutMs = 600_000, abortSignal?: AbortSignal): Promise<boolean> {
    if (this.allInStandby()) {
      return true;
    }
    if (abortSignal?.aborted) {
      return false;
    }

    let unsubscribe: (() => void) | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;

    const standbyPromise = new Promise<boolean>((resolve) => {
      unsubscribe = this.subscribe(() => {
        if (this.allInStandby()) {
          resolve(true);
        }
      });
      if (this.allInStandby()) {
        resolve(true);
      }
    });

    const timeoutPromise = new Promise<boolean>((resolve) => {
      timeout = setTimeout(() => resolve(false), Math.max(0, timeoutMs));
    });

    const promises = [standbyPromise, timeoutPromise];

    if (abortSignal) {
      promises.push(
        new Promise<boolean>((resolve) => {
          onAbort = () => resolve(false);
          abortSignal.addEventListener("abort", onAbort, { once: true });
        }),
      );
    }

    try {
      return await Promise.race(promises);
    } finally {
      if (unsubscribe) {
        unsubscribe();
      }
      if (timeout) {
        clearTimeout(timeout);
      }
      if (abortSignal && onAbort) {
        abortSignal.removeEventListener("abort", onAbort);
      }
    }
  }

  // ─── 订阅 ──────────────────────────────────────────────────

  /** 订阅状态变更 */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ─── 状态持久化 ────────────────────────────────────────────

  /** 提取当前运行时状态并保存到磁盘 */
  saveStateSnapshot(teamName: string | null, config?: TeamConfig, projectDir?: string): boolean {
    const mates = this.list();
    if (mates.length === 0 && !teamName) {
      return false;
    }

    const snapshot: TeamSnapshot = {
      config: config ?? {
        autoApprove: false,
        doomLoopThreshold: 5,
        maxTeammates: 0,
        useWorktree: true,
        worktreeBase: ".crab/worktrees",
      },
      id: `snapshot-${teamName ?? "unknown"}-${Date.now()}`,
      tasks: [],
      teammates: mates,
      timestamp: Date.now(),
    };
    return saveStateSnapshot(snapshot, projectDir);
  }

  /** 从磁盘快照恢复队友注册(不恢复运行时状态如消息队列、AbortController) */
  restoreFromSnapshot(projectDir?: string): TeamSnapshot | null {
    const snapshot = loadStateSnapshot(projectDir);
    if (!snapshot) {
      return null;
    }

    for (const mate of snapshot.teammates) {
      this.teammates.set(mate.id, mate);
    }
    log.info(`从快照恢复 ${snapshot.teammates.length} 个队友注册信息`);
    return snapshot;
  }

  // ─── 清理 ──────────────────────────────────────────────────

  /** 清空所有队友 */
  clear(): void {
    this.abortAllTeammates();
    this.teammates.clear();
    this.teammateMessageQueues.clear();
    this.standbySet.clear();
    this.leadMessageQueue.length = 0;
    this.completedResults.length = 0;
    this.planApprovals.length = 0;
    this.notifyListeners();
  }

  // ─── 内部 ──────────────────────────────────────────────────

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* Ignore */
      }
    }
  }
}
