/**
 * [Team 执行器]
 *
 * 职责:
 *   - 创建队友(spawnMate)
 *   - 执行队友(executeTeammate)— 完整 LLM 消息循环
 *   - 消息路由(messageMate / broadcastMessage)
 *   - 队友生命周期(shutdown / wait / cleanup)
 *   - 分支合并(mergeTeammateWork / mergeAllWork)
 *   - Plan approval
 *   - 发布 Team 相关事件
 *
 * 模块功能:
 *   - spawnMate:创建新队友
 *   - startTeammate:启动队友 LLM 执行循环
 *   - messageMate:向队友发送消息
 *   - broadcastMessage:广播消息给所有队友
 *   - shutdownTeammate:关闭指定队友
 *   - waitForTeammates:等待所有队友进入 standby
 *   - mergeTeammateWork:合并队友分支
 *   - mergeAllWork:合并所有队友分支
 *   - approvePlan:审批队友计划
 *   - createTask:创建共享任务
 *   - cleanupTeam:清理团队资源
 *
 * 使用场景:
 *   - 多队友协作开发
 *   - 并行任务执行
 *   - 代码分支管理
 *   - 团队任务分配
 *
 * 边界:
 *   1. 依赖 Git 进行版本控制
 *   2. 需要配置 LLM 模型
 *   3. 队友数量受 maxTeammates 限制(0 表示不限制)
 *   4. Worktree 操作需要 Git 仓库
 *
 * 流程:
 *   1. 初始化执行器，加载配置
 *   2. 创建队友(spawnMate)
 *   3. 启动队友执行(startTeammate)
 *   4. LLM 消息循环处理工具调用
 *   5. 处理合成工具(消息、任务等)
 *   6. 处理常规工具(文件操作等)
 *   7. 等待 standby 或任务完成
 *   8. 合并分支并清理资源
 */
import { createLogger } from "@/core/logging/logger";
import { streamLlm } from "@/api";
import { resolveDoomLoopThreshold } from "@/conversation";
import type { TeamConfig, TeamExecutionResult, Teammate } from "../types";
import { TeamTracker } from "../core/teamTracker";
import { TeamTaskList } from "../core/teamTaskList";
import type { LlmConflictResolver, MergeStrategy } from "../merge/teamWorktree";
import { loadTeamConfig } from "../core/teamConfig";
import type { AppConfigSchema } from "@/schema/config";
import { DEFAULT_CONFIG, loadConfig } from "@/config";
import { hasRecoverableSnapshot } from "../persist/teamStateSnapshot";
import type { TeammateExecutionOptions, TeammateStreamMessage } from "../mate/teamExecutorHelpers";
import { TeamMergeManager } from "../merge/teamMergeManager";
import { buildTeamContext, buildTeammateSystemPrompt } from "../mate/teamPromptBuilder";
import { ensureActiveTeamContext } from "../core/teamActiveContext";
import { runTeamLlmLoop } from "../execution/teamLlmLoopAdapter";
import {
  type CreateTeamTaskOptions,
  type TeamRuntimeState,
  approveTeamPlan,
  broadcastTeamMessage,
  createTeamTask,
  getTeamRuntimeState,
  messageTeamMate,
  updateTeamTask,
  waitForTeamStandby,
} from "../mate/teamLeadActions";
import { type SpawnTeamMateOptions, spawnTeamMate } from "../mate/teamMateSpawner";
import { shutdownTeamMate, startTeamMateExecution } from "../mate/teamMateLifecycle";

export type { TeammateExecutionOptions, TeammateStreamMessage } from "../mate/teamExecutorHelpers";

const log = createLogger("team:executor");

export function resolveTeamDoomLoopThreshold(config?: Partial<Pick<TeamConfig, "doomLoopThreshold">>): number {
  return resolveDoomLoopThreshold(config);
}

// ─── Team 执行器 ──────────────────────────────────────────────

/** Team 执行器(全局单例) */
export class TeamExecutor {
  private tracker = new TeamTracker();
  private taskList: TeamTaskList;
  private config: TeamConfig;
  private projectDir?: string;
  /** App 配置(由 ChatContext 注入，用于队友 LLM 调用) */
  private appConfig?: AppConfigSchema;
  /** 可注入的 LLM 流执行器，用于受控测试或特殊运行时。 */
  private llmStream = streamLlm;
  private mergeManager: TeamMergeManager;

