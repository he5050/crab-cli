/**
 * 压缩策略类型定义
 *
 * 定义压缩策略的接口、输入输出和选择逻辑。
 */
import type { ModelMessage } from "ai";
import type { AppConfigSchema } from "@/schema/config";
import type { CompressConfig } from "./config";
import type { CompressionResult, SubAgentCompressionResult } from "./compression";

export type CompactStrategyKind = "standard" | "hybrid" | "incremental";

export interface CompactStrategySelectionInput {
  requestedStrategy?: CompactStrategyKind;
  tokensBefore?: number;
  tokenBudget?: number;
  messageCount?: number;
  preferIncremental?: boolean;
  allowIncremental?: boolean;
  hasLargeToolResults?: boolean;
}

export interface CompactStrategyInput {
  messages: ModelMessage[];
  appConfig: AppConfigSchema;
  sessionId?: string;
  config?: Partial<CompressConfig>;
  keepRecentTurns?: number;
  tokensBefore?: number;
}

export interface CompactStrategyResult {
  compressed: boolean;
  messages: ModelMessage[];
  tokensBefore: number;
  tokensAfterEstimate: number;
  summary?: string;
  markerMessage?: string;
  rawResult?: CompressionResult | SubAgentCompressionResult;
}

export interface CompactStrategy {
  kind: CompactStrategyKind;
  compact(input: CompactStrategyInput): Promise<CompactStrategyResult>;
}

/** 策略选择配置 */
export interface StrategySelectionConfig {
  /** 高 token 预算压力比例阈值。默认 0.9（达到预算 90% 时使用混合策略） */
  highBudgetPressureRatio: number;
  /** 大消息数量阈值。默认 80（超过 80 条消息时使用混合策略） */
  largeMessageCount: number;
  /** 增量压缩最小消息数。默认 12 */
  incrementalMinMessageCount: number;
}

/** 默认策略选择配置 */
export const DEFAULT_STRATEGY_SELECTION_CONFIG: StrategySelectionConfig = {
  highBudgetPressureRatio: 0.9,
  incrementalMinMessageCount: 12,
  largeMessageCount: 80,
};
