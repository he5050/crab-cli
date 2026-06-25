/**
 * Team 工具执行器端口（Port）定义
 *
 * 职责:
 *   - 定义 tool/team 模块所需的团队协作接口
 *   - 将 tool 层与 @/agent/team 内部实现解耦
 *
 * 设计决策:
 *   - 同步方法保持同步（broadcast/start/update/create/merge/abort/approve）
 *   - 异步方法保持异步（spawn/message/shutdown/wait/cleanup）
 *   - tool 层按需 await，不强制统一 Promise 包装
 */

// ─── 基础类型 ────────────────────────────────────────────────────

/** 队友创建结果，包含创建的队友 ID 和初始输出 */
export interface TeamMateSpawnResult {
  teammateId: string;
  output: string;
}

/** 团队执行结果 */
export interface TeamExecutionResult {
  ok: boolean;
  output?: string;
  error?: string;
}

/** 队友信息 */
export interface TeammateInfo {
  id: string;
  name: string;
  role: string;
  status: string;
  task: string;
  worktreePath?: string;
  error?: string;
  result?: string;
}

/** 任务信息 */
export interface TeamTaskInfo {
  id: string;
  description: string;
  status: string;
  assignee?: string;
  assigneeName?: string;
  dependencies: string[];
  title?: string;
}

/** 合并策略 */
export type MergeStrategy = "manual" | "theirs" | "ours" | "auto" | "ours-prefer";

// ─── Port 接口 ──────────────────────────────────────────────────

/**
 * Team 工具执行器端口
 *
 * 同步/异步按 agent/team 实际签名对齐，避免无意义的 Promise 包装。
 */
/** TeamExecutorPort */
export interface TeamExecutorPort {
  // ── 队友生命周期 ──────────────────────────────────────────────

  /** 创建新队友（异步） */
  spawnMate(
    name: string,
    role: string,
    task: string,
    options?: {
      agentName?: string;
      allowedTools?: string[];
      model?: string;
    },
  ): Promise<TeamExecutionResult & { output: string }>;

  /** 启动队友 LLM 执行循环（同步） */
  startTeammate(teammateId: string, prompt: string, options?: { requirePlanApproval?: boolean }): TeamExecutionResult;

  /** 向指定队友发送消息（异步） */
  messageMate(teammateId: string, message: string): Promise<TeamExecutionResult>;

  /** 广播消息给所有队友（同步） */
  broadcastMessage(message: string): TeamExecutionResult;

  /** 关闭指定队友（异步） */
  shutdownTeammate(teammateId: string): Promise<TeamExecutionResult>;

  /** 等待所有队友进入 standby（异步） */
  waitForTeammates(timeoutMs?: number, abortSignal?: AbortSignal): Promise<TeamExecutionResult>;

  /** 清理团队资源（异步） */
  cleanupTeam(): Promise<TeamExecutionResult>;

  // ── 查询接口 ──────────────────────────────────────────────────

  /** 获取队友追踪器 */
  getTracker(): TeamTrackerPort;

  /** 列出所有队友 */
  listTeammates(): TeammateInfo[];

  /** 获取指定队友信息 */
  getTeammate(teammateId: string): TeammateInfo | undefined;

  // ── 任务管理 ──────────────────────────────────────────────────

  /** 创建共享任务（同步） */
  createTask(
    description: string,
    teammateId?: string,
    options?: {
      dependencies?: string[];
      title?: string;
    },
  ): TeamExecutionResult & { output: string };

  /** 更新任务状态（同步） */
  updateTask(teammateId: string, task?: string, taskStatus?: string): TeamExecutionResult;

  /** 获取任务列表 */
  getTaskList(): TeamTaskListPort;

  // ── 合并与冲突解决 ────────────────────────────────────────────

  /** 合并指定队友的分支（异步） */
  mergeTeammateWork(teammateId: string, strategy: MergeStrategy): Promise<TeamExecutionResult>;

  /** 合并所有队友的分支（异步） */
  mergeAllWork(strategy: MergeStrategy): Promise<TeamExecutionResult>;

  /** 解决合并冲突（异步） */
  resolveMergeConflicts(): Promise<TeamExecutionResult>;

  /** 中止合并（异步） */
  abortMerge(): Promise<TeamExecutionResult>;

  // ── 计划审批 ──────────────────────────────────────────────────

  /** 审批队友计划（同步） */
  approvePlan(teammateId: string, approved: boolean, feedback?: string): TeamExecutionResult;
}

// ─── 子端口接口 ──────────────────────────────────────────────────

/** 队友追踪器端口 */
export interface TeamTrackerPort {
  isOnStandby(teammateId: string): boolean;
}

/** 任务列表端口 */
export interface TeamTaskListPort {
  list(): TeamTaskInfo[];
}
