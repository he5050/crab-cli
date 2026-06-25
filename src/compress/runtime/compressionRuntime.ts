/**
 * 压缩运行时模块 — 在对话循环内按需触发消息压缩。
 *
 * 职责:
 *   - 创建可注入到 LLM 循环的 MessageCompressor
 *   - 联动压缩协调器避免重复触发
 *   - 在压缩前后广播总线事件
 *
 * 模块功能:
 *   - createConversationCompressor: 创建对话压缩器
 */
import type { ModelMessage } from "ai";
import type { AppConfigSchema } from "@/schema/config";
import { globalBus, type EventBus } from "@/bus";
import { AppEvent } from "@/bus";
import { createLogger } from "@/core/logging/logger";
import { type CompactionConfig, estimateMessagesTokens, maybeCompact, truncateToolOutputs } from "../conversation";
import { compressionCoordinator } from "../core/compressionCoordinator";
import type { MessageCompressor } from "@/conversation/core/llmLoop";

const log = createLogger("conversation");

export function createConversationCompressor(
  compactionConfig: CompactionConfig,
  sessionId?: string,
): MessageCompressor {
  return {
    compress: async (messages, config, _modelId, activeSessionId) => {
      const estimatedTokens = estimateMessagesTokens(messages);
      const compressionThreshold = 80_000;

      if (estimatedTokens < compressionThreshold) {
        return {
          afterTokensEstimate: estimatedTokens,
          beforeTokens: estimatedTokens,
          compressed: false,
          messages,
        };
      }

      log.info(`触发上下文压缩: ${estimatedTokens} tokens`, {
        eventType: "conversation.compress",
        payload: { tokens: estimatedTokens },
        sessionId,
      });

      const result = activeSessionId
        ? await compressionCoordinator.withLock(activeSessionId, () =>
            maybeCompact(messages, config, compactionConfig, activeSessionId),
          )
        : await maybeCompact(messages, config, compactionConfig, activeSessionId);

      return {
        afterTokensEstimate: result.tokensAfter,
        beforeTokens: result.tokensBefore,
        compressed: result.compacted,
        messages: result.compacted ? messages.slice(0, result.messagesAfter) : messages,
      };
    },
  };
}

export async function autoCompactMessages(
  input: {
    messages: ModelMessage[];
    config: AppConfigSchema;
    compactionConfig: CompactionConfig;
    sessionId?: string;
  },
  eventBus: EventBus = globalBus,
): Promise<void> {
  const { messages, config, compactionConfig, sessionId } = input;
  try {
    truncateToolOutputs(messages, compactionConfig.toolOutputTruncateLength, compactionConfig.keepRecentTurns * 2);
    const result = sessionId
      ? await compressionCoordinator.withLock(sessionId, () =>
          maybeCompact(messages, config, compactionConfig, sessionId),
        )
      : await maybeCompact(messages, config, compactionConfig, sessionId);
    if (result.compacted) {
      log.info(`自动压缩完成`, {
        durationMs: result.durationMs,
        eventType: "conversation.autocompact",
        payload: {
          messagesAfter: result.messagesAfter,
          messagesBefore: result.messagesBefore,
          tokensAfter: result.tokensAfter,
          tokensBefore: result.tokensBefore,
        },
        sessionId,
      });
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    eventBus.publish(AppEvent.Toast, {
      message: `上下文压缩失败(不影响对话): ${errMsg}`,
      variant: "warning",
    });
    log.warn(`自动压缩失败(不影响对话): ${errMsg}`, {
      eventType: "conversation.autocompact-failed",
      payload: { error: errMsg },
      sessionId,
    });
  }
}
