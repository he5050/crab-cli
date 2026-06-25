/**
 * 对话管理模块 — 公共导出。
 *
 * 模块结构:
 *   - types/        — 类型定义（消息、Handler、LLM 循环、Driver）
 *   - core/         — 核心引擎（Handler、LLM 循环、工具循环、工具执行）
 *   - stream/       — 流式处理（流处理器、旁路问答、超时守卫）
 *   - message/      — 消息处理（构建器、工厂、思维提取、类型守卫、工具调用辅助）
 *   - context/      — 上下文管理（注入、准备、会话状态、系统提示词）
 *   - lifecycle/    — 生命周期（停止处理、摘要生成、使用记忆）
 *   - compaction/   — 上下文压缩（压缩策略、Token 估算）
 *   - guard/        — 安全守卫（死循环检测、处理锁、LLM 配置）
 */

// ─── 核心对话处理器 ──────────────────────────────────────────────
export {
  ConversationHandler,
  createConversationHandler,
  ConversationError,
  type ConversationResult,
  type TokenUsage,
  type ConversationHandlerOptions,
  type ToolInterceptor,
  type ToolInterceptorContext,
  type ToolInterceptorResult,
} from "./core";

// ─── 类型定义 ────────────────────────────────────────────────────
export type {
  ConversationMessage,
  ConversationUsage,
  ConversationOptions,
  StreamRoundResult,
  ToolCallRoundResult,
  MessagePart,
  TextMessagePart,
  ToolMessagePart,
  ThinkingMessagePart,
  ImageMessagePart,
  FileMessagePart,
  ToolCallState,
  ToolCallInfo,
  TokenInfo,
  StreamCallbacks,
} from "./types";

// ─── 流式处理 ──────────────────────────────────────────────────
export { processStream, mergeUsage } from "./stream";

// ─── 工具调用循环 ────────────────────────────────────────────────
export {
  executeToolCallRound,
  toToolCallRequests,
  type ToolCallRequest,
  type ToolCallExecutionResult,
  type ToolCallLoopOptions,
} from "./core";

// ─── 消息处理 ──────────────────────────────────────────────────
export { toModelMessages, buildParts, cleanOrphanedToolCallsFromModel, type MessageBuilderOptions } from "./message";
export {
  createUserMessage,
  createTextAssistantMessage,
  createSystemMessage,
  createToolResultMessage,
  createMultiToolResultMessage,
  createPartsAssistantMessage,
  createToolErrorMessage,
  buildAssistantParts,
  rebuildAssistantContent,
  rebuildToolContent,
  createModelMessageFromRecord,
  textPart,
  toolCallPart,
} from "./message";
export {
  extractThinkingContent,
  extractReasoningAsThinking,
  cleanThinkingContent,
  type ThinkingData,
  type ReasoningData,
} from "./message";
export { isToolCallPart, isToolResultPart, type ToolCallLikePart, type ToolResultLikePart } from "./message";

// ─── 上下文注入 ──────────────────────────────────────────────────
export { buildCodebaseContext, injectContextToMessage } from "./context";

// ─── 对话准备 ────────────────────────────────────────────────────
export { prepareConversation, type ConversationSetupResult } from "./context";

// ─── 会话状态 ────────────────────────────────────────────────────
export {
  getToolsForLlm,
  getAllowedToolsForExecution,
  buildSessionDynamicReminder,
  enableExternalToolForSession,
  enableExplicitExternalToolsFromText,
  enableExternalToolsFromDiscoveryResult,
  enableSkillForSession,
  enableSkillsFromToolResult,
  type ConversationSessionState,
} from "./context";

// ─── 系统提示词 ──────────────────────────────────────────────────
export { getEffectiveSystemPrompt, type SystemPromptState } from "./context";

// ─── 停止处理 ────────────────────────────────────────────────────
export { handleStopHook, type StopHookResult } from "./lifecycle";

// ─── 上下文压缩 ──────────────────────────────────────────────────
export {
  maybeCompact,
  truncateToolOutputs,
  findSplitIndex,
  DEFAULT_COMPACTION_CONFIG,
  estimateMessagesTokens,
  estimateTokens,
  type CompactionConfig,
  type CompactionResult,
} from "@/compress/conversation";

// ─── 摘要生成 ────────────────────────────────────────────────────
export { serializeMessages, generateSummary } from "./lifecycle";

// ─── 死循环检测 ──────────────────────────────────────────────────
export {
  createDoomLoopState,
  DEFAULT_DOOM_LOOP_THRESHOLD,
  DEFAULT_SEQUENCE_WINDOW_SIZE,
  DEFAULT_MAX_TOTAL_ROUNDS,
  detectDoomLoop,
  type DoomLoopState,
} from "./guard";

// ─── 死循环策略 ──────────────────────────────────────────────────
export { resolveDoomLoopThreshold, checkDoomLoop, type DoomLoopConfig, type DoomLoopCheckResult } from "./guard";

// ─── 处理锁 ─────────────────────────────────────────────────────
export { ProcessingGuard, type ProcessingGuardOptions } from "./guard";

// ─── 工具执行管线 ────────────────────────────────────────────────
export { executeToolCalls, type HandlerContext } from "./core";

// ─── Goal 集成 ───────────────────────────────────────────────────
export { injectGoalContinuation, handleGoalPostTurn, pauseGoalOnAbort, type GoalManagerAdapter } from "./core";

// ─── 旁路问答 ──────────────────────────────────────────────────
export { executeBtwStream } from "./stream";

// ─── 对话使用记忆 ─────────────────────────────────────────────────
export { recordConversationToolUsage } from "./lifecycle";

// ─── Agent 状态 ──────────────────────────────────────────────────
export {
  clearAgentState,
  findRecoverableSessions,
  loadAgentState,
  saveAgentState,
  cleanupExpiredStates,
  type AgentRuntimeState,
} from "@/agent";

// ─── 归一化工具 ──────────────────────────────────────────────────
export { normalizeToolCallArgs, toToolResultOutput, tryParseToolArgsJson } from "./message";
