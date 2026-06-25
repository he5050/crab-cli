/**
 * Chat 共享类型 — 跨模块共享的对话域接口定义。
 *
 * 职责:
 *   - 定义 UI 层 ChatMessage 及其 Part 联合类型
 *   - 定义 ChatRuntimeOverrides（ConversationHandler 运行时覆盖项）
 *   - 定义 ChatContextValue 接口（Chat Provider 暴露的 API 表面）
 *   - 定义 ChatProviderProps（Chat Provider 的初始化参数）
 *
 * 模块功能:
 *   - ThinkingPart / TextPart / ToolPart — 消息 Part 联合类型
 *   - ChatMessage — UI 层消息条目（user / assistant / system）
 *   - ChatRuntimeOverrides — Agent/Config 生成的运行时覆盖项
 *   - ChatContextValue / ChatProviderProps — Context 的值类型和 Props 类型
 *
 * 使用场景:
 *   - ui/contexts/chat.tsx — 对话 Context 定义
 *   - session/adapter/index.ts — ChatMessage ↔ MessageRecord 格式转换
 *   - agent/prompt/runtimeOverrides.ts — 构建运行时覆盖项
 *   - ui/components/chat/ — 消息展示组件
 *
 * 边界:
 *   1. 仅包含类型定义，不含业务逻辑
 *   2. ChatMessage 是 UI 层表示，区别于数据层 MessageRecord（@session）
 *   3. ToolPart 合并了 tool_use + tool_result，区别于数据层拆分结构
 *   4. 瞬态字段（streaming / isError / interrupted）不持久化到 session store
 *
 * 迁移说明:
 *   从 ui/contexts/chatTypes.ts 迁移至此，消除 session→ui 和 agent→ui 的反向依赖。
 *   ui/contexts/chatTypes.ts 改为 re-export 以保持向后兼容。
 *
 * @since 2026-06-23 从 src/ui/contexts/chatTypes.ts 迁移
 */
import type { MessageFileReference, MessagePartTime } from "@/session";
import type { AgentInfo } from "@/agent";

/** 思考/推理部分 */
export interface ThinkingPart {
  /** Part 类型标识 */
  type: "thinking";
  /** 推理文本 */
  text: string;
  /** 附加元数据 */
  metadata?: Record<string, unknown>;
  /** 时间信息 */
  time?: MessagePartTime;
  /** 开始时间戳 */
  startedAt?: number;
  /** 结束时间戳 */
  endedAt?: number;
  /** 持续时间(ms) */
  durationMs?: number;
}

/** 文本部分（正文，用于 markdown 渲染） */
export interface TextPart {
  /** Part 类型标识 */
  type: "text";
  /** 正文文本 */
  text: string;
  /** 附加元数据 */
  metadata?: Record<string, unknown>;
  /** 时间信息 */
  time?: MessagePartTime;
}

/** 工具调用状态 */
export type ToolStatus = "calling" | "running" | "done" | "error";

/** 工具调用部分（合并了 tool_use + tool_result） */
export interface ToolPart {
  /** Part 类型标识 */
  type: "tool";
  /** 工具名称 */
  tool: string;
  /** 调用 ID */
  callId?: string;
  /** 是否成功 */
  success: boolean;
  /** 序列化的参数 */
  args?: string;
  /** 原始参数对象 */
  input?: unknown;
  /** 工具输出 */
  output?: string;
  /** 附加元数据 */
  metadata?: Record<string, unknown>;
  /** 关联的文件引用 */
  files?: MessageFileReference[];
  /** 诊断信息 */
  diagnostics?: unknown[];
  /** 子会话 ID（sub-agent 调用时） */
  subSessionId?: string;
  /** 开始时间戳 */
  startedAt?: number;
  /** 结束时间戳 */
  endedAt?: number;
  /** 时间信息 */
  time?: MessagePartTime;
  /** 持续时间(ms) */
  durationMs?: number;
  /** 错误详情 */
  detail?: string;
  /** 是否被截断 */
  truncated?: boolean;
  /** 输出文件路径 */
  outputPath?: string;
  /** 工具状态 */
  status?: ToolStatus;
}

/** 消息 Part 联合类型 */
export type ChatMessagePart = ThinkingPart | TextPart | ToolPart;

/**
 * 消息条目（UI 层表示）
 *
 * 注意: 与数据层 MessageRecord 不同 — ChatMessage 是 UI 展示格式，
 * MessageRecord 是持久化格式。瞬态字段（streaming/isError/interrupted）不会持久化。
 */
export interface ChatMessage {
  /** 消息唯一 ID */
  id: string;
  /** 角色: user / assistant / system */
  role: "user" | "assistant" | "system";
  /** 纯文本内容（用于快速展示） */
  content: string;
  /** 结构化 Part 列表（用于精确渲染） */
  parts?: ChatMessagePart[];
  /** 是否正在流式传输（瞬态，不持久化） */
  streaming?: boolean;
  /** 是否为错误消息（瞬态，不持久化） */
  isError?: boolean;
  /** 工具信息（瞬态，不持久化） */
  toolInfo?: { tool: string; success: boolean; detail?: string };
  /** 是否为中断的部分消息（瞬态，不持久化） */
  interrupted?: boolean;
}

/** ConversationHandler 运行时覆盖项 */
export interface ChatRuntimeOverrides {
  /** 系统提示词（含角色注入 + 技能索引提醒） */
  systemPrompt: string;
  /** 最大工具轮次 */
  maxToolRounds: number;
  /** 允许的工具白名单 */
  allowedTools?: string[];
  /** 已加载的技能列表 */
  loadedSkills: string[];
  /** LLM Provider ID */
  providerId?: string;
  /** 模型 ID */
  modelId?: string;
  /** 温度 */
  temperature?: number;
  /** Top-P */
  topP?: number;
}

/** Chat Context 值 — ChatProvider 暴露给子组件的 API 表面 */
export interface ChatContextValue {
  /** 消息列表（响应式 accessor） */
  messages: () => ChatMessage[];
  /** 是否正在处理中 */
  loading: () => boolean;
  /** 流式文本缓冲区 */
  streamingText: () => string;
  /** 流式推理缓冲区 */
  streamingReasoning: () => string;
  /** 发送用户消息 */
  send: (content: string) => Promise<void>;
  /** 中断当前处理 */
  interrupt: () => boolean;
  /** 清空对话历史 */
  clear: () => void;
  /** 当前 Agent 名称 */
  agentName: () => string;
  /** 当前 Agent 信息 */
  agentInfo: () => AgentInfo | undefined;
  /** 切换 Agent */
  switchAgent: (name: string) => boolean;
  /** 当前模式 */
  mode: () => string;
  /** Yolo 模式覆盖 */
  yoloOverlay: () => boolean;
  /** 获取完整对话历史（Vercel AI SDK 格式） */
  getConversationHistory: () => import("ai").ModelMessage[];
  /** 撤销上一步 */
  undo: () => boolean;
  /** 重做上一步 */
  redo: () => boolean;
  /** 是否可以撤销 */
  canUndo: () => boolean;
  /** 是否可以重做 */
  canRedo: () => boolean;
  /** 直接添加系统消息(不走 LLM，用于 Shell 模式等) */
  addSystemMessage: (content: string) => void;
}

/** Chat Provider Props */
export interface ChatProviderProps {
  config: import("./config").AppConfigSchema;
  sessionId?: string;
  [key: string]: unknown;
}
