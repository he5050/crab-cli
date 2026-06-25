/**
 * 流式处理器(Stream Processor)— 处理 LLM 流式响应。
 *
 * 职责:
 *   - 累积流式文本内容
 *   - 提取 thinking/reasoning 内容
 *   - 解析 tool_calls
 *   - Token 计数
 *   - 通过回调通知外部
 *
 * 模块功能:
 *   - processStream(): 处理单轮 LLM 流式响应
 *   - mergeUsage(): 合并两轮使用量
 *
 * 使用场景:
 *   - ConversationHandler 处理 LLM 流响应
 *   - 实时 UI 更新(token、thinking、tool_call)
 *
 * 边界:
 * 1. 纯数据处理，不涉及 UI 或状态管理
 * 2. 每 100ms 触发一次 onToken 回调(TOKEN_UPDATE_INTERVAL)
 * 3. reasoning 累积可作为 thinking 处理
 *
 * 流程:
 * 1. 遍历流事件
 * 2. text-delta:累积文本，触发 onTokenDelta
 * 3. reasoning-delta:累积 reasoning，触发 onThinking
 * 4. tool-call:收集 tool_calls，触发 onToolCall
 * 5. done:提取 usage 和 thinking
 */

import type { LlmStreamEvent } from "@/api";
import { type ThinkingData, cleanThinkingContent, extractThinkingContent } from "../message/thinkingExtractor";
import type { ConversationUsage, StreamCallbacks, StreamRoundResult, ToolCallInfo } from "@/conversation/types";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("conversation:stream");

/** Token 计数更新间隔(毫秒) */
const TOKEN_UPDATE_INTERVAL = 100;

/** 单个 delta 最大长度(防止内存溢出) */
const MAX_DELTA_SIZE = 50_000;

/** 流式内容最大长度(背压控制) */
const MAX_STREAMED_CONTENT_LENGTH = 1_000_000;

/**
 * 处理单轮 LLM 流式响应。
 *
 * 将 crab-cli 的 LlmStreamEvent 流解析为 StreamRoundResult。
 * 这个函数是纯数据处理，不涉及 UI 或状态管理。
 *
 * @param stream - LLM 流事件异步迭代器
 * @param callbacks - 流式回调(token/thinking/tool_call/usage)
 * @param abortSignal - 中止信号
 * @returns 流式处理结果
 */
export async function processStream(
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

  // Reasoning 累积
  let reasoningAccumulator = "";

  // Token 计数
  let lastTokenUpdateTime = 0;

  for await (const event of stream) {
    // 检查中止信号
    if (abortSignal?.aborted) {
      log.debug("流式处理被中止");
      break;
    }

    switch (event.type) {
      case "text-delta": {
        const delta = event.text;

        // 背压控制:限制单个 delta 大小
        if (delta.length > MAX_DELTA_SIZE) {
          log.warn(`text-delta 超过最大长度，截断: ${delta.length} > ${MAX_DELTA_SIZE}`);
          break;
        }

        // 背压控制:限制总内容长度
        if (streamedContent.length + delta.length > MAX_STREAMED_CONTENT_LENGTH) {
          log.warn(
            `流式内容超过最大长度，停止累积: ${streamedContent.length + delta.length} > ${MAX_STREAMED_CONTENT_LENGTH}`,
          );
          break;
        }

        streamedContent += delta;

        // 每次增量都触发 onTokenDelta(用于逐步构建)
        callbacks?.onTokenDelta?.(delta);

        // 定期触发 onToken(传递累积文本，用于 UI 更新)
        const now = Date.now();
        if (now - lastTokenUpdateTime >= TOKEN_UPDATE_INTERVAL) {
          callbacks?.onToken?.(streamedContent);
          lastTokenUpdateTime = now;
        }
        break;
      }

      case "reasoning-delta": {
        reasoningAccumulator += event.text;

        // Reasoning 也触发 thinking 回调
        const cleaned = event.text;
        if (cleaned.trim()) {
          callbacks?.onThinking?.(cleaned);
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
        // 提取使用量
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

        // 提取 thinking(从 done 事件 — Provider 扩展字段)
        if (event.thinking) {
          ({ thinking } = event);
        }
        if (event.reasoning_content) {
          reasoningContent = event.reasoning_content;
        }
        break;
      }

      case "error": {
        const error = new Error(event.error.message);
        callbacks?.onError?.(error);
        log.error(`流式错误: ${event.error.message}`);
        streamError = error;
        break;
      }
    }
  }

  // 最终 token 回调
  if (streamedContent && callbacks?.onToken) {
    callbacks.onToken(streamedContent);
  }

  // 提取 thinking 内容
  const extractedThinking = extractThinkingContent(
    thinking as ThinkingData | undefined,
    undefined, // Reasoning 暂不从此处提取
    reasoningContent,
  );

  // 如果没有从 done 事件获取 thinking，从累积的 reasoning 中构建
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
 * 合并两轮使用量。
 */
export function mergeUsage(acc: ConversationUsage | null, round: ConversationUsage | null): ConversationUsage | null {
  if (!acc && !round) {
    return null;
  }
  if (!acc) {
    return round;
  }
  if (!round) {
    return acc;
  }

  return {
    cache_creation_input_tokens:
      (acc.cache_creation_input_tokens ?? 0) + (round.cache_creation_input_tokens ?? 0) || undefined,
    cache_read_input_tokens: (acc.cache_read_input_tokens ?? 0) + (round.cache_read_input_tokens ?? 0) || undefined,
    cached_tokens: (acc.cached_tokens ?? 0) + (round.cached_tokens ?? 0) || undefined,
    completion_tokens: acc.completion_tokens + round.completion_tokens,
    prompt_tokens: acc.prompt_tokens + round.prompt_tokens,
    total_tokens: acc.total_tokens + round.total_tokens,
  };
}
