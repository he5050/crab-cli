import { AppEvent, type EventBus } from "@/bus";
import type { LlmLoopCallbacks, LlmLoopOptions, LlmToolSchema, ToolCallItem } from "../types/loop";
import { normalizeToolCallArgs } from "../message/toolCallHelpers";

export interface BuildConversationLlmLoopOptionsInput {
  abortSignal?: AbortSignal;
  allowedTools?: string[];
  doomLoopThreshold?: number;
  getSystem: () => string | undefined;
  getTools: () => Record<string, LlmToolSchema> | undefined;
  maxRounds: number;
  modelId?: string;
  providerId?: string;
  sessionId?: string;
  streamFn: typeof import("@api").streamLlm;
  temperature?: number;
  timeout?: number;
  topP?: number;
  turnId: string;
}

export interface BuildConversationLlmLoopCallbacksInput {
  eventBus: EventBus;
  logError: (error: Error, turnId: string) => void;
  sessionId?: string;
  turnId: string;
}

export function buildConversationLlmLoopOptions(input: BuildConversationLlmLoopOptionsInput): LlmLoopOptions {
  return {
    abortSignal: input.abortSignal,
    allowedTools: input.allowedTools,
    doomLoopThreshold: input.doomLoopThreshold,
    getSystem: input.getSystem,
    getTools: input.getTools,
    maxRounds: input.maxRounds,
    modelId: input.modelId,
    providerId: input.providerId,
    sessionId: input.sessionId,
    streamFn: input.streamFn,
    system: input.getSystem(),
    temperature: input.temperature,
    timeout: input.timeout,
    tools: input.getTools(),
    topP: input.topP,
    turnId: input.turnId,
  };
}

export function buildConversationLlmLoopCallbacks(input: BuildConversationLlmLoopCallbacksInput): LlmLoopCallbacks {
  return {
    onError: (error: Error) => {
      input.logError(error, input.turnId);
    },
    onTextDelta: (text: string) => {
      input.eventBus.publish(
        AppEvent.ConversationStreamToken,
        {
          content: text,
          sessionId: input.sessionId,
          tokenCount: text.length,
        },
        { throttle: false },
      );
    },
    onThinkingDelta: (text: string) => {
      input.eventBus.publish(AppEvent.ChatReasoning, { chunk: text }, { throttle: false });
    },
    onToolCall: (call: ToolCallItem) => {
      const normalizedArgs = normalizeToolCallArgs(call.args);
      const startedAt = Date.now();
      input.eventBus.publish(AppEvent.ToolCall, {
        args: normalizedArgs,
        callId: call.toolCallId,
        metadata: { round: 0 },
        startedAt,
        tool: call.toolName,
      });
      input.eventBus.publish(AppEvent.ConversationToolCall, {
        args: normalizedArgs,
        callId: call.toolCallId,
        metadata: { round: 0 },
        sessionId: input.sessionId,
        startedAt,
        tool: call.toolName,
      });
    },
  };
}
