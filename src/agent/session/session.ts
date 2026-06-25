/**
 * Agent Session — Agent 执行上下文(协调器).
 *
 * 设计:
 *   - 本文件只保留 AgentSession 类本身, 状态机与公开方法
 *   - 内部职责按"单一职责"拆分至:
 *     - sessionDeps.ts       DI 单例 + 测试替身
 *     - sessionLifecycle.ts  状态机 + 销毁清理
 *     - sessionToolContext.ts tool 拦截器 + ToolContext 构造
 *     - sessionSubagent.ts   spawnSubagent + createSpawnExecutor
 *
 * 公开 API 完全向后兼容:
 *   - AgentSession 类构造与所有方法签名
 *   - __setAgentSessionDepsForTesting / __resetAgentSessionDepsForTesting
 *   - getAgentModel / getToolsForAgent (从 ./model 转发)
 *   - AgentSessionOptions / AgentSessionResult / SubagentTask (从 ./types 转发)
 */
import { type AgentInfo, type AgentStatus, getAgent, setAgentStatus } from "@/agent/core/manager";
import { type ConversationHandler, type ConversationHandlerOptions, type ConversationResult } from "@/conversation";
import { symCheck, symCross } from "@/core/icons/icon";
import { buildSubAgentInitialMessages, getBuiltinAgentToolSchemas } from "@/agent/subagent/builtinTools";
import type { AppConfigSchema } from "@/schema/config";
import { createLogger } from "@/core/logging/logger";
import { createAgentError } from "@/core/errors/appError";
import { buildSpawnedChildrenContinuationPrompt, drainSpawnedChildResults } from "@/agent/subagent/trackerDrain";
import { agentSessionDeps } from "./sessionDeps";
import {
  buildHandlerOptions,
  createBuiltinToolInterceptor,
  createSessionToolContext,
  resolveEffectiveAllowedTools,
} from "./sessionToolContext";
import { createSessionSpawnExecutor, spawnSubagent } from "./sessionSubagent";
import { destroySession, updateSessionStatus } from "./sessionLifecycle";
import type { AgentSessionOptions, AgentSessionResult, SubagentTask } from "./types";

const log = createLogger("agent:session");

// 转发 DI 测试 API, 保持向后兼容
export {
  __resetAgentSessionDepsForTesting,
  __setAgentSessionDepsForTesting,
  __setSubagentCollectorForTesting,
} from "./sessionDeps";

const DEFAULT_MAX_SPAWN_DEPTH = 3;
/** spawned children 等待完成的默认超时（毫秒） */
const DEFAULT_CHILD_WAIT_TIMEOUT_MS = 300_000;
export type { AgentSessionOptions, AgentSessionResult, SubagentTask } from "./types";

export class AgentSession {
  private agentName: string;
  private agent: AgentInfo;
  private handler: ConversationHandler;
  private config: AppConfigSchema;
  private status: AgentStatus = "idle";
  private subagentTasks: SubagentTask[] = [];
  private spawnDepth: number;
  private maxSpawnDepth: number;
  private instanceId?: string;
  private spawnedChildInstanceIds = new Set<string>();
  private askUserCallback?: AgentSessionOptions["askUserCallback"];
  private effectiveAllowedTools?: string[];
  private inheritAllTools: boolean;
  private permissionRequestHandler?: AgentSessionOptions["permissionRequestHandler"];
  private sessionId?: string;
  private abortSignal?: AbortSignal;
  private lastCompressionTimestamp = 0;

