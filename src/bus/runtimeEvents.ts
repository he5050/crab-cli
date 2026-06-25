/**
 * Runtime 事件模块 — 定义跨传输层的统一 Runtime 事件。
 *
 * 职责:
 *   - 描述 Agent 运行时的全部事件类型
 *   - 提供与 ACP SessionNotification 的映射
 *   - 提供与旧版 SSE 事件的转换
 *
 * 模块功能:
 *   - RuntimeEvent: 统一事件联合类型
 *   - createRuntimeEvent: 构造带时间戳的事件
 *   - toAcpSessionUpdate: 转 ACP 通知
 *   - toLegacySseEvent: 转旧版 SSE 事件
 */
import type { SessionNotification } from "@agentclientprotocol/sdk/dist/schema";

interface RuntimeEventBase {
  sessionId?: string;
  createdAt: string;
}

export type RuntimeEvent =
  | (RuntimeEventBase & { type: "session.created"; sessionId: string })
  | (RuntimeEventBase & { type: "session.loaded"; sessionId: string })
  | (RuntimeEventBase & { type: "message.started"; sessionId: string; messageId: string })
  | (RuntimeEventBase & { type: "assistant.delta"; sessionId: string; messageId: string; text: string })
  | (RuntimeEventBase & {
      type: "tool.call.started";
      sessionId: string;
      toolCallId: string;
      name: string;
      input?: unknown;
    })
  | (RuntimeEventBase & { type: "tool.call.delta"; sessionId: string; toolCallId: string; delta: unknown })
  | (RuntimeEventBase & {
      type: "tool.call.completed";
      sessionId: string;
      toolCallId: string;
      name: string;
      result: unknown;
      success: boolean;
    })
  | (RuntimeEventBase & {
      type: "permission.requested";
      sessionId: string;
      requestId: string;
      tool?: string;
      patterns?: string[];
    })
  | (RuntimeEventBase & { type: "permission.resolved"; sessionId: string; requestId: string; approved: boolean })
  | (RuntimeEventBase & { type: "message.completed"; sessionId: string; messageId: string })
  | (RuntimeEventBase & { type: "message.cancelled"; sessionId: string; messageId?: string })
  | (RuntimeEventBase & { type: "error"; sessionId?: string; error: string; errorCode?: string });

export type RuntimeEventInput = RuntimeEvent extends infer Event
  ? Event extends RuntimeEvent
    ? Omit<Event, "createdAt">
    : never
  : never;

export interface LegacySseEvent {
  event: string;
  data: unknown;
}

export type AcpSessionUpdate = SessionNotification;

export function createRuntimeEvent(input: RuntimeEventInput): RuntimeEvent {
  return { ...input, createdAt: new Date().toISOString() } as RuntimeEvent;
}

export function toLegacySseEvent(event: RuntimeEvent): LegacySseEvent {
  switch (event.type) {
    case "session.created": {
      return { data: { sessionId: event.sessionId }, event: "sessionCreated" };
    }
    case "session.loaded": {
      return { data: { sessionId: event.sessionId }, event: "sessionLoaded" };
    }
    case "message.started": {
      return { data: { messageId: event.messageId, sessionId: event.sessionId }, event: "messageStarted" };
    }
    case "assistant.delta": {
      return { data: { messageId: event.messageId, sessionId: event.sessionId, token: event.text }, event: "token" };
    }
    case "tool.call.started": {
      return {
        data: { args: event.input, sessionId: event.sessionId, toolCallId: event.toolCallId, toolName: event.name },
        event: "toolCall",
      };
    }
    case "tool.call.delta": {
      return {
        data: { delta: event.delta, sessionId: event.sessionId, toolCallId: event.toolCallId },
        event: "toolCallDelta",
      };
    }
    case "tool.call.completed": {
      return {
        data: {
          result: event.result,
          sessionId: event.sessionId,
          success: event.success,
          toolCallId: event.toolCallId,
          toolName: event.name,
        },
        event: "toolResult",
      };
    }
    case "permission.requested": {
      return {
        data: { patterns: event.patterns, requestId: event.requestId, sessionId: event.sessionId, tool: event.tool },
        event: "permissionRequested",
      };
    }
    case "permission.resolved": {
      return {
        data: { approved: event.approved, requestId: event.requestId, sessionId: event.sessionId },
        event: "permissionResolved",
      };
    }
    case "message.completed": {
      return { data: { messageId: event.messageId, sessionId: event.sessionId, status: "completed" }, event: "done" };
    }
    case "message.cancelled": {
      return { data: { messageId: event.messageId, sessionId: event.sessionId }, event: "cancelled" };
    }
    case "error": {
      return { data: { errorCode: event.errorCode, message: event.error, sessionId: event.sessionId }, event: "error" };
    }
  }
}

export function toAcpSessionUpdate(event: RuntimeEvent): AcpSessionUpdate | undefined {
  if (!event.sessionId) {
    return undefined;
  }
  switch (event.type) {
    case "session.loaded": {
      return {
        sessionId: event.sessionId,
        update: {
          sessionUpdate: "session_info_update",
          updatedAt: event.createdAt,
        },
      };
    }
    case "assistant.delta": {
      return {
        sessionId: event.sessionId,
        update: {
          content: { text: event.text, type: "text" },
          messageId: event.messageId,
          sessionUpdate: "agent_message_chunk",
        },
      };
    }
    case "tool.call.started": {
      return {
        sessionId: event.sessionId,
        update: {
          rawInput: event.input,
          sessionUpdate: "tool_call_update",
          status: "in_progress",
          title: event.name,
          toolCallId: event.toolCallId,
        },
      };
    }
    case "tool.call.delta": {
      return {
        sessionId: event.sessionId,
        update: {
          rawOutput: event.delta,
          sessionUpdate: "tool_call_update",
          toolCallId: event.toolCallId,
        },
      };
    }
    case "tool.call.completed": {
      return {
        sessionId: event.sessionId,
        update: {
          rawOutput: event.result,
          sessionUpdate: "tool_call_update",
          status: event.success ? "completed" : "failed",
          title: event.name,
          toolCallId: event.toolCallId,
        },
      };
    }
    case "message.cancelled": {
      return {
        sessionId: event.sessionId,
        update: {
          content: { text: "Message cancelled.", type: "text" },
          messageId: event.messageId,
          sessionUpdate: "agent_message_chunk",
        },
      };
    }
    case "error": {
      return {
        sessionId: event.sessionId,
        update: {
          content: { text: event.error, type: "text" },
          sessionUpdate: "agent_message_chunk",
        },
      };
    }
    default: {
      return undefined;
    }
  }
}
