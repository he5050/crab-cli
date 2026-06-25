/**
 * AI 对话事件 — Chat 流式响应、推理、Provider 状态、降级重试。
 *
 * 职责:定义与 LLM 推理链路直接相关的事件契约。
 * 边界:不感知 UI 层;Provider/Model 字段为字符串,具体类型由订阅方断言。
 */
import { defineEvent } from "../core";

export const ChatEvents = {
  /** AI 对话流式响应数据 */
  ChatChunk: defineEvent<{ chunk: string }>("chat.chunk"),

  /** AI 推理/思考流式数据 */
  ChatReasoning: defineEvent<{ chunk: string }>("chat.reasoning"),

  /** AI 调用状态变更(追踪当前 provider/model/method) */
  ProviderStatus: defineEvent<{
    provider: string;
    model: string;
    method: string;
    status: "calling" | "success" | "error";
    error?: string;
  }>("ai.provider.status"),

  /** LLM 降级重试事件(原 @api/llm → @session/sessionStatus 跨层调用) */
  LlmRetry: defineEvent<{
    sessionId: string;
    fallbackFrom: string;
    fallbackTo: string;
    reason: string;
  }>("ai.llm.retry"),
} as const;
