/**
 * LLM 循环类型 — LLM 消息循环编排过程共享的类型与回调签名。
 *
 * 职责:
 *   - 集中声明 LLM 循环所需的步骤枚举、消息块、回调签名
 *   - 为 llmLoop / toolCallLoop / processingGuard 等模块提供共享类型
 *
 * 模块功能:
 *   - LoopStep / LoopState: 循环步骤与状态
 *   - StreamHandlers: 流式处理回调集合
 *   - LlmLoopOptions / LlmLoopResult: 循环入参与结果
 *   - TokenUsage / LlmTokenUsage: Token 使用量类型
 *
 * 使用场景:
 *   - ConversationHandler 内部循环编排
 *   - 工具调用与思考步骤的流转
 *
 * 边界:
 *   1. 仅声明类型，不包含运行时逻辑
 *   2. 不依赖具体 LLM 客户端实现
 */
import type { ModelMessage, Tool } from "ai";
import type { LlmTokenUsage } from "@/api";
import type { AppConfigSchema } from "@/schema/config";
import type { TokenUsage } from "./handler";
import type { EventBus } from "@/bus";

/** LLM 工具 schema — 内置工具(AI SDK Tool)或外部工具(简化 schema) */
export type LlmToolSchema = Tool | { description: string; inputSchema: unknown };

export type StreamLlmFunction = typeof import("@api").streamLlm;

/**
 * LLM 循环选项
 */
export interface LlmLoopOptions {
  /** 系统提示词 */
  system?: string;
  /** 动态系统提示词获取器；每轮请求前调用，用于会话内渐进式上下文注入 */
  getSystem?: () => string | undefined;
  /** 最大轮次限制(防止无限循环) */
  maxRounds?: number;
  /** 中止信号 */
  abortSignal?: AbortSignal;
  /** Provider ID */
  providerId?: string;
  /** Model ID */
  modelId?: string;
  /** Temperature */
  temperature?: number;
  /** Top-P */
  topP?: number;
  /** 流式超时(毫秒) */
  timeout?: number;
  /** 工具白名单(undefined = 全部工具) */
  allowedTools?: string[];
  /** 已过滤的工具 schema(用于传递给 LLM) */
  tools?: Record<string, LlmToolSchema>;
  /** 动态工具 schema 获取器；每轮请求前调用，用于会话内渐进式工具加载 */
  getTools?: () => Record<string, LlmToolSchema> | undefined;
  /** 死循环检测阈值(undefined = 使用默认值) */
  doomLoopThreshold?: number;
  /** 是否需要在没有工具调用时自动追加提示 */
  requireToolCallHint?: boolean;
  /** 没有工具调用时追加的自定义提示 */
  toolCallHintMessage?: string;
  /** 自定义 LLM 流执行器(测试用) */
  streamFn?: StreamLlmFunction;
  /** 会话 ID(用于关联和日志) */
  sessionId?: string;
  /** 轮次 ID(用于关联和日志) */
  turnId?: string;
  /** 是否允许无依赖工具并发执行(默认 false，串行执行保持兼容性) */
  concurrentToolExecution?: boolean;
  /** LLM 循环内上下文压缩阈值(token 数)，undefined 则不压缩 */
  compressionThreshold?: number;
  /** LLM 循环内工具输出截断长度(字符) */
  toolOutputTruncateLength?: number;
  /** EventBus 实例(可选，默认使用全局单例) */
  eventBus?: EventBus;
}

/**
 * 工具调用项
 */
export interface ToolCallItem {
  toolName: string;
  toolCallId: string;
  args: unknown;
}

/**
 * 流式事件类型
 */
export type StreamEventType = "text-delta" | "tool-call" | "reasoning-delta" | "done" | "error" | "usage";

/**
 * 流式事件
 */
export interface StreamEvent {
  type: StreamEventType;
  text?: string;
  toolName?: string;
  toolCallId?: string;
  args?: unknown;
  error?: Error;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

/**
 * LLM 循环结果
 */
export interface LlmLoopResult {
  /** 是否成功 */
  ok: boolean;
  /** 完整响应文本 */
  text: string;
  /** 推理文本(thinking content) */
  reasoning?: string;
  /** Token 使用统计 */
  usage?: TokenUsage;
  /** 执行轮次 */
  toolRounds: number;
  /** 是否有工具调用 */
  hadToolCalls: boolean;
  /** 错误信息 */
  error?: string;
}

/**
 * 工具执行器接口
 */
export interface ToolExecutor {
  execute(toolName: string, args: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult>;
}

/**
 * 工具执行上下文
 */
export interface ToolExecutionContext {
  /** 消息历史(引用) */
  messages: ModelMessage[];
  /** 中止信号 */
  abortSignal?: AbortSignal;
  /** 会话 ID */
  sessionId?: string;
  /** LLM 返回的原始工具调用 ID */
  toolCallId?: string;
  /** 额外上下文 */
  extra?: Record<string, unknown>;
}

/**
 * 工具执行结果
 */
export interface ToolExecutionResult {
  success: boolean;
  output: unknown;
  error?: string;
}

/**
 * LLM 循环回调接口
 */
export interface LlmLoopCallbacks {
  /** 文本增量回调 */
  onTextDelta?: (text: string) => void;
  /** 思维内容累积回调 */
  onThinking?: (thinking: string) => void;
  /** 思维内容增量回调(实时流式) */
  onThinkingDelta?: (text: string) => void;
  /** 工具调用回调 */
  onToolCall?: (call: ToolCallItem) => void;
  /** Token 使用回调 */
  onUsage?: (usage: LlmTokenUsage) => void;
  /** 错误回调 */
  onError?: (error: Error) => void;
  /** 自定义工具拦截器(返回 true 表示阻止) */
  toolInterceptor?: (
    toolName: string,
    args: unknown,
    toolCallId: string,
  ) => { allowed: boolean; reason?: string } | Promise<{ allowed: boolean; reason?: string }>;
  /** 工具执行前的处理 */
  beforeToolExecution?: (toolName: string, args: unknown, toolCallId: string) => Promise<void>;
  /** 工具执行后的处理 */
  afterToolExecution?: (toolName: string, result: ToolExecutionResult, toolCallId: string) => Promise<void>;
  /** 检测到重复工具调用时的处理；返回 abort 会中止当前 LLM 循环 */
  onDoomLoop?: (
    call: ToolCallItem,
    message: string,
    threshold: number,
  ) => void | "continue" | "abort" | Promise<void | "continue" | "abort">;
}

/**
 * 消息压缩接口
 */
export interface MessageCompressor {
  compress(
    messages: ModelMessage[],
    config: AppConfigSchema,
    modelId: string,
    sessionId?: string,
  ): Promise<{
    compressed: boolean;
    messages?: ModelMessage[];
    beforeTokens: number;
    afterTokensEstimate: number;
  }>;
}
