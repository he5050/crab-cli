/**
 * Session Orchestrator — P2-4 重构
 *
 * 封装 ConversationHandler 的创建、配置、状态恢复、权限预批准等
 * 业务编排逻辑。让 UI 层(chat.tsx)只需关心"用现成的 handler"，
 * 不必重复实现 handler 生命周期管理。
 *
 * 职责:
 *   1. 加载 AgentState(崩溃恢复)并应用到 handler
 *   2. 合并运行时覆盖(系统提示、模型、最大轮次)
 *   3. 权限预批准(如 fs.read 自动批准)
 *   4. 工具白名单合并(savedState + runtime overrides)
 *   5. 提供 abort 控制器与 active session 引用
 *
 * 使用场景:
 *   - chat.tsx 进入会话时调用 createSessionOrchestrator
 *   - 切换会话时调用 dispose
 *   - 用户发送消息时调用 abort/send
 *
 * 边界:
 *   1. 不感知 UI 渲染细节(仅管理业务编排)
 *   2. 不持久化状态(依赖 agentState 模块)
 *   3. 不直接处理 LLM 调用(委托给 ConversationHandler)
 */

import { type ConversationHandler, createConversationHandler } from "@/conversation";
import { loadAgentState } from "@/agent";
import type { AppConfigSchema } from "@/schema/config";
import type { ChatMode } from "@/agent/prompt/modes";
import { createLogger } from "@/core/logging/logger";
import type { ModelMessage } from "ai";

const log = createLogger("session:orchestrator");

/** 运行时覆盖(来自当前 config) */
export interface RuntimeOverrides {
  systemPrompt?: string;
  maxToolRounds?: number;
  allowedTools?: string[];
  providerId?: string;
  modelId?: string;
  temperature?: number;
  topP?: number;
}

/** Orchestrator 初始化参数 */
export interface OrchestratorInitOptions {
  /** 应用配置 */
  config: AppConfigSchema;
  /** 会话 ID(用于加载 AgentState) */
  sessionId?: string;
  /** 初始消息(如从 UI 输入框传入) */
  initialMessages?: { role: "user" | "assistant"; content: string | unknown[] }[];
  /** 当前模式 */
  mode?: ChatMode;
  /** 运行时覆盖(来自当前 config) */
  overrides: RuntimeOverrides;
}

/** Orchestrator 句柄 — 持有 handler 与 abort 控制器 */
export interface SessionOrchestrator {
  /** 已初始化的 ConversationHandler */
  handler: ConversationHandler;
  /** 当前活跃的 abort 控制器(发送消息时创建) */
  activeAbortController: AbortController | null;
  /** 释放资源(清理订阅、abort 等) */
  dispose(): void;
}

/**
 * 创建 SessionOrchestrator。
 *
 * 完成业务编排:
 *   1. 加载 AgentState(如果有 savedState 则恢复)
 *   2. 合并 savedState 与 overrides(savedState 优先)
 *   3. 创建 ConversationHandler 实例
 *   4. 恢复运行时状态
 *   5. 预批准 fs.read 权限
 *
 * @returns 编排器句柄，包含 handler 与 abort 控制器
 */
export function createSessionOrchestrator(options: OrchestratorInitOptions): SessionOrchestrator {
  const { config, sessionId, initialMessages, mode, overrides } = options;

  // 步骤 1:加载 AgentState(崩溃恢复)
  const savedState = sessionId ? loadAgentState(sessionId) : null;

  // 步骤 2:合并 savedState 与 runtime overrides(savedState 优先)
  const effectiveOptions = {
    allowedTools: savedState?.allowedTools ?? overrides.allowedTools,
    initialMessages: initialMessages as ModelMessage[] | undefined,
    maxToolRounds: overrides.maxToolRounds,
    mode,
    modelId: savedState?.modelId ?? overrides.modelId,
    providerId: savedState?.providerId ?? overrides.providerId,
    sessionId,
    systemPrompt: savedState?.systemPrompt ?? overrides.systemPrompt,
    temperature: savedState?.temperature ?? overrides.temperature,
    topP: savedState?.topP ?? overrides.topP,
  };

  // 步骤 3:创建 ConversationHandler
  const handler = createConversationHandler(config, effectiveOptions);

  // 步骤 4:恢复运行时状态
  if (savedState) {
    handler.restoreState(savedState);
    log.info(`Agent 状态已恢复: ${sessionId}`);
  }

  // 步骤 5:预批准 fs.read 权限(约定:UI 始终允许读取)
  handler.getPermissionManager().approve("fs.read", "**");

  return {
    activeAbortController: null,
    dispose() {
      // 中止任何活跃的请求
      if (this.activeAbortController) {
        this.activeAbortController.abort();
        this.activeAbortController = null;
      }
      // 清理 handler 内部订阅
      handler.destroy();
    },
    handler,
  };
}

/**
 * 创建新的 abort 控制器并注册到 orchestrator。
 *
 * 每次发送消息前调用，确保旧请求被中止。
 */
export function startRequest(orchestrator: SessionOrchestrator): AbortController {
  if (orchestrator.activeAbortController) {
    orchestrator.activeAbortController.abort();
  }
  const controller = new AbortController();
  orchestrator.activeAbortController = controller;
  return controller;
}

/**
 * 请求完成后清理 abort 控制器。
 */
export function endRequest(orchestrator: SessionOrchestrator): void {
  orchestrator.activeAbortController = null;
}
