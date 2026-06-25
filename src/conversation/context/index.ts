// ─── 上下文注入 ──────────────────────────────────────────────────
export { buildCodebaseContext, injectContextToMessage } from "./contextInjector";

// ─── 对话准备 ────────────────────────────────────────────────────
export { prepareConversation, type ConversationSetupResult } from "./conversationSetup";

// ─── 会话状态管理器 ────────────────────────────────────────────
export { SessionToolState, type ToolSessionSnapshot } from "./sessionToolState";
export { LlmConfigState, type LlmConfigSnapshot } from "./llmConfig";
export { DriverEventEmitter } from "./driverEventEmitter";
export { ToolSetup } from "./toolSetup";
export { CompactionManager } from "./compactionManager";

// ─── 会话状态纯函数(向后兼容，推荐通过 SessionToolState 使用) ────
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
} from "./conversationSessionState";

// ─── 系统提示词 ──────────────────────────────────────────────────
export { getEffectiveSystemPrompt } from "./systemPrompt";
export type { SystemPromptState } from "./systemPrompt";
