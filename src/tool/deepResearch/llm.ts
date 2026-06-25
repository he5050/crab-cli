/**
 * Deep Research LLM 响应收集。
 *
 * 提供 LLM 流式响应的收集与重试逻辑。
 */
import type { AppConfigSchema } from "@/schema/config";
import { streamLlm } from "@/api";
import { createLogger } from "@/core/logging/logger";
import { createNetworkError } from "@/core/errors/appError";
import type { ModelMessage, UserModelMessage } from "ai";

const log = createLogger("conversation:deep-research");

/** 收集 LLM 完整响应 */
export async function collectLlmResponse(
  config: AppConfigSchema,
  messages: ModelMessage[],
  maxTokens: number,
  abortSignal?: AbortSignal,
): Promise<string> {
  const first = await collectLlmResponseOnce(config, messages, maxTokens, abortSignal);
  if (first.trim().length > 0) {
    return first;
  }

  log.warn("LLM 返回空响应，重试一次 deep research 步骤");
  const retryMessages: ModelMessage[] = [
    ...messages,
    {
      content: "The previous response was empty. Return the requested output now. Do not return a blank response.",
      role: "user",
    } as UserModelMessage,
  ];
  const retry = await collectLlmResponseOnce(config, retryMessages, maxTokens, abortSignal);
  if (retry.trim().length === 0) {
    throw createNetworkError("INVALID_RESPONSE", "供应商返回空响应");
  }
  return retry;
}

/** 单次收集 LLM 流式响应的完整文本 */
export async function collectLlmResponseOnce(
  config: AppConfigSchema,
  messages: ModelMessage[],
  maxTokens: number,
  abortSignal?: AbortSignal,
): Promise<string> {
  let fullText = "";

  const stream = streamLlm(config, messages, {
    abortSignal,
    maxTokens,
    temperature: 0.3,
    timeout: 60_000,
  });

  for await (const event of stream) {
    if (event.type === "text-delta") {
      fullText += event.text;
    } else if (event.type === "done" && fullText.trim().length === 0 && event.fullText?.trim()) {
      ({ fullText } = event);
    } else if (event.type === "error") {
      throw event.error;
    }
  }

  return fullText;
}
