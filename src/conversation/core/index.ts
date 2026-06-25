// ─── 对话专用错误 ──────────────────────────────────────────
export { ConversationError } from "./conversationError";

// ─── MCP 工具变更追踪器 ──────────────────────────────────
export { McpToolChangeTracker, type McpToolChangeNotice, type ReminderFormatter } from "./mcpToolChangeTracker";

// ─── 核心对话处理器 ──────────────────────────────────────────
export {
  ConversationHandler,
  createConversationHandler,
  type ConversationResult,
  type TokenUsage,
  type ConversationHandlerOptions,
  type ToolInterceptor,
  type ToolInterceptorContext,
  type ToolInterceptorResult,
} from "./conversationHandler";

// ─── LLM 执行循环 ────────────────────────────────────────────
export {
  executeLlmLoop,
  type LlmLoopOptions,
  type LlmLoopResult,
  type StreamEvent,
  type StreamEventType,
  type ToolCallItem,
  type ToolExecutionContext,
  type ToolExecutionResult,
  type LlmLoopCallbacks,
  type MessageCompressor,
} from "./llmLoop";

// ─── LLM Stream 适配器(P2-A6) ──────────────────────────────
export { executeLlmLoopWithStream, asyncIterableToStream, streamToAsyncIterable } from "./llmStreamAdapter";

// ─── 工具调用循环 ──────────────────────────────────────────
export {
  executeToolCallRound,
  toToolCallRequests,
  type ToolCallRequest,
  type ToolCallExecutionResult,
  type ToolCallLoopOptions,
  type ToolExecutor as ToolCallExecutor,
} from "./toolCallLoop";

// ─── LLM Loop 装配适配器 ────────────────────────────────
export {
  buildConversationLlmLoopCallbacks,
  buildConversationLlmLoopOptions,
  type BuildConversationLlmLoopCallbacksInput,
  type BuildConversationLlmLoopOptionsInput,
} from "./llmLoopAdapter";

// ─── 工具执行管线 ──────────────────────────────────────────
export { executeToolCalls, type HandlerContext } from "./toolExecution";

// ─── 工具运行时适配器 ────────────────────────────────────
export { buildConversationToolExecutor, type BuildConversationToolExecutorInput } from "./toolRuntimeAdapter";

// ─── Goal 集成 ───────────────────────────────────────────
export {
  injectGoalContinuation,
  handleGoalPostTurn,
  pauseGoalOnAbort,
  type GoalManagerAdapter,
} from "./goalIntegration";

// ─── 回合生命周期编排 ────────────────────────────────────
export {
  cleanupConversationTurn,
  createAbortedConversationResult,
  createBusyConversationResult,
  finalizeConversationTurn,
  prepareConversationTurn,
  type BusyConversationResult,
  type ConversationTurnLifecycle,
  type FinalizeConversationTurnOptions,
  type PrepareConversationTurnOptions,
  type PreparedConversationTurn,
} from "./turnLifecycleCoordinator";
