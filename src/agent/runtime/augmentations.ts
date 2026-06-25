/**
 * Agent 运行时增强模块 — 构建 Agent 前缀增强内容
 *
 * 职责:
 *   - 构建 Agent 运行时的前缀增强内容
 *   - 整合注意力提示和压缩感知提示
 *   - 管理压缩时间戳状态
 *
 * 模块功能:
 *   - buildAgentRuntimeAugmentations: 构建运行时增强内容
 *   - AgentRuntimeAugmentationState: 运行时增强状态接口
 *   - AgentRuntimeAugmentationResult: 运行时增强结果接口
 *
 * 使用场景:
 *   - 在 Agent 会话开始前构建增强前缀提示
 *   - 需要向 Agent 注入注意力引导或压缩状态提示时
 *
 * 边界:
 * 1. 仅构建前缀内容，不直接修改 Agent 状态
 * 2. 依赖 @agent/runtime/attention 和 @agent/runtime/compression 模块
 *
 * 流程:
 * 1. 调用 formatAttentionPrompt 获取注意力提示
 * 2. 调用 buildCompressionContinuationPrompt 获取压缩延续提示
 * 3. 组合两部分提示为最终前缀内容
 */
import { formatAttentionPrompt } from "@/agent/runtime/attention";
import { buildCompressionContinuationPrompt, getLastCompressionTime } from "@/agent/runtime/compression";

export interface AgentRuntimeAugmentationState {
  lastCompressionTimestamp: number;
}

export interface AgentRuntimeAugmentationResult {
  prefix: string;
  lastCompressionTimestamp: number;
}

export function buildAgentRuntimeAugmentations(state: AgentRuntimeAugmentationState): AgentRuntimeAugmentationResult {
  const parts: string[] = [];

  const attentionPrompt = formatAttentionPrompt();
  if (attentionPrompt) {
    parts.push(attentionPrompt);
  }

  const compressionPrompt = buildCompressionContinuationPrompt(state.lastCompressionTimestamp);
  if (compressionPrompt) {
    parts.push(compressionPrompt);
  }

  return {
    lastCompressionTimestamp: getLastCompressionTime() ?? state.lastCompressionTimestamp,
    prefix: parts.join("\n\n"),
  };
}
