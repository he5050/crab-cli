/**
 * 对话处理器 — 核心对话循环(组合模式壳)。
 *
 * 公共导出从此文件 re-export，内部实现拆分到:
 *   - handlerTypes.ts    — 类型定义 + 辅助函数
 *   - doomLoop.ts        — 死循环检测
 *   - goalIntegration.ts — Goal Ralph Loop 集成
 *   - systemPrompt.ts    — 系统提示词构建
 *   - toolExecution.ts   — 工具执行管线
 */
import type { ModelMessage } from "ai";
import type { AppConfigSchema } from "@/schema/config";
import { clearProviderCache } from "@/api";
import { clearVerifiedMethods } from "@/api";
import { getRegisteredTools } from "@/tool/registry/toolRegistry";
import type { ExternalToolResolution } from "@/tool/registry/externalToolResolver";
import { ToolExecutor } from "@/tool/executor/toolExecutor";
import { type PermissionAskInput, PermissionManager } from "@/permission";
import { getDefaultPermissions } from "@/config";
import type { ChatMode } from "@/agent/prompt/modes";
import { skillManager, resolveExplicitSkillReference } from "@/extension/skill";
import { globalBus, type EventBus } from "@/bus";
import { AppEvent } from "@/bus";
import { createLogger } from "@/core/logging/logger";
import { createId } from "@/core/identity";
import { hookExecutor } from "@/hooks/hookExecutor";
import { DEFAULT_COMPACTION_CONFIG } from "@/compress/conversation";
import { SessionToolState } from "../context/sessionToolState";
import { LlmConfigState } from "../context/llmConfig";
import { DriverEventEmitter } from "../context/driverEventEmitter";
import { ToolSetup } from "../context/toolSetup";
import { CompactionManager } from "../context/compactionManager";
import { handleStopHook } from "../lifecycle/stopHandler";
import { goalManager } from "@/mission";
import { DEFAULT_CONFIG } from "@/config";
import { DEFAULT_MAX_TOOL_ROUNDS } from "@/config";
import { saveAgentState, type AgentRuntimeState } from "@/agent";
import { getSessionMessages, messageRecordsToModelMessages } from "@/session";
import { type ToolExecutor as LlmLoopToolExecutor, executeLlmLoop } from "./llmLoop";
import { createConversationCompressor } from "@/compress";
import { buildConversationLlmLoopCallbacks, buildConversationLlmLoopOptions } from "./llmLoopAdapter";
import { buildConversationToolExecutor } from "./toolRuntimeAdapter";

// ─── 子模块 ────────────────────────────────────────────────

import { type GoalManagerAdapter } from "./goalIntegration";
import {
  cleanupConversationTurn,
  createAbortedConversationResult,
  createBusyConversationResult,
  finalizeConversationTurn as finalizeConversationTurnCoordinator,
  prepareConversationTurn as prepareConversationTurnCoordinator,
  type ConversationTurnLifecycle,
} from "./turnLifecycleCoordinator";
import { getEffectiveSystemPrompt } from "../context/systemPrompt";
import { type HandlerContext } from "./toolExecution";
import { normalizeToolCallArgs } from "../message/toolCallHelpers";
import type { ConversationDriverEvent, ConversationDriverListener, SendMessageOptions } from "../types/driver";
import { ProcessingGuard } from "../guard/processingGuard";
import { McpToolChangeTracker } from "./mcpToolChangeTracker";

// ─── Re-export 公共类型 ───────────────────────────────────

export { ConversationError } from "./conversationError";

export type {
  TokenUsage,
  ConversationResult,
  ToolInterceptorContext,
  ToolInterceptorResult,
  ToolInterceptor,
  ConversationHandlerOptions,
} from "../types/handler";
import type { ConversationDriver } from "../types/driver";

export { normalizeToolCallArgs } from "../message/toolCallHelpers";

const log = createLogger("conversation");

// ─── GoalManager 适配器 ───────────────────────────────────

