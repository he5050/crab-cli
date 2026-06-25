/**
 * 压缩策略适配器。
 *
 * 将策略选择和各策略的具体行为放在 compressService 之外，
 * 同时保留现有压缩器实现不变。
 */

import type { ModelMessage } from "ai";
import { estimateMessagesTokens } from "../conversation";
import { defaultCompressor, truncateOversizedToolResults } from "../core/compressor";
import { performHybridCompression } from "./hybridCompress";
import { createIncrementalCompressor } from "./incrementalCompressor";
import type {
  CompactStrategy,
  CompactStrategyInput,
  CompactStrategyKind,
  CompactStrategyResult,
  CompactStrategySelectionInput,
  CompressionResult,
  StrategySelectionConfig,
  SubAgentCompressionResult,
} from "../types";
import { DEFAULT_STRATEGY_SELECTION_CONFIG as defaultStrategyConfig } from "../types";

export interface CompactStrategyDeps {
  estimateMessagesTokens: typeof estimateMessagesTokens;
  compressWithAI: (
    messages: ModelMessage[],
    appConfig: CompactStrategyInput["appConfig"],
    sessionId?: string,
  ) => Promise<CompressionResult | null>;
  truncateOversizedToolResults: typeof truncateOversizedToolResults;
  performHybridCompression: typeof performHybridCompression;
  createIncrementalCompressor: typeof createIncrementalCompressor;
}

const defaultDeps: CompactStrategyDeps = {
  compressWithAI: (messages, appConfig, sessionId) => defaultCompressor.compressWithAI(messages, appConfig, sessionId),
  createIncrementalCompressor,
  estimateMessagesTokens,
  performHybridCompression,
  truncateOversizedToolResults,
};

export function createStandardCompactStrategy(deps: CompactStrategyDeps = defaultDeps): CompactStrategy {
  return {
    async compact(input: CompactStrategyInput): Promise<CompactStrategyResult> {
      const tokensBefore = input.tokensBefore ?? deps.estimateMessagesTokens(input.messages);
      const result = await deps.compressWithAI(input.messages, input.appConfig, input.sessionId);

      if (!result) {
        return {
          compressed: false,
          messages: input.messages,
          tokensAfterEstimate: tokensBefore,
          tokensBefore,
        };
      }

      deps.truncateOversizedToolResults(input.messages);
      const tokensAfter = deps.estimateMessagesTokens(input.messages);

      return {
        compressed: true,
        messages: input.messages,
        rawResult: result,
        summary: result.summary,
        tokensAfterEstimate: tokensAfter,
        tokensBefore,
      };
    },
    kind: "standard",
  };
}

export function createHybridCompactStrategy(deps: CompactStrategyDeps = defaultDeps): CompactStrategy {
  return {
    async compact(input: CompactStrategyInput): Promise<CompactStrategyResult> {
      const tokensBefore = input.tokensBefore ?? deps.estimateMessagesTokens(input.messages);
      const result: SubAgentCompressionResult = await deps.performHybridCompression(
        input.messages,
        input.appConfig,
        input.config,
        input.keepRecentTurns,
      );
      const tokensAfter = result.afterTokensEstimate ?? deps.estimateMessagesTokens(input.messages);

      return {
        compressed: result.compressed,
        markerMessage: `[混合压缩完成] 压缩前 ${tokensBefore} tokens → 压缩后 ${tokensAfter} tokens`,
        messages: result.messages,
        rawResult: result,
        tokensAfterEstimate: tokensAfter,
        tokensBefore: result.beforeTokens ?? tokensBefore,
      };
    },
    kind: "hybrid",
  };
}

export function createIncrementalCompactStrategy(deps: CompactStrategyDeps = defaultDeps): CompactStrategy {
  return {
    async compact(input: CompactStrategyInput): Promise<CompactStrategyResult> {
      const tokensBefore = input.tokensBefore ?? deps.estimateMessagesTokens(input.messages);
      const compressor = deps.createIncrementalCompressor(input.sessionId ?? "compact-session", (messages) =>
        deps.compressWithAI(messages, input.appConfig, input.sessionId).then(
          (result) =>
            result ?? {
              summary: "",
              usage: {
                completion_tokens: 0,
                prompt_tokens: tokensBefore,
                total_tokens: tokensBefore,
              },
            },
        ),
      );
      const result = await compressor.compress(input.messages);
      deps.truncateOversizedToolResults(input.messages);
      const tokensAfter = deps.estimateMessagesTokens(input.messages);

      return {
        compressed: true,
        messages: input.messages,
        rawResult: result,
        summary: result.summary,
        tokensAfterEstimate: tokensAfter,
        tokensBefore,
      };
    },
    kind: "incremental",
  };
}

export function createCompactStrategy(
  kind: CompactStrategyKind = "standard",
  deps: CompactStrategyDeps = defaultDeps,
): CompactStrategy {
  switch (kind) {
    case "hybrid": {
      return createHybridCompactStrategy(deps);
    }
    case "incremental": {
      return createIncrementalCompactStrategy(deps);
    }
    case "standard":
    default: {
      return createStandardCompactStrategy(deps);
    }
  }
}

export function selectCompactStrategyKind(
  input: CompactStrategySelectionInput = {},
  config: StrategySelectionConfig = defaultStrategyConfig,
): CompactStrategyKind {
  if (input.requestedStrategy) {
    return input.requestedStrategy;
  }

  if (
    input.allowIncremental &&
    input.preferIncremental &&
    (input.messageCount ?? 0) >= config.incrementalMinMessageCount
  ) {
    return "incremental";
  }

  if (input.hasLargeToolResults) {
    return "hybrid";
  }

  if (
    input.tokenBudget !== undefined &&
    input.tokenBudget > 0 &&
    (input.tokensBefore ?? 0) >= input.tokenBudget * config.highBudgetPressureRatio
  ) {
    return "hybrid";
  }

  if ((input.messageCount ?? 0) >= config.largeMessageCount) {
    return "hybrid";
  }

  return "standard";
}