  constructor(projectDir?: string) {
    this.projectDir = projectDir ?? process.cwd();
    this.taskList = new TeamTaskList(this.projectDir);
    this.config = loadTeamConfig(this.projectDir);
    this.mergeManager = new TeamMergeManager(this.getMergeManagerDeps());
  }

  private getMergeManagerDeps() {
    return {
      config: this.config,
      projectDir: this.projectDir,
      taskList: this.taskList,
      tracker: this.tracker,
    };
  }

  private syncMergeManagerDeps(): void {
    this.mergeManager.setProjectDir(this.projectDir);
    this.mergeManager.setConfig(this.config);
  }

  /** 返回当前项目根路径(构造时若未传入则回退到 process.cwd()) */
  getProjectDir(): string | undefined {
    return this.projectDir;
  }

  /** 注入 App 配置(由 ChatContext 在 team 模式激活时调用) */
  setAppConfig(config: AppConfigSchema): void {
    this.appConfig = config;
    log.info("Team 执行器已接收 App 配置");
  }

  /** 注入 LLM 流执行器。默认使用真实 streamLlm。 */
  setLlmStream(llmStream: typeof streamLlm): void {
    this.llmStream = llmStream;
  }

  private isTeammateTracked(teammateId: string): boolean {
    return Boolean(this.tracker.get(teammateId));
  }

  private markTeammateFailedIfTracked(teammateId: string, error: string): void {
    if (this.isTeammateTracked(teammateId)) {
      this.tracker.updateStatus(teammateId, "failed", { error });
    }
  }

  /** 初始化/重新加载配置 */
  reload(projectDir?: string): void {
    if (projectDir) {
      this.projectDir = projectDir;
    }
    this.projectDir ??= process.cwd();
    this.taskList.setProjectDir(this.projectDir);
    this.config = loadTeamConfig(this.projectDir);
    this.ensureActiveTeamContext(false);

    // 自动恢复:如果存在可恢复的快照，恢复队友注册信息
    if (hasRecoverableSnapshot(this.projectDir)) {
      const snapshot = this.tracker.restoreFromSnapshot(this.projectDir);
      if (snapshot) {
        log.info(`检测到可恢复的团队快照: ${snapshot.id} (${snapshot.teammates.length} 个队友)`);
      }
    }

    this.syncMergeManagerDeps();
    log.info(`Team 执行器已加载，maxTeammates=${this.config.maxTeammates}`);
  }

  private ensureActiveTeamContext(createIfMissing = true): string | null {
    return ensureActiveTeamContext({
      createIfMissing,
      projectDir: this.projectDir,
      taskList: this.taskList,
      tracker: this.tracker,
    });
  }

  // ─── 队友创建 ──────────────────────────────────────────────

  /**
   * 创建新队友。
   *
   * 1. 验证队友数量限制
   * 2. 创建独立 Git worktree(如果启用)
   * 3. 注册到 tracker
   * 4. 发布 TeamMateSpawned 事件
   */
  async spawnMate(
    name: string,
    role: string,
    task: string,
    options?: SpawnTeamMateOptions,
  ): Promise<TeamExecutionResult> {
    return spawnTeamMate(
      {
        autoSaveState: () => this.autoSaveState(),
        config: this.config,
        ensureActiveTeamContext: (createIfMissing) => this.ensureActiveTeamContext(createIfMissing),
        projectDir: this.projectDir,
        taskList: this.taskList,
        tracker: this.tracker,
      },
      name,
      role,
      task,
      options,
    );
  }

  // ─── 队友执行 ──────────────────────────────────────────────

  /**
   * 启动队友的 LLM 执行循环。
   *
   * 队友拥有完整的工具访问权限(不受限)，
   * 额外注入合成工具:message_teammate, claim_task, complete_task, list_team_tasks, wait-for-messages。
   *
   * 此方法启动异步执行，不阻塞调用者。
   * 通过 onMessage 回调推送流式事件。
   */
  startTeammate(teammateId: string, prompt: string, options: TeammateExecutionOptions = {}): TeamExecutionResult {
    return startTeamMateExecution(
      {
        buildTeammateContext: (mate, userPrompt) => this.buildTeammateContext(mate, userPrompt),
        executeTeammateLoop: (mate, teamContext, abortSignal, executionOptions) =>
          this.executeTeammateLoop(mate, teamContext, abortSignal, executionOptions),
        markTeammateFailedIfTracked: (id, error) => this.markTeammateFailedIfTracked(id, error),
        tracker: this.tracker,
      },
      teammateId,
      prompt,
      options,
    );
  }

