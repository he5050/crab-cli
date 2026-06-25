/**
 * ConversationDriver 接口 — P2-3 重构
 *
 * 解耦 AgentSession 与 ConversationHandler 的具体实现。
 * 通过接口抽象，AgentSession 不再直接依赖 conversation/ 目录的实现细节。
 *
 * 设计原则:
 *   1. 最小化接口:仅暴露 Agent 真正需要的方法
 *   2. 不破坏现有 API:ConversationHandler 现有方法保持不变
 *   3. 类型安全:使用 ModelMessage 等强类型而非 any
 *
 * 演进路径:
 *   1. ConversationHandler 实现 ConversationDriver(implements)
 *   2. AgentSession.handler 字段类型改为 ConversationDriver
 *   3. 后续拆分 ConversationHandler 时(P2-5)，Driver 接口保持稳定
 *
 * 边界:
 *   - sendMessage 是异步触发，不返回结果；结果通过事件订阅获取
 *   - getMessages 用于上下文快照
 *   - abort 用于紧急停止
 *   - on 允许订阅事件
 */

import type { ModelMessage } from "ai";
import type { ConversationResult } from "./handler";
import type { AgentRuntimeState } from "@/agent";

/** Driver 事件名 */
export type ConversationDriverEvent = "message" | "tool-call" | "tool-result" | "error" | "complete" | "aborted";

/** Driver 事件回调 */
export type ConversationDriverListener = (payload: unknown) => void;

/** 发送消息的参数 */
export interface SendMessageOptions {
  /** 用户消息内容 */
  content: string;
  /** 中止信号(用户取消时触发) */
  abortSignal?: AbortSignal;
  /** 会话 ID(多会话并发) */
  sessionId?: string;
  /** 附加元数据(如 agent 上下文) */
  metadata?: Record<string, unknown>;
}

/**
 * ConversationDriver — Agent 与对话层的解耦接口
 *
 * 当前由 ConversationHandler 实现，后续可被:
 *   - MockDriver(测试用)
 *   - StreamDriver(流式专用)
 *   - BatchDriver(批量处理专用)
 *   替换，无需修改 AgentSession。
 */
export interface ConversationDriver {
  /** 发送用户消息，触发 AI 回复流程 */
  sendMessage(content: string): Promise<ConversationResult>;
  sendMessage(options: SendMessageOptions): Promise<void>;

  /** 获取当前对话上下文的快照(用于持久化、UI 展示) */
  getMessages(): readonly ModelMessage[];

  /** 紧急中止当前对话(不可恢复) */
  abort(reason?: string): void;

  /** 订阅事件，返回取消订阅函数 */
  on(event: ConversationDriverEvent, listener: ConversationDriverListener): () => void;

  /** 恢复 Agent 持久化状态(断点续传) */
  restoreState(state: AgentRuntimeState): void;

  /** 获取当前 Agent 状态的快照(用于持久化) */
  getState(): AgentRuntimeState;
}