const goalManagerAdapter: GoalManagerAdapter = {
  accrueTokens: (sid, tokens) => goalManager.accrueTokens(sid, tokens),
  consumePendingContinuation: (sid) => goalManager.consumePendingContinuation(sid),
  loadGoal: (sid) => goalManager.loadGoal(sid),
  markPendingContinuation: (sid) => goalManager.markPendingContinuation(sid),
  pauseGoal: (sid) => goalManager.pauseGoal(sid),
};

// ─── 对话处理器工厂 ───────────────────────────────────────

export function createConversationHandler(
  configOrOptions:
    | AppConfigSchema
    | (import("../types/handler").ConversationHandlerOptions & { instanceId?: string; projectDir?: string }) = {},
  maybeOptions?: import("../types/handler").ConversationHandlerOptions & { instanceId?: string; projectDir?: string },
): ConversationHandler {
  if (maybeOptions) {
    return new ConversationHandler(configOrOptions as AppConfigSchema, maybeOptions);
  }
  return new ConversationHandler(
    DEFAULT_CONFIG,
    configOrOptions as import("../types/handler").ConversationHandlerOptions,
  );
}

// ─── 对话处理器类 ─────────────────────────────────────────

export class ConversationHandler implements ConversationDriver {
  private messages: ModelMessage[] = [];
  private permissionManager: PermissionManager;
  private toolExecutor: ToolExecutor;
  private maxToolRounds: number;
  private systemPrompt: string;
  private abortSignal?: AbortSignal;
  private sessionId?: string;
  private unsubConfig?: () => void;
  /** 压缩管理器(配置 + 执行) */
  private compactionManager: CompactionManager;
  /** 处理锁(互斥 + 超时 + 中止感知) */
  private processingGuard = new ProcessingGuard({ timeoutMs: 5 * 60 * 1000, name: "conversation-handler" });
  /** 处理代际计数器，防止 abort() 后旧 finally 块干扰新一轮 sendMessage */
  private _processingGeneration = 0;
  /** 会话工具状态管理器(外部工具/Skill/白名单) */
  private toolSession = new SessionToolState();
  /** LLM 调用配置(provider/model/temperature/topP/streamFn) */
  private llmConfig = new LlmConfigState();
  /** 工具执行配置(拦截器/扩展schema/上下文工厂) */
  private toolSetup = new ToolSetup();
  private recentToolCalls: { toolName: string; args: string }[] = [];
  private recoveredFrom = false;
  /** Driver 事件发射器(ConversationDriver 接口实现) */
  private driverEmitter = new DriverEventEmitter<ConversationDriverEvent>();
  private readonly eventBus: EventBus;
  /** MCP 工具变更追踪器 */
  private _mcpTracker?: McpToolChangeTracker;
  private activeMcpToolChangeReminder?: string;

  private ensureToolSession(): SessionToolState {
    this.toolSession ??= new SessionToolState();
    return this.toolSession;
  }

  private ensureToolSetup(): ToolSetup {
    this.toolSetup ??= new ToolSetup();
    return this.toolSetup;
  }

  // 兼容旧调用面和轻量测试夹具，统一收敛到 SessionToolState / ToolSetup。
  get allowedTools(): string[] | undefined {
    return this.ensureToolSession().getAllowedTools();
  }

  set allowedTools(allowedTools: string[] | undefined) {
    this.ensureToolSession().setAllowedTools(allowedTools);
  }

  get mode(): ChatMode | undefined {
    return this.ensureToolSession().getMode();
  }

  set mode(mode: ChatMode | undefined) {
    this.ensureToolSession().setMode(mode);
  }

  get sessionAllowedExternalTools(): string[] {
    return this.ensureToolSession().sessionAllowedExternalTools;
  }

  set sessionAllowedExternalTools(toolNames: string[] | undefined) {
    this.ensureToolSession().sessionAllowedExternalTools = [...(toolNames ?? [])];
  }

  get additionalToolSchemas(): Record<string, { description: string; inputSchema: unknown }> | undefined {
    return this.ensureToolSetup().additionalToolSchemas;
  }

  set additionalToolSchemas(schemas: Record<string, { description: string; inputSchema: unknown }> | undefined) {
    this.ensureToolSetup().setAdditionalToolSchemas(schemas);
  }