  /**
   * 队友执行的主循环 — 完整 LLM 驱动。
   *
   * 循环逻辑:
   * 1. 消费队友消息队列中的新消息
   * 2. 调用 LLM API(streamLlm)+ 合成工具 + MCP 工具
   * 3. 解析 LLM 返回的 tool_calls
   * 4. 合成工具内部处理(message_teammate, claim_task, wait-for-messages 等)
   * 5. 常规工具通过 ToolExecutor 执行(带 worktree 路径重写)
   * 6. 如果没有工具调用，提醒队友调用 wait-for-messages
   * 7. 如果 wait-for-messages，进入 standby 阻塞
   */
  private async executeTeammateLoop(
    mate: Teammate,
    initialPrompt: string,
    abortSignal: AbortSignal,
    options: TeammateExecutionOptions,
  ): Promise<void> {
    let appConfig = options.appConfig ?? this.appConfig;
    if (!appConfig) {
      try {
        appConfig = await loadConfig();
        this.appConfig = appConfig;
      } catch (error) {
        log.warn(
          `Team 执行器加载 App 配置失败，回退默认配置: ${error instanceof Error ? error.message : String(error)}`,
        );
        appConfig = DEFAULT_CONFIG;
      }
    }
    const loopResult = await runTeamLlmLoop({
      abortSignal,
      appConfig,
      initialPrompt,
      markTeammateFailedIfTracked: (id, error) => this.markTeammateFailedIfTracked(id, error),
      mate,
      options,
      streamFn: this.llmStream,
      systemPrompt: () => this.getTeammateSystemPrompt(mate),
      taskList: this.taskList,
      teamConfig: this.config,
      tracker: this.tracker,
    });

    if (!loopResult.ok && !loopResult.maxRoundsReached) {
      if (abortSignal.aborted) {
        this.markTeammateFailedIfTracked(mate.id, "执行被中止");
        return;
      }
      const msg = loopResult.error ?? "队友执行失败";
      log.error(`队友 ${mate.id} LLM 循环失败: ${msg}`);
      this.markTeammateFailedIfTracked(mate.id, msg);
      return;
    }

    if (loopResult.maxRoundsReached) {
      log.warn(`队友 ${mate.id} 达到最大执行轮次 (50)`);
    }

    const finalResponse = loopResult.text;
    this.tracker.updateStatus(mate.id, "completed", { result: finalResponse || "达到最大执行轮次" });

    this.tracker.storeResult({
      name: mate.name,
      result: finalResponse,
      success: true,
      teammateId: mate.id,
    });

    options.onMessage?.({
      content: finalResponse,
      teammateId: mate.id,
      teammateName: mate.name,
      type: "done",
    });
  }

  /** 队友的系统提示词 */
  private getTeammateSystemPrompt(mate: Teammate): string {
    return buildTeammateSystemPrompt({
      mate,
      projectDir: this.projectDir,
    });
  }

  /** 构建队友的 Team Context 提示词 */
  private buildTeammateContext(mate: Teammate, userPrompt: string): string {
    return buildTeamContext({
      mate,
      projectDir: this.projectDir,
      tasks: this.taskList.list(),
      teammates: this.tracker.list(),
      userPrompt,
    });
  }

  // ─── 消息路由 ──────────────────────────────────────────────

  /** 向队友发送消息 */
  async messageMate(teammateId: string, message: string): Promise<TeamExecutionResult> {
    return messageTeamMate({ tracker: this.tracker }, teammateId, message);
  }

  /** 广播消息给所有队友 */
  broadcastMessage(message: string): TeamExecutionResult {
    return broadcastTeamMessage({ tracker: this.tracker }, message);
  }

  /** 消费 lead 消息队列 */
  dequeueLeadMessages() {
    return this.tracker.dequeueLeadMessages();
  }

  // ─── 队友生命周期 ──────────────────────────────────────────

  /** 关闭指定队友 */
  async shutdownTeammate(teammateId: string): Promise<TeamExecutionResult> {
    return shutdownTeamMate({ tracker: this.tracker }, teammateId);
  }

