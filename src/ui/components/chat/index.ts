/**
 * Chat Components Module
 *
 * 职责:
 *   - 导出对话界面相关组件
 *   - 统一管理聊天模块的公共接口
 *
 * 模块功能:
 *   - 导出 CodebaseSearchStatus 组件(代码库搜索状态显示)
 *   - 导出 PendingMessages 组件(待处理消息预览)
 *   - 导出 PendingToolCalls 组件(待执行工具调用显示)
 *   - 导出 UserMessagePreview 组件(用户消息预览)
 *   - 提供各组件对应的 Props 类型定义
 *
 * 使用场景:
 *   - 对话界面需要显示搜索状态
 *   - 显示待发送消息队列
 *   - 显示工具调用执行状态
 *   - 预览用户输入消息
 *
 * 边界:
 *   1. 仅包含与对话界面相关的组件
 *   2. 各组件独立管理自身状态和逻辑
 *
 * 流程:
 *   1. 从各子模块导入组件和类型
 *   2. 统一导出供外部使用
 */

// CodebaseSearchStatus — 代码库搜索状态显示
export {
  CodebaseSearchStatus,
  CodebaseSearchStatusCompact,
  type SearchStatus,
  type CodebaseSearchStatusProps,
} from "./CodebaseSearchStatus";

// PendingMessages — 待处理消息预览
export {
  PendingMessages,
  PendingMessagesCompact,
  type PendingMessage,
  type PendingMessagesProps,
} from "./PendingMessages";

// PendingToolCalls — 待执行工具调用显示
export {
  PendingToolCalls,
  PendingToolCallsCompact,
  type ToolCallStatus,
  type PendingToolCall,
  type PendingToolCallsProps,
} from "./PendingToolCalls";

// UserMessagePreview — 用户消息预览
export {
  UserMessagePreview,
  UserMessagePreviewCompact,
  UserInput,
  type ImageAttachment,
  type UserMessagePreviewProps,
  type UserInputProps,
} from "./UserMessagePreview";
