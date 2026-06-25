/**
 * 子代理执行器类型 — 子代理执行过程中使用的状态、任务、回调类型。
 *
 * 职责:
 *   - 集中声明子代理执行相关的状态枚举、任务结构、回调签名
 *   - 为 SubAgentExecutor / SubAgentStreamProcessor 等模块提供共享类型
 *
 * 模块功能:
 *   - ExecutionStatus: 执行状态枚举(pending/running/completed/failed/cancelled/timeout)
 *   - SubAgentTask: 子代理任务接口
 *   - TaskDependency: 任务依赖关系
 *   - ExecutionResult: 单任务执行结果
 *   - ExecutionStats: 执行统计
 *   - TaskCallbacks: 任务回调集合
 *
 * 使用场景:
 *   - 子代理调度与执行器实现
 *   - 流式结果与任务状态的内部流转
 *
 * 边界:
 *   1. 仅声明类型，不包含运行时逻辑
 *   2. 不依赖任何具体执行器实现，便于复用
 */
import type { StreamChunk, StreamState } from "./streamProcessor";

/** 执行状态 */
export type ExecutionStatus =
  | "pending" // 等待中
  | "running" // 运行中
  | "completed" // 已完成
  | "failed" // 失败
  | "cancelled" // 已取消
  | "timeout"; // 超时

/** 子代理任务 */
export interface SubAgentTask {
  /** 任务 ID */
  id: string;
  /** 代理类型 */
  agentType: string;
  /** 代理实例 ID */
  instanceId: string;
  /** 任务提示 */
  prompt: string;
  /** 优先级 */
  priority: number;
  /** 状态 */
  status: ExecutionStatus;
  /** 创建时间 */
  createdAt: number;
  /** 开始时间 */
  startedAt?: number;
  /** 完成时间 */
  completedAt?: number;
  /** 结果 */
  result?: string;
  /** 错误信息 */
  error?: string;
  /** 依赖的任务 ID */
  dependencies?: string[];
}

/** 执行配置 */
export interface ExecutorConfig {
  /** 最大并发数，默认不限制(由模型决定) */
  maxConcurrency: number;
  /** 单个任务超时时间(毫秒)，默认 5 分钟 */
  taskTimeout: number;
  /** 总执行超时时间(毫秒)，默认 10 分钟 */
  totalTimeout: number;
  /** 失败重试次数，默认 0 */
  retryCount: number;
  /** 重试延迟(毫秒)，默认 1000 */
  retryDelay: number;
  /** 是否等待依赖完成，默认 true */
  waitForDependencies: boolean;
  /** 流处理器配置 */
  streamProcessorConfig?: Partial<import("./streamProcessor").StreamProcessorConfig>;
}

/** 默认配置 */
export const DEFAULT_EXECUTOR_CONFIG: ExecutorConfig = {
  maxConcurrency: 5, // 防止无限制并发导致资源耗尽
  retryCount: 1,
  retryDelay: 1000,
  taskTimeout: 5 * 60 * 1000, // 5 分钟
  totalTimeout: 10 * 60 * 1000, // 10 分钟
  waitForDependencies: true,
};

/** 执行结果 */
export interface ExecutionResult {
  /** 是否成功 */
  success: boolean;
  /** 执行状态 */
  status: ExecutionStatus;
  /** 任务结果映射 */
  taskResults: Map<string, string>;
  /** 合并后的结果 */
  mergedResult: string;
  /** 错误信息 */
  error?: string;
  /** 执行统计 */
  stats: ExecutionStats;
}

/** 执行统计 */
export interface ExecutionStats {
  /** 总任务数 */
  totalTasks: number;
  /** 完成任务数 */
  completedTasks: number;
  /** 失败任务数 */
  failedTasks: number;
  /** 取消任务数 */
  cancelledTasks: number;
  /** 总执行时间(毫秒) */
  totalDuration: number;
  /** 平均任务执行时间(毫秒) */
  averageTaskDuration: number;
}

/** 任务执行回调 */
export interface TaskCallbacks {
  /** 任务开始回调 */
  onTaskStart?: (task: SubAgentTask) => void;
  /** 任务完成回调 */
  onTaskComplete?: (task: SubAgentTask, result: string) => void;
  /** 任务失败回调 */
  onTaskFailed?: (task: SubAgentTask, error: string) => void;
  /** 流数据块回调 */
  onStreamChunk?: (chunk: StreamChunk, state: StreamState) => void;
  /** 所有任务完成回调 */
  onAllComplete?: (result: ExecutionResult) => void;
}