  constructor(
    private config: AppConfigSchema,
    options: import("../types/handler").ConversationHandlerOptions = {},
  ) {
    this.messages = [...(options.initialMessages ?? [])];
    this.maxToolRounds = options.maxToolRounds ?? config.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
    this.systemPrompt = options.systemPrompt ?? "";
    this.abortSignal = options.abortSignal;
    this.sessionId = options.sessionId;
    this.compactionManager = new CompactionManager({ ...DEFAULT_COMPACTION_CONFIG, ...options.compactionConfig });
    this.toolSession.setAllowedTools(options.allowedTools);
    this.toolSession.setMode(options.mode);
    this.llmConfig.applyOptions({
      modelId: options.modelId,
      providerId: options.providerId,
      streamFn: options.streamFn,
      temperature: options.temperature,
      topP: options.topP,
    });
    this.toolSetup.applyOptions({
      getToolContext: options.getToolContext,
      toolInterceptor: options.toolInterceptor,
      toolInterceptorContext: options.toolInterceptorContext,
    });
    this.eventBus = options.eventBus ?? globalBus;
    this.permissionManager = new PermissionManager(
      getDefaultPermissions(),
      options.sessionId ?? "default",
      options.permissionRequestHandler,
      this.abortSignal,
      this.eventBus,
    );

    this.toolExecutor = new ToolExecutor({
      askPermission: async (toolName, args) => {
        const tool = getRegisteredTools()[toolName];
        const input: PermissionAskInput = {
          patterns: [JSON.stringify(args)],
          permission: tool?.permission ?? toolName,
          tool: toolName,
        };
        return this.permissionManager.ask(input);
      },
      getConfig: () => this.config,
      getToolContext: options.getToolContext,
    });

    this.unsubConfig = this.eventBus.subscribe(AppEvent.ConfigUpdated, (evt) => {
      const newConfig = evt.properties.config as AppConfigSchema;
      log.info(`配置热更新已触发`);
      this.updateConfig(newConfig);
    });
    this._mcpTracker = new McpToolChangeTracker(this.eventBus);
    this._mcpTracker.init();
  }

  destroy(): void {
    this._saveCurrentState();
    this.unsubConfig?.();
    this.unsubConfig = undefined;
    this._mcpTracker?.destroy();
    this._mcpTracker = undefined;
    this.driverEmitter.destroy();
    this.permissionManager.destroy();
    this.compactionManager.cleanup(this.sessionId);
  }

  private _saveCurrentState(): void {
    if (!this.sessionId) {
      return;
    }
    const toolSession = this.ensureToolSession();
    // 序列化时截断 recentToolCalls，避免极端长对话中状态膨胀
    const recentToolCalls = this.recentToolCalls.length > 50 ? this.recentToolCalls.slice(-50) : this.recentToolCalls;
    const toolSnapshot = toolSession.toSnapshot();
    const llmSnapshot = this.llmConfig.toSnapshot();
    const ok = saveAgentState(this.sessionId, {
      activeSkillContext: toolSession.activeSkillContext,
      allowedTools: toolSession.getAllowedTools(),
      modelId: llmSnapshot.modelId,
      providerId: llmSnapshot.providerId,
      recentToolCalls,
      recoveredFrom: this.recoveredFrom,
      sessionActiveSkills: toolSnapshot.sessionActiveSkills,
      sessionAllowedExternalTools: toolSnapshot.sessionAllowedExternalTools,
      sessionDiscoveredSkills: toolSnapshot.sessionDiscoveredSkills,
      sessionLoadedSkills: toolSnapshot.sessionLoadedSkills,
      systemPrompt: this.systemPrompt,
      temperature: llmSnapshot.temperature,
      topP: llmSnapshot.topP,
    });
    if (!ok) {
      log.warn("保存会话状态失败", { sessionId: this.sessionId });
    }
  }

