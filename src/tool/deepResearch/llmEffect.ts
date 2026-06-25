/**
 * DeepResearch LLM 收集 Effect Stream 版本 — 使用 Stream.runDrain 替代 for-await。
 *
 * 职责:
 *   - collectLlmResponseWithEffect: Effect Stream 版本收集完整文本
 *   - 用 Stream.tap 累积文本，Stream.runDrain 消费
 *
 * 通过配置项 useEffectDeepResearch: true 启用，默认不启用。
 */
import { Effect, Stream } from "effect";
import type { ModelMessage } from "ai";
import { streamLlm } from "@/api";
import { asyncIterableToStream } from "@/conversation/core/llmStreamAdapter";
import { createLogger } from "@/core/logging/logger";
import type { AppConfigSchema } from "@/schema/config";

const log = createLogger("tool:deep-research:llm:effect");

/**
 * 使用 Effect Stream 模式收集 LLM 流式响应的完整文本。
 *
 * 接口与 collectLlmResponseOnce 一致。
 */
export async function collectLlmResponseWithEffect(
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

  const effectStream = asyncIterableToStream(stream);

  await Effect.runPromise(
    Stream.runDrain(
      Stream.tap(effectStream, (event) =>
        Effect.sync(() => {
          switch (event.type) {
            case "text-delta": {
              fullText += event.text;
              break;
            }
            case "done": {
              if (fullText.trim().length === 0 && event.fullText?.trim()) {
                fullText = event.fullText;
              }
              break;
            }
            case "error": {
              throw event.error;
            }
          }
        }),
      ),
    ),
  );

  return fullText;
}

/**
 * 检查是否应使用 Effect Stream 版 DeepResearch。
 */
export function shouldUseEffectDeepResearch(config: { useEffectDeepResearch?: boolean }): boolean {
  return config?.useEffectDeepResearch === true;
}
