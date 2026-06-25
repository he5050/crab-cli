/**
 * 旁路问答(BTW Stream)— 流式旁路问答。
 *
 * 职责:
 *   - 在主对话运行时提供独立的 side-question 回答
 *   - 回答不写入对话历史
 *   - 不中断主对话流程
 *
 * 模块功能:
 *   - streamBtwResponse(): 异步生成器版本
 *   - executeBtwStream(): 通过 EventBus 分发事件版本
 *
 * 使用场景:
 *   - 主对话运行或空闲时的快速问答
 *   - 不需要持久化的临时问题
 *
 * 边界:
 * 1. 使用只读快照构建上下文，不修改原始对话历史
 * 2. 回答通过 AppEvent.BtwStreamChunk 事件分发
 * 3. 最多使用最近 20 条消息作为上下文
 *
 * 流程:
 * 1. 构建只读上下文消息(过滤 tool 相关字段)
 * 2. 调用 streamLlm 生成回答
 * 3. 通过 EventBus 分发流式文本片段
 */
import type { ModelMessage, UserModelMessage } from "ai";
import { streamLlm } from "@/api";
import { globalBus, type EventBus } from "@/bus";
import { AppEvent } from "@/bus";
import { createLogger } from "@/core/logging/logger";
import type { AppConfigSchema } from "@/schema/config";
import { estimateMessagesTokens } from "@/session/token/tokenCounterRef";
import { createMessageWithRole } from "@/conversation/message/messageFactories";

const log = createLogger("conversation:btw-stream");

/** Btw 系统提示后缀 */
const BTW_SYSTEM_SUFFIX = `
The user is asking a quick side-question while the main AI task may still be running.
Answer concisely and helpfully. Do NOT reference or modify any ongoing task.
This is a temporary, context-aware Q&A — your answer will NOT be saved into the conversation history.
Keep your response brief and focused on the question asked.`;

/** Btw 流式事件 */
export type BtwStreamEvent =
  | { type: "text-delta"; text: string }
  | { type: "done"; fullText: string }
  | { type: "error"; error: string };

/**
 * 构建当前会话上下文消息(只读快照)。
 *
 * 将现有对话历史映射为 LLM messages 供 btw 调用参考。
 * 不会修改原始对话历史。
 */
/** btw 上下文 token 上限(约 32K tokens，保守值避免超窗口) */
const BTW_CONTEXT_TOKEN_LIMIT = 32_000;

function buildContextMessages(conversationHistory: ModelMessage[]): ModelMessage[] {
  if (!conversationHistory || conversationHistory.length === 0) {
    return [];
  }

  // 取最近的消息作为上下文，同时限制 token 数避免超窗口
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
    // 只保留 role 和 content，过滤掉 tool 相关字段(btw 不需要执行工具)
    if (typeof m.content === "string") {
      return createMessageWithRole(m.role, m.content);
    }
    // 数组 content:提取文本部分合并为纯文本
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
 * 流式执行 btw 旁路问答。
 *
 * @param question - 用户的问题
 * @param config - 应用配置
 * @param conversationHistory - 当前对话历史(只读快照)
 * @param abortSignal - 可选的中止信号
 * @yields BtwStreamEvent
 */
export async function* streamBtwResponse(
  question: string,
  config: AppConfigSchema,
  conversationHistory: ModelMessage[],
  abortSignal?: AbortSignal,
): AsyncGenerator<BtwStreamEvent, void, unknown> {
  log.debug("btwStream 开始", { questionLength: question.length });

  const contextMessages = buildContextMessages(conversationHistory);

  const messages: ModelMessage[] = [
    ...contextMessages,
    {
      content: `[BTW Side-Question]\n${question}\n${BTW_SYSTEM_SUFFIX}`,
      role: "user",
    } as UserModelMessage,
  ];

  let fullText = "";

  try {
    const stream = streamLlm(config, messages, {
      abortSignal,
      maxTokens: 2048,
      system: "You are a helpful coding assistant answering a quick side-question. Be concise.",
      temperature: 0.5,
      timeout: 30_000,
    });

    for await (const event of stream) {
      if (abortSignal?.aborted) {
        log.debug("btwStream 被中止");
        break;
      }

      if (event.type === "text-delta") {
        fullText += event.text;
        yield { text: event.text, type: "text-delta" };
      } else if (event.type === "done") {
        // 流完成
        yield { fullText, type: "done" };
        log.debug("btwStream 完成", { textLength: fullText.length });
        return;
      } else if (event.type === "error") {
        yield { error: event.error.message || "LLM 调用失败", type: "error" };
        return;
      }
      // 忽略 reasoning-delta 和 tool-call(btw 不需要)
    }

    // 如果流正常结束但没有 done 事件，手动发送
    if (fullText) {
      yield { fullText, type: "done" };
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error("btwStream 错误", { error: msg });
    yield { error: msg, type: "error" };
  }
}

/**
 * 执行 btw 流式问答并通过 EventBus 分发事件(非生成器版本，供命令调用)。
 *
 * @returns 完整的回答文本
 */
export async function executeBtwStream(
  question: string,
  config: AppConfigSchema,
  conversationHistory: ModelMessage[],
  abortSignal?: AbortSignal,
  eventBus: EventBus = globalBus,
): Promise<string> {
  let fullText = "";

  for await (const event of streamBtwResponse(question, config, conversationHistory, abortSignal)) {
    if (event.type === "text-delta") {
      fullText += event.text;
      // 通过 EventBus 分发流式文本片段
      eventBus.publish(AppEvent.BtwStreamChunk, {
        chunk: event.text,
        done: false,
      });
    } else if (event.type === "done") {
      eventBus.publish(AppEvent.BtwStreamChunk, {
        chunk: "",
        done: true,
        fullText: event.fullText,
      });
    } else if (event.type === "error") {
      eventBus.publish(AppEvent.BtwStreamChunk, {
        chunk: "",
        done: true,
        error: event.error,
      });
    }
  }

  return fullText;
}