  restoreState(state: AgentRuntimeState): void {
    this.setRecentToolCalls(state.recentToolCalls);
    const toolSession = this.ensureToolSession();
    toolSession.restoreFrom({
      sessionAllowedExternalTools: state.sessionAllowedExternalTools ?? [],
      sessionDiscoveredSkills: state.sessionDiscoveredSkills ?? [],
      sessionActiveSkills: state.sessionActiveSkills ?? [],
      sessionLoadedSkills: state.sessionLoadedSkills ?? [],
    });
    toolSession.activeSkillContext = state.activeSkillContext;
    this.llmConfig.restoreFrom({
      modelId: state.modelId,
      providerId: state.providerId,
      temperature: state.temperature,
      topP: state.topP,
    });
    if (this.messages.length === 0 && this.sessionId) {
      const persistedMessages = messageRecordsToModelMessages(getSessionMessages(this.sessionId));
      if (persistedMessages.length > 0) {
        this.messages = persistedMessages;
      }
    }
    this.recoveredFrom = true;
  }

  getState(): AgentRuntimeState {
    const toolSession = this.ensureToolSession();
    const toolSnapshot = toolSession.toSnapshot();
    const llmSnapshot = this.llmConfig.toSnapshot();
    return {
      activeSkillContext: toolSession.activeSkillContext,
      allowedTools: toolSession.getAllowedTools(),
      modelId: llmSnapshot.modelId,
      providerId: llmSnapshot.providerId,
      recentToolCalls: [...this.recentToolCalls],
      recoveredFrom: this.recoveredFrom,
      savedAt: Date.now(),
      sessionActiveSkills: toolSnapshot.sessionActiveSkills,
      sessionAllowedExternalTools: toolSnapshot.sessionAllowedExternalTools,
      sessionDiscoveredSkills: toolSnapshot.sessionDiscoveredSkills,
      sessionLoadedSkills: toolSnapshot.sessionLoadedSkills,
      systemPrompt: this.systemPrompt,
      temperature: llmSnapshot.temperature,
      topP: llmSnapshot.topP,
    };
  }

  abort(reason?: string): void {
    // 递增代际计数器 + 强制释放处理锁，使旧 sendMessage 的 finally 块失效
    this._processingGeneration++;
    this.processingGuard.forceReset();
    this.eventBus.publish(AppEvent.ConversationAborted, {
      reason: reason ?? "aborted",
      sessionId: this.sessionId,
    });
    this.driverEmitter.emit("aborted", { reason });
  }

  on(event: ConversationDriverEvent, listener: ConversationDriverListener): () => void {
    return this.driverEmitter.on(event, listener);
  }

  private setRecentToolCalls(calls: { toolName: string; args: string }[]): void {
    this.recentToolCalls = calls;
  }

  getMessages(): ModelMessage[] {
    return [...this.messages];
  }

  getPermissionManager(): PermissionManager {
    return this.permissionManager;
  }

  setAbortSignal(signal?: AbortSignal): void {
    this.abortSignal = signal;
  }

  clearHistory(): void {
    this.messages = [];
  }

  updateConfig(config: AppConfigSchema): void {
    this.config = config;
    clearProviderCache();
    clearVerifiedMethods();
  }

  /**
   * 设置活跃的 Skill 上下文(注入到系统提示词 + 可选工具白名单)。
   */
  setActiveSkillContext(skillPrompt: string, skillTools?: string[]): void {
    this.ensureToolSession().setActiveSkillContext(skillPrompt, skillTools);
  }

  clearActiveSkillContext(): void {
    this.ensureToolSession().clearActiveSkillContext();
  }

  setAdditionalToolSchemas(schemas: Record<string, { description: string; inputSchema: unknown }> | undefined): void {
    this.ensureToolSetup().setAdditionalToolSchemas(schemas);
  }

  /**
   * 向对话历史注入外部消息（如子代理的 pending messages 和 inter-agent messages）。
   */
  injectMessages(messages: ModelMessage[]): void {
    this.messages.push(...messages);
  }

  enableExternalToolForSession(query: string): ExternalToolResolution {
    return this.ensureToolSession().enableExternalToolForSession(query);
  }

  private enableExplicitExternalToolsFromText(input: string): string[] {
    return this.ensureToolSession().enableExplicitExternalToolsFromText(input);
  }

  private getAllowedToolsForExecution(): string[] | undefined {
    return this.ensureToolSession().getAllowedToolsForExecution();
  }

