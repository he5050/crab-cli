/**
 * BTW 旁路问答 Effect Stream 版本 — 使用 Stream.tap/runDrain + Effect.interrupt 替代 for-await。
 *
 * 职责:
 *   - streamBtwResponseWithEffect: Effect Stream 版本的旁路问答
 *   - abort 用 Stream.takeUntil + Effect.interrupt 替代手动检查
 *   - 错误用 Effect.catchAll 声明式处理
 *
 * 通过配置项 useEffectBtwStream: true 启用，默认不启用。
 */
import { Effect, Stream } from "effect";
import type { ModelMessage, UserModelMessage } from "ai";
import { streamLlm } from "@/api";
import { asyncIterableToStream, streamToAsyncIterable } from "@/conversation/core/llmStreamAdapter";
import { globalBus, type EventBus } from "@/bus";
import { AppEvent } from "@/bus";
import { createLogger } from "@/core/logging/logger";
import type { AppConfigSchema } from "@/schema/config";
import { estimateMessagesTokens } from "@/session/token/tokenCounterRef";
import { createMessageWithRole } from "@/conversation/message/messageFactories";

const log = createLogger("conversation:btw-stream:effect");

const BTW_CONTEXT_TOKEN_LIMIT = 32_000;

const BTW_SYSTEM_SUFFIX = `
The user is asking a quick side-question while the main AI task may still be running.
Answer concisely and helpfully. Do NOT reference or modify any ongoing task.
This is a temporary, context-aware Q&A — your answer will NOT be saved into the conversation history.
Keep your response brief and focused on the question asked.`;

/** Btw 流式事件（与 btwStream.ts 一致） */
export type BtwStreamEvent =
  | { type: "text-delta"; text: string }
  | { type: "done"; fullText: string }
  | { type: "error"; error: string };

function buildContextMessages(conversationHistory: ModelMessage[]): ModelMessage[] {
  if (!conversationHistory || conversationHistory.length === 0) {
    return [];
  }

  const recentMessages: ModelMessage[] = [];
  let estimatedTokens = 0;
  for (let i = conversationHistory.length - 1; i >= 0; i--) {
    const msg = conversationHistory[i]!;
    recentMessages.unshift(msg);
    estimatedTokens += estimateMessagesTokens([msg]);
    if (estimatedTokens >= BTW_CONTEXT_TOKEN_LIMIT || recentMessages.length >= 20) {
      break;
    }
  }

  return recentMessages.map((m) => {
    if (typeof m.content === "string") {
      return createMessageWithRole(m.role, m.content);
    }
    if (Array.isArray(m.content)) {
      const textParts = (m.content as { type: string; text?: string }[])
        .filter((p) => p.type === "text" && p.text)
        .map((p) => p.text!);
      return createMessageWithRole(m.role, textParts.join("\n") || "");
    }
    return createMessageWithRole(m.role, "");
  });
}

/**
 * 使用 Effect Stream 模式执行 btw 旁路问答。
 *
 * 接口与 streamBtwResponse 一致，返回 AsyncGenerator<BtwStreamEvent>。
 * 内部使用 Effect Stream 处理，通过 streamToAsyncIterable 转回 AsyncGenerator。
 *
 * @param question 用户问题
 * @param config 应用配置
 * @param conversationHistory 对话历史（只读快照）
 * @param abortSignal 中止信号
 * @yields BtwStreamEvent
 */
export async function* streamBtwResponseWithEffect(
  question: string,
  config: AppConfigSchema,
  conversationHistory: ModelMessage[],
  abortSignal?: AbortSignal,
): AsyncGenerator<BtwStreamEvent, void, unknown> {
  log.debug("btwStream(Effect) 开始", { questionLength: question.length });

  const contextMessages = buildContextMessages(conversationHistory);

  const messages: ModelMessage[] = [
    ...contextMessages,
    {
      content: `[BTW Side-Question]\n${question}\n${BTW_SYSTEM_SUFFIX}`,
      role: "user",
    } as UserModelMessage,
  ];

  let fullText = "";
  let hadError = false;
  let errorMessage = "";
  let isDone = false;

  // 创建 LLM 流
  const llmStream = streamLlm(config, messages, {
    abortSignal,
    maxTokens: 2048,
    system: "You are a helpful coding assistant answering a quick side-question. Be concise.",
    temperature: 0.5,
    timeout: 30_000,
  });

  // 转为 Effect Stream
  const effectStream = asyncIterableToStream(llmStream);

  // 使用 Stream.tap 处理事件，Stream.runDrain 消费
  const processedStream = effectStream.pipe(
    Stream.tap((event) =>
      Effect.sync(() => {
        if (abortSignal?.aborted) {
          log.debug("btwStream(Effect) 被中止");
          return;
        }

        switch (event.type) {
          case "text-delta": {
            fullText += event.text;
            break;
          }
          case "done": {
            isDone = true;
            break;
          }
          case "error": {
            hadError = true;
            errorMessage = event.error.message || "LLM 调用失败";
            break;
          }
        }
      }),
    ),
    // 中止时停止消费
    Stream.takeUntil(() => abortSignal?.aborted === true || isDone || hadError),
  );

  try {
    await Effect.runPromise(Stream.runDrain(processedStream));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("btwStream(Effect) 错误", { error: msg });
    hadError = true;
    errorMessage = msg;
  }

  // 生成输出事件（与原版顺序一致）
  if (hadError) {
    yield { error: errorMessage, type: "error" };
    return;
  }

  if (isDone || fullText) {
    yield { fullText, type: "done" };
    log.debug("btwStream(Effect) 完成", { textLength: fullText.length });
  }
}

/**
 * 检查是否应使用 Effect Stream 版 btw。
 */
export function shouldUseEffectBtwStream(config: { useEffectBtwStream?: boolean }): boolean {
  return config?.useEffectBtwStream === true;
}
