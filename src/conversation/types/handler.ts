/**
 * ConversationHandler 类型定义。
 *
 * 从 conversationHandler.ts 提取:
 *   - TokenUsage / ConversationResult
 *   - ToolInterceptor 相关类型
 *   - ConversationHandlerOptions
 *
 * 注意:运行时值（ConversationError、normalizeToolCallArgs 等）已移至:
 *   - core/conversationError.ts
 *   - message/toolCallHelpers.ts
 */
import type { ModelMessage } from "ai";
import type { ChatMode } from "@/agent/prompt/modes";
import type { TokenUsage } from "@/session/type";
import type { EventBus } from "@/bus";
import type { PermissionAskInput, ApprovalAction } from "@/permission";
import type { ToolContext } from "@/tool/types";

export type { TokenUsage };

// ─── 对话结果 ──────────────────────────────────────────────────

export interface ConversationResult {
  text: string;
  ok: boolean;
  error?: string;
  toolRounds: number;
  reasoning?: string;
  usage?: TokenUsage;
  goalContinuation?: boolean;
}

// ─── 工具拦截器 ──────────────────────────────────────────────────

export interface ToolInterceptorContext {
  instanceId?: string;
  [key: string]: unknown;
}

export interface ToolInterceptorResult {
  handled: boolean;
  output?: unknown;
  isError?: boolean;
}

export type ToolInterceptor = (
  toolName: string,
  toolCallId: string,
  args: unknown,
  context: ToolInterceptorContext,
) => Promise<ToolInterceptorResult>;

// ─── 对话处理器配置 ──────────────────────────────────────────

export interface ConversationHandlerOptions {
  maxToolRounds?: number;
  systemPrompt?: string;
  abortSignal?: AbortSignal;
  sessionId?: string;
  initialMessages?: ModelMessage[];
  compactionConfig?: Partial<import("@/compress/conversation").CompactionConfig>;
  allowedTools?: string[];
  mode?: ChatMode;
  providerId?: string;
  modelId?: string;
  temperature?: number;
  topP?: number;
  toolInterceptor?: ToolInterceptor;
  toolInterceptorContext?: ToolInterceptorContext;
  streamFn?: typeof import("@api").streamLlm;
  permissionRequestHandler?: (input: PermissionAskInput) => Promise<ApprovalAction | boolean>;
  getToolContext?: () => ToolContext;
  eventBus?: EventBus;
}