  private getToolsForLlm() {
    return this.ensureToolSession().getToolsForLlm(this.ensureToolSetup().additionalToolSchemas);
  }

  private enableExternalToolsFromDiscoveryResult(output: unknown): string[] {
    return this.ensureToolSession().enableExternalToolsFromDiscoveryResult(output);
  }

  private enableSkillsFromToolResult(
    toolName: string,
    output: unknown,
  ): { discovered: string[]; active: string[]; loaded: string[] } {
    return this.ensureToolSession().enableSkillsFromToolResult(toolName, output);
  }

  private getSystemPromptForLlm(): string | undefined {
    const toolSession = this.ensureToolSession();
    const base = getEffectiveSystemPrompt({
      activeSkillContext: toolSession.activeSkillContext,
      systemPrompt: this.systemPrompt,
    });
    const reminder = toolSession.buildDynamicReminder();
    const parts = [base, reminder, this.activeMcpToolChangeReminder].filter(
      (part): part is string => typeof part === "string" && part.length > 0,
    );
    return parts.length > 0 ? parts.join("\n") : undefined;
  }

  private consumeMcpToolChangeReminder(): string | undefined {
    return this._mcpTracker?.consumeReminder();
  }

  private getStreamTimeout(): number | undefined {
    const providerId = this.config.defaultProvider.provider;
    const providerConfig = this.config.providerConfig[providerId];
    return providerConfig?.streamTimeout;
  }

  private async prepareConversationTurn(content: string) {
    return prepareConversationTurnCoordinator({
      appendUserMessage: (effectiveContent) => {
        this.messages.push({ content: effectiveContent, role: "user" });
      },
      content,
      ensureSkillManagerInitialized: async () => {
        if (skillManager.size === 0) {
          await skillManager.init(process.cwd());
        }
      },
      goalManager: goalManagerAdapter,
      injectExplicitCapabilities: (effectiveContent) => {
        const explicitSkill = resolveExplicitSkillReference(effectiveContent);
        if (explicitSkill.status === "unique" && explicitSkill.skillName) {
          this.ensureToolSession().enableSkillForSession(explicitSkill.skillName);
        }
        this.enableExplicitExternalToolsFromText(effectiveContent);
      },
      onUserMessage: (effectiveContent, sessionId) => hookExecutor.userMessage(effectiveContent, sessionId),
      sessionId: this.sessionId,
    });
  }

  private beginConversationTurn(content: string): ConversationTurnLifecycle {
    this.activeMcpToolChangeReminder = this.consumeMcpToolChangeReminder();
    this.eventBus.publish(AppEvent.ConversationMessageSent, {
      content,
      role: "user",
      sessionId: this.sessionId,
    });

    const turnId = createId("trn");
    const turnStartTime = Date.now();
    log.info(`开始新对话轮次`, {
      eventType: "conversation.turn.start",
      payload: { inputLength: content.length },
      sessionId: this.sessionId,
      turnId,
    });
    return { turnId, turnStartTime };
  }

  private buildLlmLoopOptions(turnId: string) {
    return buildConversationLlmLoopOptions({
      abortSignal: this.abortSignal,
      allowedTools: this.getAllowedToolsForExecution(),
      doomLoopThreshold: this.config.doomLoopThreshold,
      getSystem: () => this.getSystemPromptForLlm(),
      getTools: () => this.getToolsForLlm(),
      maxRounds: this.maxToolRounds,
      modelId: this.llmConfig.modelId,
      providerId: this.llmConfig.providerId,
      sessionId: this.sessionId,
      streamFn: this.llmConfig.streamFn,
      temperature: this.llmConfig.temperature,
      timeout: this.getStreamTimeout(),
      topP: this.llmConfig.topP,
      turnId,
    });
  }

  private buildLlmLoopCallbacks(turnId: string) {
    return buildConversationLlmLoopCallbacks({
      eventBus: this.eventBus,
      logError: (error: Error, currentTurnId: string) => {
        log.error(`LLM 错误: ${error.message}`, {
          eventType: "conversation.request.failed",
          payload: { error: error.message },
          sessionId: this.sessionId,
          success: false,
          turnId: currentTurnId,
        });
      },
      sessionId: this.sessionId,
      turnId,
    });
  }

