/**
 * [任务管理类型定义]
 *
 * 职责:
 *   - 定义异步任务(AsyncTask)相关类型
 *   - 定义目标(Goal)相关类型
 *   - 定义任务和 Goal 的状态枚举
 *   - 提供 EventBus 事件载荷类型
 *   - 定义默认值常量
 *
 * 模块功能:
 *   - TaskStatus: 任务状态类型(pending/running/completed/failed/cancelled)
 *   - AsyncTask: 异步任务接口定义
 *   - GoalStatus: Goal 状态类型(pursuing/paused/achieved/unmet/budget-limited/cleared)
 *   - GoalRecord: Goal 记录接口定义
 *   - GoalStatusUpdate: Goal 状态更新接口
 *   - GoalCreateOptions: Goal 创建选项接口
 *   - TaskEventPayload: 任务事件载荷
 *   - GoalEventPayload: Goal 事件载荷
 *   - DEFAULT_GOAL_TOKEN_BUDGET: 默认 Token 预算常量(2M)
 *
 * 使用场景:
 *   - TaskManager 和 GoalManager 的类型定义
 *   - EventBus 事件类型约束
 *   - 跨模块类型共享
 *
 * 边界:
 *   1. 纯类型定义文件，无业务逻辑
 *   2. 类型变更需同步更新相关模块
 *   3. 默认值常量需与实际预算策略一致
 *
 * 流程:
 *   1. 定义/修改类型接口
 *   2. 导出供其他模块使用
 *   3. 确保类型一致性检查通过
 */

// ─── 异步任务类型 ─────────────────────────────────────────────

/** 任务状态 */
export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

/** 异步任务 */
export interface AsyncTask {
  /** 品牌化 ID(task_xxx) */
  id: string;
  /** 任务提示词 */
  prompt: string;
  /** 任务状态 */
  status: TaskStatus;
  /** 创建时间 */
  createdAt: number;
  /** 开始执行时间 */
  startedAt?: number;
  /** 完成时间 */
  completedAt?: number;
  /** 最近更新时间 */
  updatedAt?: number;
  /** 后台进程 PID(server/taskRunner 真值源场景) */
  pid?: number;
  /** 执行结果 */
  result?: string;
  /** 错误信息 */
  error?: string;
  /** Token 使用量 */
  tokenUsage?: {
    input: number;
    output: number;
  };
  /** 使用的模型 */
  model?: string;
  /** 关联的会话 ID */
  sessionId?: string;
  /** 任务描述(可选，用于展示) */
  description?: string;
}

// ─── Goal 目标类型 ────────────────────────────────────────────

/** Goal 状态 */
export type GoalStatus = "pursuing" | "paused" | "achieved" | "unmet" | "budget-limited" | "cleared";

/** Goal 记录 */
export interface GoalRecord {
  /** Goal ID */
  id: string;
  /** 关联的会话 ID */
  sessionId: string;
  /** 目标描述 */
  objective: string;
  /** 当前状态 */
  status: GoalStatus;
  /** Token 预算(默认 2M) */
  tokenBudget?: number;
  /** 已使用的 Token 数 */
  tokensUsed: number;
  /** 已执行的轮次 */
  runCount: number;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 最后一次状态更新的解释 */
  lastExplanation?: string;
  /** 最后一次错误 */
  lastError?: string;
  /** 是否有待续接(Ralph Loop) */
  pendingContinuation: boolean;
}

/** Goal 状态更新(模型通过工具调用) */
export interface GoalStatusUpdate {
  status: "achieved" | "unmet";
  explanation?: string;
}

/** Goal 创建选项 */
export interface GoalCreateOptions {
  /** 目标描述 */
  objective: string;
  /** Token 预算 */
  tokenBudget?: number;
  /** 关联会话 ID */
  sessionId: string;
}

// ─── 默认值 ──────────────────────────────────────────────────

/** 默认 Token 预算(2M tokens) */
export const DEFAULT_GOAL_TOKEN_BUDGET = 2_000_000;

// ─── EventBus 事件载荷类型 ────────────────────────────────────

/** 任务事件载荷 */
export interface TaskEventPayload {
  id: string;
  prompt?: string;
  status?: TaskStatus;
  error?: string;
}

/** Goal 事件载荷 */
export interface GoalEventPayload {
  id: string;
  sessionId: string;
  objective?: string;
  status?: GoalStatus;
  tokensUsed?: number;
  tokenBudget?: number;
  runCount?: number;
}
