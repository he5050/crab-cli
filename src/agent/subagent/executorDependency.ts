/**
 * 子代理执行器 - 任务依赖关系管理.
 *
 * 职责:
 *   - detectCycle: DFS 检测任务依赖图中是否存在循环
 *   - checkDependenciesCompleted: 判断某任务的依赖是否全部完成
 *
 * 边界:
 *   1. 不修改任务状态, 只读
 *   2. detectCycle 在 addTask 时立即检测, 循环任务会拒绝添加
 */
import type { SubAgentTask } from "./types";

/**
 * DFS 检测从 startId 出发的依赖图中是否存在循环.
 *
 * @param tasks 当前已注册的任务映射(id → SubAgentTask)
 * @param startId 起点任务 ID
 * @returns true 表示存在循环, false 表示无环
 */
export function detectCycle(tasks: Map<string, SubAgentTask>, startId: string): boolean {
  const visited = new Set<string>();
  const inStack = new Set<string>();

  const dfs = (id: string): boolean => {
    if (inStack.has(id)) {
      return true;
    }
    if (visited.has(id)) {
      return false;
    }
    visited.add(id);
    inStack.add(id);

    const task = tasks.get(id);
    if (task?.dependencies) {
      for (const dep of task.dependencies) {
        if (dfs(dep)) {
          return true;
        }
      }
    }
    inStack.delete(id);
    return false;
  };

  return dfs(startId);
}

/**
 * 检查指定任务的依赖是否全部完成.
 *
 * @param tasks 任务映射
 * @param task 要检查的任务(必须已注册在 tasks 中)
 * @returns true 表示所有依赖都 "completed"; 否则 false
 */
export function checkDependenciesCompleted(tasks: Map<string, SubAgentTask>, task: SubAgentTask): boolean {
  if (!task.dependencies || task.dependencies.length === 0) {
    return true;
  }
  return task.dependencies.every((depId) => {
    const depTask = tasks.get(depId);
    return depTask?.status === "completed";
  });
}