  /** 等待所有队友进入 standby，对应 team-wait / waitForAllTeammates 入口。 */
  async waitForTeammates(timeoutMs?: number, abortSignal?: AbortSignal): Promise<TeamExecutionResult> {
    return waitForTeamStandby({ tracker: this.tracker }, timeoutMs, abortSignal);
  }

  // ─── 分支合并 ──────────────────────────────────────────────

  /** 合并指定队友的分支 */
  async mergeTeammateWork(
    teammateId: string,
    strategy: MergeStrategy = "manual",
    llmResolver?: LlmConflictResolver,
  ): Promise<TeamExecutionResult> {
    return this.mergeManager.mergeTeammateWork(teammateId, strategy, llmResolver);
  }

  /** 合并所有队友的分支 */
  async mergeAllWork(
    strategy: MergeStrategy = "manual",
    llmResolver?: LlmConflictResolver,
  ): Promise<TeamExecutionResult> {
    return this.mergeManager.mergeAllWork(strategy, llmResolver);
  }

  /** 解决合并冲突后完成合并 */
  async resolveMergeConflicts(): Promise<TeamExecutionResult> {
    return this.mergeManager.resolveMergeConflicts();
  }

  /** 中止合并 */
  async abortMerge(): Promise<TeamExecutionResult> {
    return this.mergeManager.abortMerge();
  }

  // ─── Plan Approval ─────────────────────────────────────────

  /** 审批/拒绝队友的计划 */
  approvePlan(teammateId: string, approved: boolean, feedback?: string): TeamExecutionResult {
    return approveTeamPlan({ tracker: this.tracker }, teammateId, approved, feedback);
  }

  /** 获取待审批的计划 */
  getPendingApprovals() {
    return this.tracker.getPendingApprovals();
  }

  // ─── 任务管理 ──────────────────────────────────────────────

  /** 创建共享任务 */
  createTask(description: string, assigneeId?: string, options?: CreateTeamTaskOptions): TeamExecutionResult {
    this.ensureActiveTeamContext(true);
    return createTeamTask({ taskList: this.taskList }, description, assigneeId, options);
  }

  /** 更新队友任务状态 */
  updateTask(teammateId: string, taskDescription?: string, taskStatus?: string): TeamExecutionResult {
    return updateTeamTask({ taskList: this.taskList, tracker: this.tracker }, teammateId, taskDescription, taskStatus);
  }

  // ─── 查询 ──────────────────────────────────────────────────

  /** 列出所有队友 */
  listTeammates(): Teammate[] {
    return this.tracker.list();
  }

  /** 获取队友状态 */
  getTeammate(teammateId: string): Teammate | undefined {
    return this.tracker.get(teammateId);
  }

  /** 获取共享任务列表 */
  getTaskList(): TeamTaskList {
    return this.taskList;
  }

  /** 获取 Tracker */
  getTracker(): TeamTracker {
    return this.tracker;
  }

  /** 获取配置 */
  getConfig(): TeamConfig {
    return { ...this.config };
  }

  getRuntimeState(): TeamRuntimeState {
    return getTeamRuntimeState({
      projectDir: this.projectDir,
      taskList: this.taskList,
      tracker: this.tracker,
    });
  }

  // ─── 清理 ──────────────────────────────────────────────────

  /** 完整清理:中止队友 + 合并分支 + 删除 worktree */
  async cleanupTeam(): Promise<TeamExecutionResult> {
    return this.mergeManager.cleanupTeam();
  }

  /** 简单清理(不合并分支) */
  async cleanup(): Promise<void> {
    return this.mergeManager.cleanup();
  }

  /** 队友总数 */
  get size(): number {
    return this.tracker.size;
  }

  // ─── 状态持久化 ────────────────────────────────────────────

  /** 自动保存团队运行时状态快照 */
  private autoSaveState(): void {
    this.tracker.saveStateSnapshot(this.tracker.getActiveTeamName(), this.config, this.projectDir);
  }

  // ─── 内部辅助 ──────────────────────────────────────────────

  /** 从已完成结果中查找队友(shutdown 后 tracker 中可能没有) */
  private getTeammateFromResults(teammateId: string): Teammate | undefined {
    return this.tracker.get(teammateId);
  }
}

/** 全局 Team 执行器实例 */
export const teamExecutor = new TeamExecutor();
