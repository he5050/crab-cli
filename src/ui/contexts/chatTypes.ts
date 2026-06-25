/**
 * Chat Context 类型定义 — 对话域共享的接口与枚举。
 *
 * 职责:
 *   - 定义消息 Part 联合类型(thinking/text/tool)
 *   - 定义 ChatMessage 结构与 ChatContextValue 接口
 *   - 定义运行时覆盖项 ChatRuntimeOverrides
 *
 * 边界:
 *   1. 本文件为 re-export 层，实际类型定义在 @/schema/chat
 *   2. 迁移说明见 @/schema/chat 的 JSDoc
 */
export type {
  ThinkingPart,
  TextPart,
  ToolPart,
  ToolStatus,
  ChatMessagePart,
  ChatMessage,
  ChatRuntimeOverrides,
  ChatContextValue,
  ChatProviderProps,
} from "@/schema/chat";
