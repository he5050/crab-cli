/**
 * Token 计算统一入口 — 全系统 Token 类型和工具的唯一来源。
 *
 * 所有模块应从此模块导入 TokenUsage 类型和累加/估算函数，
 * 不应自行定义 TokenUsage 类型。
 *
 * 类型层次:
 *   LlmTokenUsage (api/core/llm.ts) — LLM SDK 原始返回，仅在 api 层使用
 *   TokenUsage (本模块) — 系统统一类型，所有业务模块使用
 *
 * 转换:
 *   llmTokenUsageToTokenUsage() — LlmTokenUsage → TokenUsage
 */
export type { TokenUsage } from "@/session/types";

export { estimateTokens, estimateMessagesTokens, formatTokenCount } from "@/session/token/tokenCounterRef";

export {
  accumulateUsageDecimal,
  calculateCost,
  createCostAccumulator,
  type CostUsage,
  type PricingTable,
  type CostBreakdown,
  type AccumulatedCost,
} from "@/api/core/cost";

export type { LlmTokenUsage } from "@/api/core/llm";

import type { LlmTokenUsage } from "@/api/core/llm";
import type { TokenUsage } from "@/session/types";

/**
 * 将 LLM SDK 返回的 LlmTokenUsage 转换为系统统一 TokenUsage。
 * 这是全系统唯一的 LlmTokenUsage → TokenUsage 转换点。
 */
export function llmTokenUsageToTokenUsage(usage: LlmTokenUsage): TokenUsage {
  return {
    inputTokens: usage.promptTokens,
    outputTokens: usage.completionTokens,
    ...(usage.cacheCreationInputTokens !== undefined
      ? { cacheCreationInputTokens: usage.cacheCreationInputTokens }
      : {}),
    ...(usage.cacheReadInputTokens !== undefined ? { cacheReadInputTokens: usage.cacheReadInputTokens } : {}),
    ...(usage.cachedTokens !== undefined ? { cachedTokens: usage.cachedTokens } : {}),
  };
}

/**
 * 计算 Token 总数（输入 + 输出）。
 */
export function totalTokenCount(usage: TokenUsage): number {
  return usage.inputTokens + usage.outputTokens;
}