  constructor(agentName: string, config: AppConfigSchema, options?: AgentSessionOptions) {
    this.agentName = agentName;
    this.config = config;
    this.spawnDepth = options?.spawnDepth ?? 0;
    this.maxSpawnDepth = options?.maxSpawnDepth ?? config.maxSpawnDepth ?? DEFAULT_MAX_SPAWN_DEPTH;
    this.instanceId = options?.instanceId;
    this.askUserCallback = options?.askUserCallback;
    this.inheritAllTools = options?.inheritAllTools ?? false;
    this.permissionRequestHandler = options?.permissionRequestHandler;
    this.sessionId = options?.sessionId;
    this.abortSignal = options?.abortSignal;

    const agent = getAgent(agentName);
    if (!agent) {
      throw createAgentError("AGENT_INIT_ERROR", `Agent 未找到: ${agentName}`, {
        context: { agentName },
      });
    }
    this.agent = agent;

    this.effectiveAllowedTools = resolveEffectiveAllowedTools({
      agentAllowedTools: agent.allowedTools,
      inheritAllTools: this.inheritAllTools,
      inheritedAllowedTools: options?.inheritedAllowedTools,
      spawnDepth: this.spawnDepth,
    });

    const toolInterceptor = createBuiltinToolInterceptor({
      agentName,
      askUserCallback: this.askUserCallback,
      createSpawnExecutor: () => this.createSpawnExecutor(),
      instanceId: this.instanceId,
      spawnDepth: this.spawnDepth,
      spawnedChildInstanceIds: this.spawnedChildInstanceIds,
    });

    const getToolContext = createSessionToolContext({
      abortSignal: this.abortSignal,
      askUserCallback: this.askUserCallback,
      createSpawnExecutor: () => this.createSpawnExecutor(),
      effectiveAllowedTools: this.effectiveAllowedTools,
      inheritAllTools: this.inheritAllTools,
      maxSpawnDepth: this.maxSpawnDepth,
      permissionRequestHandler: this.permissionRequestHandler,
      sessionId: this.sessionId,
      spawnDepth: this.spawnDepth,
      spawnedChildInstanceIds: this.spawnedChildInstanceIds,
    });

    const handlerOptions: ConversationHandlerOptions = buildHandlerOptions({
      effectiveAllowedTools: this.effectiveAllowedTools,
      getToolContext,
      instanceId: this.instanceId,
      options: options ?? {},
      spawnDepth: this.spawnDepth,
      systemPrompt: options?.systemPrompt ?? agent.prompt,
      toolInterceptor,
    });

    this.handler = new agentSessionDeps.ConversationHandler(config, handlerOptions);
    this.handler.setAdditionalToolSchemas(this.instanceId ? getBuiltinAgentToolSchemas(this.spawnDepth) : undefined);

    if (this.instanceId) {
      agentSessionDeps.subagentCollector?.register({
        agentId: this.agentName,
        agentName: this.agent.label || this.agentName,
        instanceId: this.instanceId,
        prompt: options?.systemPrompt,
      });
    }

    log.info(`AgentSession 已创建: ${agentName} (depth=${this.spawnDepth}, instance=${this.instanceId ?? "primary"})`);
  }

  getAgentName(): string {
    return this.agentName;
  }

  getAgentInfo(): AgentInfo {
    return this.agent;
  }

  getStatus(): AgentStatus {
    return this.status;
  }

  getHandler(): ConversationHandler {
    return this.handler;
  }

  getMessages() {
    return this.handler.getMessages();
  }

  getSubagentTasks(): SubagentTask[] {
    return this.subagentTasks.slice();
  }

  getInstanceId(): string | undefined {
    return this.instanceId;
  }

