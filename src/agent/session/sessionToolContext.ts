/**
 * AgentSession 工具上下文构建: ConversationHandler 的 toolInterceptor + getToolContext 工厂.
 *
 * 职责:
 *   - 构造 builtin tool 的拦截器(覆盖 askuser-* / subagent-builtin)
 *   - 构造 LLM 工具调用时的 ToolContext(askUser / getSubagentStatus / spawnSubagent / stopSubagent)
 *
 * 边界:
 *   1. 不持有 session 状态, 只接收 session 引用的"快照", 便于单测
 *   2. 不直接调用 EventBus, 由上层协调
 */
import { BUILTIN_AGENT_TOOL_NAMES, injectBuiltinToolNames } from "@/agent/subagent/builtinTools";
import {
  type InterceptedToolCall,
  type InterceptorContext,
  type SpawnExecutor,
  interceptBuiltinTools,
} from "@/agent/subagent/toolInterceptor";
import type {
  ConversationHandlerOptions,
  ToolInterceptor,
  ToolInterceptorContext,
  ToolInterceptorResult,
} from "@/conversation";
import { subAgentTracker } from "@/agent/subagent/tracker";
import { createBaseToolContext } from "@/tool/executor/runtimeExec";
import type { ToolContext } from "@/tool/types";
import { createUserError } from "@/core/errors/appError";
import { toolNameMatches } from "@/tool/registry/toolNameMatcher";
import { spawnToolSubagent } from "./sessionSubagent";
import type { AgentSessionOptions } from "./types";

/**
 * 判断给定 toolName 是否为本会话需拦截的 builtin 工具.
 */
function isBuiltinAgentTool(toolName: string): boolean {
  return (
    BUILTIN_AGENT_TOOL_NAMES.includes(toolName as (typeof BUILTIN_AGENT_TOOL_NAMES)[number]) ||
    toolName.startsWith("askuser-")
  );
}

/**
 * 构造 ConversationHandler 的 toolInterceptor.
 * 拦截 builtin 工具并委托给 interceptBuiltinTools 统一处理.
 */
export function createBuiltinToolInterceptor(ctx: {
  agentName: string;
  instanceId?: string;
  askUserCallback?: AgentSessionOptions["askUserCallback"];
  spawnDepth: number;
  createSpawnExecutor: () => SpawnExecutor;
  spawnedChildInstanceIds: Set<string>;
}): ToolInterceptor {
  const interceptorCtx: InterceptorContext = {
    agentId: ctx.agentName,
    agentName: ctx.agentName,
    askUserCallback: ctx.askUserCallback as InterceptorContext["askUserCallback"],
    instanceId: ctx.instanceId,
    spawnDepth: ctx.spawnDepth,
    spawnExecutor: ctx.createSpawnExecutor(),
    spawnedChildInstanceIds: ctx.spawnedChildInstanceIds,
  };

  return async (
    toolName: string,
    toolCallId: string,
    args: unknown,
    _context: ToolInterceptorContext,
  ): Promise<ToolInterceptorResult> => {
    if (!isBuiltinAgentTool(toolName)) {
      return { handled: false };
    }

    const toolCall: InterceptedToolCall = {
      args: (args as Record<string, unknown>) ?? {},
      toolCallId,
      toolName,
    };

    const { results } = await interceptBuiltinTools(interceptorCtx, [toolCall]);

    const [first] = results;
    if (first) {
      return {
        handled: true,
        isError: first.isError,
        output: first.output,
      };
    }

    return { handled: false };
  };
}

/**
 * 构造 ConversationHandlerOptions.allowedTools.
 * 合并 agent.allowedTools 与父代理继承的 allowedTools, 再注入 builtin 工具名.
 *
 * @returns 合并后的工具白名单; undefined 表示无限制
 */
export function resolveEffectiveAllowedTools(input: {
  inheritAllTools: boolean;
  agentAllowedTools: readonly string[] | undefined;
  inheritedAllowedTools: readonly string[] | undefined;
  spawnDepth: number;
}): string[] | undefined {
  if (input.inheritAllTools) {
    return undefined;
  }
  const merged = mergeInheritedAllowedTools(input.agentAllowedTools, input.inheritedAllowedTools);
  if (!merged) {
    return undefined;
  }
  return injectBuiltinToolNames(merged, input.spawnDepth);
}

