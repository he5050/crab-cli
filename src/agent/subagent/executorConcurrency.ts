/**
 * 子代理执行器 - 动态并发数计算.
 *
 * 职责:
 *   - 根据任务数量、依赖关系、用户配置计算实际并发数
 *
 * 策略:
 *   1. maxConcurrency > 0: 使用配置的并发数(但不超过全局 MAX_RUNNING_SUBAGENTS)
 *   2. maxConcurrency = 0 (不限制):
 *      - 任务数 <= 3: 全部并行
 *      - 任务数 <= 10: min(任务数, 10)
 *      - 任务数 > 10: 有依赖则取一半, 否则 = 任务数(仍受全局限制)
 */
import { MAX_RUNNING_SUBAGENTS } from "@/config";

export function calculateDynamicConcurrency(
  taskCount: number,
  hasDependencies: boolean,
  maxConcurrency: number = 0,
): number {
  if (taskCount <= 0) {
    return 1;
  }

  if (maxConcurrency > 0) {
    return Math.min(maxConcurrency, MAX_RUNNING_SUBAGENTS);
  }

  if (taskCount <= 3) {
    return taskCount;
  }
  if (taskCount <= 10) {
    return Math.min(taskCount, 10);
  }
  if (hasDependencies) {
    return Math.min(Math.ceil(taskCount / 2), MAX_RUNNING_SUBAGENTS);
  }
  return Math.min(taskCount, MAX_RUNNING_SUBAGENTS);
}
