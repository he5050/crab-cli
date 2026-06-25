/**
 * 子代理执行器 - 结果聚合与统计.
 *
 * 职责:
 *   - createSuccessResult: 合并流式结果 + 计算统计
 *   - createFailedResult: 标记未完成任务 + 计算统计
 *   - getExecutorStatus: 概览(总数/pending/running/completed/failed/cancelled)
 *
 * 边界:
 *   1. 纯函数, 不修改传入的任务
 *   2. 失败结果会原地将 pending 任务标记为 cancelled
 */
import type { ExecutionResult, ExecutionStats, SubAgentTask } from "./types";

/**
 * 创建成功执行结果: 合并流式结果, 计算任务统计.
 */
export function createSuccessResult(
  tasks: Map<string, SubAgentTask>,
  startTime: number,
  mergedResults: Map<string, string>,
): ExecutionResult {
  const taskList = [...tasks.values()];
  const completedTasks = taskList.filter((t) => t.status === "completed");
  const failedTasks = taskList.filter((t) => t.status === "failed");
  const cancelledTasks = taskList.filter((t) => t.status === "cancelled");

  const stats: ExecutionStats = {
    averageTaskDuration:
      completedTasks.length > 0
        ? completedTasks.reduce((sum, t) => sum + ((t.completedAt ?? 0) - (t.startedAt ?? 0)), 0) /
          completedTasks.length
        : 0,
    cancelledTasks: cancelledTasks.length,
    completedTasks: completedTasks.length,
    failedTasks: failedTasks.length,
    totalDuration: Date.now() - startTime,
    totalTasks: taskList.length,
  };

  return {
    mergedResult: mergedResults.get("merged") || "",
    stats,
    status: failedTasks.length > 0 ? "failed" : "completed",
    success: failedTasks.length === 0,
    taskResults: mergedResults,
  };
}

/**
 * 创建失败执行结果: 将所有 pending 任务标记为 cancelled, 保留已完成的统计.
 */
export function createFailedResult(
  tasks: Map<string, SubAgentTask>,
  startTime: number,
  error: string,
): ExecutionResult {
  const taskList = [...tasks.values()];
  const pendingTasks = taskList.filter((t) => t.status === "pending");

  for (const task of pendingTasks) {
    task.status = "cancelled";
    task.completedAt = Date.now();
  }

  const stats: ExecutionStats = {
    averageTaskDuration: 0,
    cancelledTasks: pendingTasks.length,
    completedTasks: taskList.filter((t) => t.status === "completed").length,
    failedTasks: taskList.filter((t) => t.status === "failed").length,
    totalDuration: Date.now() - startTime,
    totalTasks: taskList.length,
  };

  return {
    error,
    mergedResult: "",
    stats,
    status: "failed",
    success: false,
    taskResults: new Map(),
  };
}

/**
 * 执行器状态概览(用于 UI 展示).
 */
export interface ExecutorStatus {
  totalTasks: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
}

export function getExecutorStatus(tasks: Map<string, SubAgentTask>): ExecutorStatus {
  const taskList = [...tasks.values()];
  return {
    cancelled: taskList.filter((t) => t.status === "cancelled").length,
    completed: taskList.filter((t) => t.status === "completed").length,
    failed: taskList.filter((t) => t.status === "failed").length,
    pending: taskList.filter((t) => t.status === "pending").length,
    running: taskList.filter((t) => t.status === "running").length,
    totalTasks: taskList.length,
  };
}
