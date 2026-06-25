/**
 * 子代理结果聚合工具 — 提取 spawned children 结果并构建父代理续接提示词。
 *
 * 职责:
 *   - 从结果提取器(SpawnedResultDrainer)中提取并聚合子代理结果
 *   - 将聚合结果格式化为父代理可消费的续接提示词
 *
 * 模块功能:
 *   - AggregatedSpawnedChildResult: 聚合后的子代理结果类型
 *   - SpawnedResultDrainer: 提取器接口
 *   - drainSpawnedChildResults: 提取并聚合
 *   - buildSpawnedChildrenContinuationPrompt: 构建续接提示词
 *
 * 使用场景:
 *   - 父代理等待其 spawn 的子代理完成后，调用 drainSpawnedChildResults 收集结果
 *   - 将结果通过 buildSpawnedChildrenContinuationPrompt 注入父代理上下文
 *
 * 边界:
 *   1. 本模块为纯函数，不维护状态
 *   2. 仅依赖 SpawnedResult / SpawnedResultDrainer 接口
 *   3. 与 RunningSubAgentTracker 解耦，可独立测试
 *   4. 抽取自 tracker.ts 以避免反向耦合(session 只需依赖此工具模块)
 *
 * 流程:
 *   1. 父代理完成主消息后，对每个 spawned child 调用 drainSpawnedResults
 *   2. 聚合结果 → buildSpawnedChildrenContinuationPrompt
 *   3. 注入父代理继续对话
 */
import type { SpawnedResult } from "./tracker";

/** 聚合的子代理结果(简化版，用于父代理消费) */
export interface AggregatedSpawnedChildResult {
  agentName: string;
  success: boolean;
  result: string;
  error?: string;
}

/** Spawned 结果提取器接口 */
export interface SpawnedResultDrainer {
  drainSpawnedResults(instanceId: string): SpawnedResult[];
  drainOrphanedResults(): SpawnedResult[];
}

/**
 * 提取子代理结果并聚合
 *
 * @param childIds - 子代理实例 ID 列表
 * @param drainer - 结果提取器(通常是 RunningSubAgentTracker 实例)
 * @returns 聚合后的子代理结果数组
 */
export function drainSpawnedChildResults(
  childIds: string[],
  drainer: SpawnedResultDrainer,
): AggregatedSpawnedChildResult[] {
  const aggregatedResults: AggregatedSpawnedChildResult[] = [];

  // 先收集所有子代理各自的 spawned 结果
  for (const childId of childIds) {
    const spawnedResults = drainer.drainSpawnedResults(childId);
    for (const sr of spawnedResults) {
      aggregatedResults.push({
        agentName: sr.agentName,
        error: sr.error,
        result: sr.result,
        success: sr.success,
      });
    }
  }

  // 统一收集孤儿结果（仅一次，避免重复包含）
  const orphanedResults = drainer.drainOrphanedResults();
  for (const sr of orphanedResults) {
    aggregatedResults.push({
      agentName: sr.agentName,
      error: sr.error,
      result: sr.result,
      success: sr.success,
    });
  }

  return aggregatedResults;
}

/**
 * 构建子代理结果延续提示词
 * 用于将子代理结果汇总后告知父代理
 */
export function buildSpawnedChildrenContinuationPrompt(results: AggregatedSpawnedChildResult[]): string {
  const childSummary = results
    .map(
      (sr, idx) =>
        `${idx + 1}. ${sr.agentName} | success=${sr.success}\n${
          sr.success ? `result:\n${sr.result}` : `error:\n${sr.error ?? "unknown error"}`
        }`,
    )
    .join("\n\n---\n\n");

  return [
    "[SPAWNED CHILDREN RESULTS]",
    "The sub-agents you spawned have finished. You must now consume their actual results and answer the original task.",
    "Do not claim UNKNOWN if a child result is present below.",
    "If any child failed, explicitly account for that failure in your answer.",
    "",
    childSummary,
  ].join("\n");
}
