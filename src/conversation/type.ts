/**
 * 对话管理 — 类型导出入口。
 *
 * 仅导出类型定义（不包含运行时值），供只依赖类型的模块使用。
 * 运行时值请从 `@conversation`（index.ts）导入。
 */

// ─── 核心类型 ────────────────────────────────────────────────────
export type {
  ConversationMessage,
  ConversationUsage,
  ConversationOptions,
  StreamRoundResult,
  ToolCallRoundResult,
} from "./types";

// ─── 消息片段类型 ────────────────────────────────────────────────
export type {
  MessagePart,
  TextMessagePart,
  ToolMessagePart,
  ThinkingMessagePart,
  ImageMessagePart,
  FileMessagePart,
} from "./types";

// ─── 工具类型 ────────────────────────────────────────────────────
export type { ToolCallState, ToolCallInfo, TokenInfo } from "./types";

// ─── 流式回调 ────────────────────────────────────────────────────
export type { StreamCallbacks } from "./types";

// ─── Handler 类型 ─────────────────────────────────────────────────
export type {
  TokenUsage,
  ConversationResult,
  ConversationHandlerOptions,
  ToolInterceptor,
  ToolInterceptorContext,
  ToolInterceptorResult,
} from "./types";

// ─── LLM 循环类型 ─────────────────────────────────────────────────
export type {
  StreamLlmFunction,
  LlmLoopOptions,
  ToolCallItem,
  StreamEventType,
  StreamEvent,
  LlmLoopResult,
  ToolExecutor,
  ToolExecutionContext,
  ToolExecutionResult,
  LlmLoopCallbacks,
  MessageCompressor,
} from "./types";

// ─── Driver 接口 ──────────────────────────────────────────────────
export type {
  ConversationDriverEvent,
  ConversationDriverListener,
  SendMessageOptions,
  ConversationDriver,
} from "./types";

// ─── 压缩类型 ────────────────────────────────────────────────────
export type { CompactionConfig, CompactionResult } from "@/compress/conversation";

// ─── 消息构建 ────────────────────────────────────────────────────
export type { MessageBuilderOptions } from "./message";

// ─── 思维提取 ────────────────────────────────────────────────────
export type { ThinkingData, ReasoningData } from "./message";

// ─── 消息片段守卫 ────────────────────────────────────────────────
export type { ToolCallLikePart, ToolResultLikePart } from "./message";

// ─── 死循环类型 ──────────────────────────────────────────────────
export type { DoomLoopState, DoomLoopConfig, DoomLoopCheckResult } from "./guard";

// ─── 处理锁 ─────────────────────────────────────────────────────
export type { ProcessingGuardOptions } from "./guard";

// ─── LLM 工具 schema ─────────────────────────────────────────────
export type { LlmToolSchema } from "./types";

// ─── 对话准备 ────────────────────────────────────────────────────
export type { ConversationSetupResult } from "./context";

// ─── 会话状态 ────────────────────────────────────────────────────
export type { ConversationSessionState } from "./context";

// ─── 系统提示词 ──────────────────────────────────────────────────
export type { SystemPromptState } from "./context";

// ─── 停止处理 ────────────────────────────────────────────────────
export type { StopHookResult } from "./lifecycle";

// ─── 工具执行 ────────────────────────────────────────────────────
export type {
  HandlerContext,
  ToolCallRequest,
  ToolCallExecutionResult,
  ToolCallLoopOptions,
  GoalManagerAdapter,
} from "./core";

// ─── 空闲超时守卫 ────────────────────────────────────────────────
export type { IdleTimeoutGuard } from "./stream";

// ─── Agent 状态 ──────────────────────────────────────────────────
export type { AgentRuntimeState } from "@/agent";