/**
 * 合并 agent 自有 allowedTools 与父代理继承的 allowedTools.
 * 合并语义:
 *   - 仅一侧存在时，直接继承该侧
 *   - 两侧都存在时，取交集，确保子代理不能放大父级权限边界
 * 两者均为空时返回 undefined(无限制).
 */
function mergeInheritedAllowedTools(
  agentTools: readonly string[] | undefined,
  inheritedTools: readonly string[] | undefined,
): string[] | undefined {
  if (!agentTools && !inheritedTools) {
    return undefined;
  }
  if (!agentTools) {
    return [...inheritedTools!];
  }
  if (!inheritedTools) {
    return [...agentTools];
  }

  return inheritedTools.filter((inheritedTool) =>
    agentTools.some(
      (agentTool) => toolNameMatches(inheritedTool, agentTool) || toolNameMatches(agentTool, inheritedTool),
    ),
  );
}

/**
 * 构造 LLM 工具调用时的 ToolContext(由 ConversationHandler 在执行工具时调用).
 * 包含:
 *   - askUser: 用户交互
 *   - getSubagentStatus / listSubagents: 子代理查询
 *   - spawnSubagent / stopSubagent: 子代理生命周期
 */
export function createSessionToolContext(deps: {
  sessionId?: string;
  abortSignal?: AbortSignal;
  askUserCallback?: AgentSessionOptions["askUserCallback"];
  spawnDepth: number;
  maxSpawnDepth: number;
  effectiveAllowedTools?: string[];
  inheritAllTools: boolean;
  permissionRequestHandler?: AgentSessionOptions["permissionRequestHandler"];
  createSpawnExecutor: () => SpawnExecutor;
  spawnedChildInstanceIds: Set<string>;
}): () => ToolContext {
  return () => ({
    ...createBaseToolContext(deps.sessionId ?? "", deps.abortSignal),
    askUser: async (params) => {
      if (!deps.askUserCallback) {
        throw createUserError("INVALID_INPUT", "当前环境不支持用户交互");
      }
      const result = await deps.askUserCallback(
        params.question,
        params.options?.map((o) => o.label) ?? [],
        params.multiSelect ?? false,
      );
      return Array.isArray(result.selected) ? result.selected.join(", ") : result.selected;
    },
    getSubagentStatus: (agentId: string) => {
      const agent = subAgentTracker.findInstanceByAgentId(agentId);
      if (!agent) {
        return null;
      }
      return {
        agentId: agent.agentId,
        agentName: agent.agentName,
        instanceId: agent.instanceId,
        status: subAgentTracker.isRunning(agent.instanceId) ? "running" : "completed",
      };
    },
    listSubagents: () =>
      subAgentTracker.listRunning().map((a) => ({
        agentId: a.agentId,
        agentName: a.agentName,
        instanceId: a.instanceId,
      })),
    spawnSubagent: (params) => {
      spawnToolSubagent(params, {
        createSpawnExecutor: deps.createSpawnExecutor,
        spawnDepth: deps.spawnDepth,
        maxSpawnDepth: deps.maxSpawnDepth,
        spawnedChildInstanceIds: deps.spawnedChildInstanceIds,
      });
    },
    stopSubagent: (agentId: string) => {
      const agent = subAgentTracker.findInstanceByAgentId(agentId);
      if (agent) {
        subAgentTracker.unregister(agent.instanceId);
      }
    },
  });
}

/**
 * 构造 ConversationHandlerOptions(便于 AgentSession 在主构造中聚合所有配置).
 */
export function buildHandlerOptions(input: {
  effectiveAllowedTools: string[] | undefined;
  instanceId?: string;
  spawnDepth: number;
  options: AgentSessionOptions;
  systemPrompt: string;
  getToolContext: () => ToolContext;
  toolInterceptor: ToolInterceptor;
}): ConversationHandlerOptions {
  return {
    abortSignal: input.options.abortSignal,
    allowedTools: input.effectiveAllowedTools,
    compactionConfig: input.options.compactionConfig,
    getToolContext: input.getToolContext,
    maxToolRounds: input.options.maxToolRounds,
    permissionRequestHandler: input.options.permissionRequestHandler,
    sessionId: input.options.sessionId,
    systemPrompt: input.systemPrompt,
    toolInterceptor: input.toolInterceptor,
    toolInterceptorContext: { instanceId: input.instanceId },
  };
}
