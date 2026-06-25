/**
 * 对话管理类型定义 — 结构化消息 + 工具状态 + 对话选项。
 *
 * 职责:
 *   - 定义对话相关的类型和接口
 *   - 结构化消息 Part 类型
 *   - 工具调用状态类型
 *   - 对话消息类型
 *   - Token 使用量类型
 *
 * 模块功能:
 *   - TextMessagePart: 文本消息 Part 类型
 *   - ToolMessagePart: 工具消息 Part 类型
 *   - ThinkingMessagePart: 思考消息 Part 类型
 *   - ImageMessagePart: 图片消息 Part 类型
 *   - FileMessagePart: 文件消息 Part 类型
 *   - MessagePart: 消息 Part 联合类型
 *   - ToolCallState: 工具调用状态类型
 *   - ConversationMessage: 对话消息类型
 *   - ConversationOptions: 对话选项类型
 *   - ConversationUsage: 对话使用量类型
 *   - ToolCallInfo: 工具调用信息类型
 *   - ToolCallRoundResult: 工具调用轮次结果类型
 *
 * 使用场景:
 *   - 对话消息构建
 *   - 工具调用状态管理
 *   - Token 使用量统计
 *   - 消息类型转换
 *
 * 边界:
 *   1. 仅类型定义，不包含实现
 *   2. ConversationMessage 是内部格式，不直接发送给 LLM
 *   3. 需要通过 MessageBuilder 转换为 AI SDK 格式
 *   4. 支持多种消息 Part 类型
 *
 * 流程:
 *   1. 定义消息 Part 类型
 *   2. 定义工具调用状态
 *   3. 定义对话消息结构
 *   4. 定义对话选项和统计类型
 */

// ─── 消息 Part 类型 ───────────────────────────────────────────

/** 文本 Part */
export interface TextMessagePart {
  type: "text";
  text: string;
}

/** 工具调用 Part*/
export interface ToolMessagePart {
  type: "tool";
  /** 工具名称 */
  tool: string;
  /** 工具调用 ID */
  toolCallId: string;
  /** 调用参数 */
  input: unknown;
  /** 工具输出 */
  output: unknown;
  /** 工具状态 */
  state: ToolCallState;
}

/** 思维链 Part(Extended Thinking / O1 reasoning) */
export interface ThinkingMessagePart {
  type: "thinking";
  text: string;
  /** 签名(Anthropic Extended Thinking 可能带签名) */
  signature?: string;
}

/** 图片 Part */
export interface ImageMessagePart {
  type: "image";
  url: string;
  alt?: string;
}

/** 文件 Part */
export interface FileMessagePart {
  type: "file";
  path: string;
  content: string;
}

/** 消息 Part 联合类型 */
export type MessagePart = TextMessagePart | ToolMessagePart | ThinkingMessagePart | ImageMessagePart | FileMessagePart;

// ─── 工具调用状态 ─────────────────────────────────────────────

/** 工具调用状态 */
export interface ToolCallState {
  /** 状态 */
  status: "pending" | "running" | "completed" | "error" | "aborted";
  /** 输出内容 */
  output: string;
  /** 执行时间 */
  time: {
    start?: number;
    end?: number;
  };
}

// ─── 对话消息 ─────────────────────────────────────────────────

/**
 * Crab-cli 内部消息格式。
 *
 *  MessageV2:
 *   - 每条消息有 id/sessionId/timestamp
 *   - assistant 消息通过 parts[] 携带结构化内容
 *   - parentID 支持链式结构(分支对话)
 *
 * 与 AI SDK ModelMessage 的关系:
 *   ConversationMessage 是 crab-cli 内部格式，
 *   通过 MessageBuilder.toModelMessages() 转换为 AI SDK 格式发送给 LLM。
 */
