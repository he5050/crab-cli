// ─── 消息构建 ────────────────────────────────────────────────────
export { toModelMessages, buildParts, cleanOrphanedToolCallsFromModel } from "./messageBuilder";
export type { MessageBuilderOptions } from "./messageBuilder";

// ─── 消息工厂 ────────────────────────────────────────────────────
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
} from "./messageFactories";

// ─── 思维链提取 ──────────────────────────────────────────────────
export { extractThinkingContent, extractReasoningAsThinking, cleanThinkingContent } from "./thinkingExtractor";
export type { ThinkingData, ReasoningData } from "./thinkingExtractor";

// ─── 消息片段守卫 ─────────────────────────────────────────────────
export { isToolCallPart, isToolResultPart } from "./messagePartGuards";
export type { ToolCallLikePart, ToolResultLikePart } from "./messagePartGuards";

// ─── 工具调用辅助 ───────────────────────────────────────────────
export { toToolResultOutput, tryParseToolArgsJson, normalizeToolCallArgs } from "./toolCallHelpers";
