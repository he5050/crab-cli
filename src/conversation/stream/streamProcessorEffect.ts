/**
 * 流式处理器 Effect Stream 版本 — 使用 Stream.tap / Stream.runDrain 替代 for-await。
 *
 * 职责:
 *   - 与 processStream 相同的接口和返回值
 *   - 使用 Effect Stream 处理流事件
 *   - 天然背压（消费者慢时生产者自动等待）
 *   - 中止信号用 Effect.interrupt 替代手动检查
 *
 * 通过配置项 useEffectProcessor: true 启用，默认不启用。
 */
import { Effect, Stream } from "effect";
import type { LlmStreamEvent } from "@/api";
import { asyncIterableToStream } from "@/conversation/core/llmStreamAdapter";
import { type ThinkingData, cleanThinkingContent, extractThinkingContent } from "../message/thinkingExtractor";
import type { ConversationUsage, StreamCallbacks, StreamRoundResult, ToolCallInfo } from "@/conversation/types";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("conversation:stream:effect");

const TOKEN_UPDATE_INTERVAL = 100;
const MAX_DELTA_SIZE = 50_000;
const MAX_STREAMED_CONTENT_LENGTH = 1_000_000;

/**
 * 使用 Effect Stream 模式处理单轮 LLM 流式响应。
 *
 * 接口与 processStream 完全一致，通过配置项启用。
 */
export async function processStreamWithEffect(
  stream: AsyncIterable<LlmStreamEvent>,
  callbacks?: StreamCallbacks,
  abortSignal?: AbortSignal,
): Promise<StreamRoundResult> {
  let streamedContent = "";
  const toolCalls: ToolCallInfo[] = [];
  let thinking: { thinking: string; signature?: string } | undefined;
  let reasoningContent: string | undefined;
  let usage: ConversationUsage | null = null;
  let streamError: Error | undefined;

  let reasoningAccumulator = "";
  let lastTokenUpdateTime = 0;

  // 将 AsyncIterable 转为 Effect Stream
  const effectStream = asyncIterableToStream<LlmStreamEvent>(stream);

  // 使用 Stream.tap 处理每个事件
  const tappedStream = Stream.tap(effectStream, (event) =>
    Effect.sync(() => {
      switch (event.type) {
        case "text-delta": {
          const delta = event.text;
          if (delta.length > MAX_DELTA_SIZE) {
            log.warn(`text-delta 超过最大长度，截断: ${delta.length} > ${MAX_DELTA_SIZE}`);
            return;
          }
          if (streamedContent.length + delta.length > MAX_STREAMED_CONTENT_LENGTH) {
            log.warn(
              `流式内容超过最大长度，停止累积: ${streamedContent.length + delta.length} > ${MAX_STREAMED_CONTENT_LENGTH}`,
            );
            return;
          }
          streamedContent += delta;
          callbacks?.onTokenDelta?.(delta);
          const now = Date.now();
          if (now - lastTokenUpdateTime >= TOKEN_UPDATE_INTERVAL) {
            callbacks?.onToken?.(streamedContent);
            lastTokenUpdateTime = now;
          }
          break;
        }
        case "reasoning-delta": {
          reasoningAccumulator += event.text;
          if (event.text.trim()) {
            callbacks?.onThinking?.(event.text);
          }
          break;
        }
        case "tool-call": {
          const tc: ToolCallInfo = {
            arguments: event.args,
            id: event.toolCallId,
            name: event.toolName,
          };
          toolCalls.push(tc);
          callbacks?.onToolCall?.(tc);
          break;
        }
        case "done": {
          if (event.usage) {
            usage = {
              cache_creation_input_tokens: event.usage.cacheCreationInputTokens,
              cache_read_input_tokens: event.usage.cacheReadInputTokens,
              cached_tokens: event.usage.cachedTokens,
              completion_tokens: event.usage.completionTokens ?? 0,
              prompt_tokens: event.usage.promptTokens ?? 0,
              total_tokens: event.usage.totalTokens ?? 0,
            };
            callbacks?.onUsage?.(usage);
          }
          if (event.thinking) {
            thinking = event.thinking;
          }
          if (event.reasoning_content) {
            reasoningContent = event.reasoning_content;
          }
          break;
        }
        case "error": {
          const error = new Error(event.error.message);
          callbacks?.onError?.(error);
          log.error(`流式错误(Effect): ${event.error.message}`);
          streamError = error;
          break;
        }
      }
    }),
  );

  // 如果有中止信号，用 Stream.takeUntil
  const finalStream = abortSignal ? Stream.takeUntil(tappedStream, () => abortSignal.aborted) : tappedStream;

  // 消费整个流
  try {
    await Effect.runPromise(Stream.runDrain(finalStream));
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    log.error(`Effect Stream 处理失败: ${error.message}`);
    streamError = error;
  }

  // 最终 token 回调
  if (streamedContent && callbacks?.onToken) {
    callbacks.onToken(streamedContent);
  }

  // 提取 thinking
  const extractedThinking = extractThinkingContent(thinking as ThinkingData | undefined, undefined, reasoningContent);
  const reasoningAsThinking =
    !extractedThinking && reasoningAccumulator.trim() ? cleanThinkingContent(reasoningAccumulator) : undefined;

  return {
    error: streamError,
    reasoning: undefined,
    reasoningContent,
    streamedContent,
    thinking: extractedThinking
      ? { thinking: extractedThinking }
      : reasoningAsThinking
        ? { thinking: reasoningAsThinking }
        : undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    usage,
  };
}

/**
 * 检查是否启用 Effect Stream 处理器模式。
 */
export function shouldUseEffectProcessor(config?: { useEffectProcessor?: boolean }): boolean {
  return config?.useEffectProcessor === true;
}