export interface ConversationMessage {
  /** 品牌化 ID(msg_xxx) */
  id: string;
  /** 角色 */
  role: "user" | "assistant" | "system" | "tool";
  /** 文本内容 */
  content: string;
  /** 结构化 Part 列表(assistant 消息适用) */
  parts?: MessagePart[];
  /** 工具调用列表(assistant 消息携带的 tool_calls) */
  toolCalls?: ToolCallInfo[];
  /** 工具调用结果 ID(tool 角色消息) */
  toolCallId?: string;
  /** 思维链内容(Anthropic Extended Thinking) */
  thinking?: string;
  /** 推理内容(O1 reasoning) */
  reasoning?: string;
  /** 父消息 ID(支持分支对话) */
  parentID?: string;
  /** 所属会话 ID */
  sessionId: string;
  /** 时间戳 */
  timestamp: number;
  /** 使用的模型 */
  model?: string;
  /** 本次消息费用 */
  cost?: number;
  /** Token 使用量 */
  tokens?: TokenInfo;
}

/** Token 信息 */
export interface TokenInfo {
  input: number;
  output: number;
  reasoning: number;
}

/** 工具调用信息 */
export interface ToolCallInfo {
  /** 工具调用 ID */
  id: string;
  /** 工具名称 */
  name: string;
  /** 调用参数 */
  arguments: unknown;
}

// ─── 对话使用量 ───────────────────────────────────────────────

/**
 * 对话 Token 使用量。
 */
export interface ConversationUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cached_tokens?: number;
}

// ─── 流式处理结果 ─────────────────────────────────────────────

/**
 * 单轮流式处理结果。
 */
export interface StreamRoundResult {
  /** 累积的文本内容 */
  streamedContent: string;
  /** 收到的工具调用 */
  toolCalls?: ToolCallInfo[];
  /** 推理内容 */
  reasoning?: unknown;
  /** 思维链数据 */
  thinking?: { thinking: string; signature?: string };
  /** DeepSeek R1 推理内容 */
  reasoningContent?: string;
  /** Token 使用量 */
  usage: ConversationUsage | null;
  /** 流式过程中产生的错误 */
  error?: Error;
}

// ─── 工具调用轮次结果 ─────────────────────────────────────────

/**
 * 工具调用轮次结果。
 */
export type ToolCallRoundResult =
  | { type: "continue"; accumulatedUsage?: ConversationUsage | null }
  | { type: "break"; accumulatedUsage?: ConversationUsage | null }
  | { type: "return"; accumulatedUsage: ConversationUsage | null };

// ─── 对话选项 ─────────────────────────────────────────────────

/** 对话处理选项 */
export interface ConversationOptions {
  /** 使用的模型 */
  model: string;
  /** 系统提示词 */
  systemPrompt?: string;
  /** 最大输出 Token */
  maxTokens?: number;
  /** 温度 */
  temperature?: number;
  /** 中止信号 */
  abortSignal?: AbortSignal;
  /** 会话 ID */
  sessionId?: string;
  /** 最大工具调用轮次 */
  maxToolRounds?: number;
}

// ─── 流式回调 ─────────────────────────────────────────────────

/** 流式处理回调 */
export interface StreamCallbacks {
  /** 收到累积 token 文本(定期触发，传递完整累积内容) */
  onToken?: (accumulated: string) => void;
  /** 收到 token 增量(每次 text-delta 都触发) */
  onTokenDelta?: (delta: string) => void;
  /** 收到思维链内容(增量) */
  onThinking?: (thinking: string) => void;
  /** 收到工具调用 */
  onToolCall?: (call: ToolCallInfo) => void;
  /** 收到使用量 */
  onUsage?: (usage: ConversationUsage) => void;
  /** 收到推理内容 */
  onReasoning?: (reasoning: string) => void;
  /** 流式错误 */
  onError?: (error: Error) => void;
}

// ContextInjectOptions 已在 context/contextInjector.ts 中定义，此处不再重复。
// 如需引用，请从 context/contextInjector 或 @conversation 导入。
