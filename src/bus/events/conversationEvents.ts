/**
 * 对话事件 — Conversation 引擎层的消息/流式/工具调用/完成/中止事件。
 *
 * 职责:定义 Phase 18 对话引擎对外的事件契约。
 * 边界:files/diagnostics/time 等域字段保留为 unknown,详细类型由订阅方断言。
 */
import { defineEvent } from "../core";
import type { ToolCallBase } from "./common";

export const ConversationEvents = {
  /** 对话消息已发送 */
  ConversationMessageSent: defineEvent<{
    sessionId?: string;
    content: string;
    role: "user" | "assistant";
    messageId?: string;
  }>("conversation.message.sent"),

  /** 对话流式 Token */
  ConversationStreamToken: defineEvent<{
    sessionId?: string;
    tokenCount: number;
    content: string;
  }>("conversation.stream.token"),

  /** 对话工具调用 */
  ConversationToolCall: defineEvent<ToolCallBase & { sessionId?: string }>("conversation.tool.call"),

  /** 对话完成 */
  ConversationCompleted: defineEvent<{
    sessionId?: string;
    ok: boolean;
    toolRounds: number;
    textLength: number;
    durationMs: number;
    error?: string;
    usage?: unknown;
  }>("conversation.completed"),

  /** 对话中止 */
  ConversationAborted: defineEvent<{
    sessionId?: string;
    reason?: string;
  }>("conversation.aborted"),
} as const;