  async sendMessage(content: string): Promise<AgentSessionResult> {
    const startTime = Date.now();

    const runtimeAugmentations = agentSessionDeps.buildAgentRuntimeAugmentations({
      lastCompressionTimestamp: this.lastCompressionTimestamp,
    });
    this.lastCompressionTimestamp = runtimeAugmentations.lastCompressionTimestamp;
    const augmentedContent = runtimeAugmentations.prefix ? `${runtimeAugmentations.prefix}\n\n${content}` : content;

    const enrichedContent = this.instanceId
      ? buildSubAgentInitialMessages(this.agentName, augmentedContent, this.instanceId, this.spawnDepth)
      : augmentedContent;

    this.updateStatus("thinking", "开始处理消息");
    setAgentStatus(this.agentName, "thinking", "开始处理消息");

    let result: ConversationResult | undefined;
    const collector = agentSessionDeps.subagentCollector;

    try {
      this.updateStatus("running", "执行对话循环");
      setAgentStatus(this.agentName, "running", "执行对话循环");

      result = await this.handler.sendMessage(enrichedContent);

      if (this.spawnedChildInstanceIds.size > 0) {
        const childIds = [...this.spawnedChildInstanceIds];
        const runningChildren = childIds.filter((id) => collector?.isRunning(id) ?? false);

        if (runningChildren.length > 0) {
          log.info(`等待 ${runningChildren.length} 个 spawned children 完成...`);
          await collector?.waitForSpawnedAgents(runningChildren, DEFAULT_CHILD_WAIT_TIMEOUT_MS, this.abortSignal);
        }

        const drainer =
          collector ??
          ({
            drainSpawnedResults: () => [],
            drainOrphanedResults: () => [],
          } as import("@/agent/subagent/trackerDrain").SpawnedResultDrainer);
        const aggregatedResults = drainSpawnedChildResults(childIds, drainer);
        for (const sr of aggregatedResults) {
          const statusIcon = sr.success ? symCheck : symCross;
          log.info(`Spawned child 完成: ${sr.agentName} ${statusIcon}`);
        }

        if (aggregatedResults.length > 0) {
          const continuationPrompt = buildSpawnedChildrenContinuationPrompt(aggregatedResults);
          log.info(`将 ${aggregatedResults.length} 个子代理结果注入父代理续接`);
          const continueResult = await this.handler.sendMessage(continuationPrompt);
          result.text = continueResult.text;
          result.ok = continueResult.ok;
          result.error = continueResult.ok ? undefined : continueResult.error;
          result.toolRounds += continueResult.toolRounds;
          result.reasoning = continueResult.reasoning ?? result.reasoning;
          result.usage = continueResult.usage ?? result.usage;
        }
      }

      if (this.instanceId) {
        const pendingMessages = collector?.dequeueMessages(this.instanceId) ?? [];
        const interAgentMessages = collector?.dequeueInterAgentMessages(this.instanceId) ?? [];

        if (pendingMessages.length > 0 || interAgentMessages.length > 0) {
          log.info(`注入 ${pendingMessages.length} 条用户消息, ${interAgentMessages.length} 条 Agent 间消息`);

          const injected: import("ai").ModelMessage[] = [
            ...pendingMessages.map((c) => ({ content: c, role: "user" as const })),
            ...interAgentMessages.map((msg) => ({
              content: `[来自 ${msg.fromAgentName}] ${msg.content}`,
              role: "user" as const,
            })),
          ];
          this.handler.injectMessages(injected);
        }
      }

      const durationMs = Date.now() - startTime;

      if (result.ok) {
        this.updateStatus("completed", "对话完成");
        setAgentStatus(this.agentName, "completed", "对话完成");
      } else {
        this.updateStatus("error", result.error ?? "未知错误");
        setAgentStatus(this.agentName, "error", result.error ?? "未知错误");
      }

      return {
        agentName: this.agentName,
        durationMs,
        error: result.ok ? undefined : result.error,
        ok: result.ok,
        reasoning: result.reasoning,
        text: result.text,
        toolRounds: result.toolRounds,
        usage: result.usage,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : String(error);

      this.updateStatus("error", errorMsg);
      setAgentStatus(this.agentName, "error", errorMsg);

      return {
        agentName: this.agentName,
        durationMs,
        error: errorMsg,
        ok: false,
        text: "",
        toolRounds: 0,
      };
    } finally {
      this.spawnedChildInstanceIds.clear();
    }
  }

  async spawnSubagent(subagentName: string, prompt: string): Promise<AgentSessionResult> {
    return spawnSubagent(
      {
        abortSignal: this.abortSignal,
        agentName: this.agentName,
        askUserCallback: this.askUserCallback,
        config: this.config,
        effectiveAllowedTools: this.effectiveAllowedTools,
        inheritAllTools: this.inheritAllTools,
        maxSpawnDepth: this.maxSpawnDepth,
        permissionRequestHandler: this.permissionRequestHandler,
        spawnDepth: this.spawnDepth,
      },
      subagentName,
      prompt,
      this.subagentTasks,
    );
  }

  clearHistory(): void {
    this.handler.clearHistory();
  }

  destroy(): void {
    destroySession(
      {
        agentName: this.agentName,
        handler: this.handler,
        instanceId: this.instanceId,
        spawnedChildInstanceIds: this.spawnedChildInstanceIds,
      },
      {
        subagentTasks: this.subagentTasks,
        updateStatus: (status, reason) => this.updateStatus(status, reason),
      },
    );
  }

  private updateStatus(status: AgentStatus, reason?: string): void {
    this.status = updateSessionStatus(this.status, status, this.agentName, reason);
  }

  private createSpawnExecutor() {
    return createSessionSpawnExecutor(
      {
        abortSignal: this.abortSignal,
        agentName: this.agentName,
        askUserCallback: this.askUserCallback,
        config: this.config,
        effectiveAllowedTools: this.effectiveAllowedTools,
        inheritAllTools: this.inheritAllTools,
        maxSpawnDepth: this.maxSpawnDepth,
        permissionRequestHandler: this.permissionRequestHandler,
        spawnDepth: this.spawnDepth,
      },
      // 错误回调: 在 spawn executor 失败时同步父 session 状态(避免主循环不知情)
      (errorMsg) => {
        this.updateStatus("error", `spawn executor 失败: ${errorMsg}`);
      },
    );
  }
}

export { getAgentModel, getToolsForAgent } from "./model";