  private async finalizeConversationTurn(
    llmLoopResult: Awaited<ReturnType<typeof executeLlmLoop>>,
    lifecycle: ConversationTurnLifecycle,
  ): Promise<import("../types/handler").ConversationResult> {
    return finalizeConversationTurnCoordinator({
      afterLoop: async () => {
        await this.autoCompact();
        await handleStopHook(this.sessionId);
      },
      eventBus: this.eventBus,
      goalManager: goalManagerAdapter,
      lifecycle,
      llmLoopResult,
      saveState: () => this._saveCurrentState(),
      sessionId: this.sessionId,
    });
  }

  /** 构建 toolExecution 所需的 HandlerContext */
  private buildHandlerContext(): HandlerContext {
    return {
      abortSignal: this.abortSignal,
      additionalToolSchemas: this.ensureToolSetup().additionalToolSchemas,
      allowedTools: this.getAllowedToolsForExecution(),
      config: this.config,
      getToolContext: this.ensureToolSetup().getToolContext,
      messages: this.messages,
      modelId: this.llmConfig.modelId,
      permissionManager: this.permissionManager,
      providerId: this.llmConfig.providerId,
      sessionId: this.sessionId,
      streamFn: this.llmConfig.streamFn,
      temperature: this.llmConfig.temperature,
      toolExecutor: this.toolExecutor,
      toolInterceptor: this.ensureToolSetup().toolInterceptor,
      toolInterceptorContext: this.ensureToolSetup().toolInterceptorContext,
      topP: this.llmConfig.topP,
    };
  }

  /** 创建 llmLoop.ToolExecutor 适配器 */
  private createLlmLoopToolExecutor(): LlmLoopToolExecutor {
    return buildConversationToolExecutor({
      buildHandlerContext: () => this.buildHandlerContext(),
      enableExternalToolForSession: (query) => this.enableExternalToolForSession(query),
      enableExternalToolsFromDiscoveryResult: (output) => this.enableExternalToolsFromDiscoveryResult(output),
      enableSkillsFromToolResult: (toolName, output) => this.enableSkillsFromToolResult(toolName, output),
      getMode: () => this.ensureToolSession().getMode(),
      getVisibleTools: () => this.getToolsForLlm(),
      isExternalToolEnabled: (toolName) => this.ensureToolSession().sessionAllowedExternalTools.includes(toolName),
      messages: this.messages,
    });
  }

  // ─── sendMessage 主循环 ──────────────────────────────────

  async sendMessage(content: string): Promise<import("../types/handler").ConversationResult>;
  async sendMessage(options: SendMessageOptions): Promise<void>;
  async sendMessage(input: string | SendMessageOptions): Promise<import("../types/handler").ConversationResult | void> {
    const content = typeof input === "string" ? input : input.content;
    if (this.abortSignal?.aborted) {
      return createAbortedConversationResult();
    }
    const processingGeneration = ++this._processingGeneration;
    try {
      this.processingGuard.acquire(this.abortSignal);
    } catch {
      // ProcessingGuard.acquire 已包含超时和中止保护，失败时直接返回
      return createBusyConversationResult();
    }
    await this.prepareConversationTurn(content);

    try {
      const lifecycle = this.beginConversationTurn(content);
      const llmLoopResult = await executeLlmLoop(
        this.messages,
        this.buildLlmLoopOptions(lifecycle.turnId),
        this.createLlmLoopToolExecutor(),
        this.buildLlmLoopCallbacks(lifecycle.turnId),
        this.config,
        createConversationCompressor(this.compactionManager.config, this.sessionId),
      );
      return await this.finalizeConversationTurn(llmLoopResult, lifecycle);
    } finally {
      cleanupConversationTurn({
        clearActiveMcpToolChangeReminder: () => {
          this.activeMcpToolChangeReminder = undefined;
        },
        currentProcessingGeneration: this._processingGeneration,
        processingGeneration,
        processingGuard: this.processingGuard,
      });
    }
  }

  private async autoCompact(): Promise<void> {
    await this.compactionManager.compact(this.messages, this.config, this.sessionId);
  }
}
