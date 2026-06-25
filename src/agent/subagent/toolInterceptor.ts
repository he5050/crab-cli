/**
 * 子代理工具拦截器 — 在 tool_calls 执行前拦截内置协作工具调用。
 *
 * 职责:
 *   - 拦截子代理的内置协作工具调用
 *   - 处理子代理间消息传递
 *   - 查询运行中子代理状态
 *   - 处理子代理 spawn 请求
 *   - 中继用户交互请求到主会话
 *
 * 模块功能:
 *   - interceptSendMessage: 拦截 send_message_to_agent 工具
 *   - interceptQueryStatus: 拦截 query_agents_status 工具
 *   - interceptSpawnSubAgent: 拦截 spawn_sub_agent 工具
 *   - interceptAskUser: 拦截 askuser 工具
 *   - interceptBuiltinTools: 统一拦截所有内置工具
 *   - InterceptedToolCall: 拦截的工具调用接口
 *   - InterceptedToolResult: 拦截结果接口
 *   - InterceptorContext: 拦截器上下文
 *   - SpawnExecutor: spawn 执行函数类型
 *
 * 使用场景:
 *   - 子代理需要与其他子代理通信
 *   - 子代理需要查询其他子代理状态
 *   - 子代理需要 spawn 更深层的子代理
 *   - 子代理需要向用户提问
 *
 * 边界:
 *   1. 仅拦截内置协作工具，其他工具交给正常执行流程
 *   2. 拦截器返回 { handled, result, remaining } 结构
 *   3. handled=true 的工具由拦截器直接处理
 *   4. remaining 中的工具继续走正常执行流程
 *   5. spawn 子代理时检查自身 spawn 保护(不允许 spawn 同类型)
 *
 * 流程:
 *   1. AgentSession 创建时构建工具拦截器
 *   2. 工具调用时先经过 interceptBuiltinTools()
 *   3. 按顺序尝试拦截 4 类内置工具
 *   4. 匹配的工具直接处理并返回结果
 *   5. 未匹配的工具留在 remaining 中继续正常执行
 */
import { subAgentTracker } from "./tracker";
import { getAgent } from "@/agent/core/manager";
import { createLogger } from "@/core/logging/logger";
import { prefixedId } from "@/core/id";

const log = createLogger("agent:tool-interceptor");

// ─── 类型 ────────────────────────────────────────────────────

/** 拦截器处理的工具调用 */
export interface InterceptedToolCall {
  toolName: string;
  toolCallId: string;
  args: Record<string, unknown>;
}

/** 拦截器返回的工具结果 */
export interface InterceptedToolResult {
  toolCallId: string;
  output: unknown;
  isError: boolean;
}

/** 单个工具的拦截结果 */
export interface InterceptResult {
  /** 已处理的工具调用(从 remaining 中移除) */
  handled: InterceptedToolCall[];
  /** 处理结果 */
  results: InterceptedToolResult[];
  /** 未处理的工具调用(继续走正常执行流程) */
  remaining: InterceptedToolCall[];
}

/** Subagent-spawn 的执行函数类型 */
export type SpawnExecutor = (
  agentId: string,
  prompt: string,
  instanceId: string,
  spawnDepth: number,
) => Promise<{ success: boolean; result: string; error?: string }>;

/** Askuser 的回调类型 */
export type AskUserCallback = (
  question: string,
  options: string[],
  multiSelect: boolean,
) => Promise<{ selected: string | string[]; customInput?: string }>;

/** 拦截器上下文 */
export interface InterceptorContext {
  /** 当前子代理实例 ID */
  instanceId: string | undefined;
  /** 当前子代理的 agent ID */
  agentId: string;
  /** 当前子代理的 agent 名称 */
  agentName: string;
  /** Spawn 深度 */
  spawnDepth: number;
  /** Spawn 执行函数 */
  spawnExecutor?: SpawnExecutor;
  /** Askuser 回调 */
  askUserCallback?: AskUserCallback;
  /** 已 spawn 的子实例 ID 集合(用于 spawned children 管理) */
  spawnedChildInstanceIds: Set<string>;
}

// ─── 参数解析工具函数 ──────────────────────────────────────────

/** 安全获取字符串参数，失败时返回 undefined */
function getStringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

// ─── agent-comms-send-message ───────────────────────────────────

/**
 * 拦截 agent-comms-send-message 工具调用。
 *
 * 解析参数 → 通过 tracker 发送消息 → 构造 tool result。
 */
export function interceptSendMessage(ctx: InterceptorContext, toolCalls: InterceptedToolCall[]): InterceptResult {
  const matched = toolCalls.filter((tc) => tc.toolName === "send_message_to_agent");

  if (matched.length === 0 || !ctx.instanceId) {
    return { handled: [], remaining: toolCalls, results: [] };
  }

  const results: InterceptedToolResult[] = [];

  for (const tc of matched) {
    const targetAgentId = getStringArg(tc.args, "target_agent_id");
    const targetInstanceId = getStringArg(tc.args, "target_instance_id");
    const msgContent = getStringArg(tc.args, "message") ?? "";

    let success = false;
    let resultText = "";

    if (!msgContent) {
      resultText = "Error: message content is empty";
    } else if (targetInstanceId) {
      success = subAgentTracker.sendInterAgentMessage(ctx.instanceId!, targetInstanceId, msgContent);
      if (success) {
        const targetAgent = subAgentTracker.listRunning().find((a) => a.instanceId === targetInstanceId);
        resultText = `Message sent to ${targetAgent?.agentName || targetInstanceId}`;
      } else {
        resultText = `Error: Target agent instance "${targetInstanceId}" is not running`;
      }
    } else if (targetAgentId) {
      const targetAgent = subAgentTracker.findInstanceByAgentId(targetAgentId);
      if (targetAgent && targetAgent.instanceId !== ctx.instanceId) {
        success = subAgentTracker.sendInterAgentMessage(ctx.instanceId!, targetAgent.instanceId, msgContent);
        if (success) {
          resultText = `Message sent to ${targetAgent.agentName} (instance: ${targetAgent.instanceId})`;
        } else {
          resultText = `Error: Failed to send message to ${targetAgentId}`;
        }
      } else if (targetAgent && targetAgent.instanceId === ctx.instanceId) {
        resultText = "Error: Cannot send a message to yourself";
      } else {
        resultText = `Error: No running agent found with ID "${targetAgentId}"`;
      }
    } else {
      resultText = "Error: Either target_agent_id or target_instance_id must be provided";
    }

    results.push({
      isError: false,
      output: { result: resultText, success },
      toolCallId: tc.toolCallId,
    });

    log.debug(`agent-comms-send-message: ${resultText}`);
  }

  const remaining = toolCalls.filter((tc) => tc.toolName !== "send_message_to_agent");

  return { handled: matched, remaining, results };
}

// ─── agent-comms-query-status ─────────────────────────────────────

/**
 * 拦截 agent-comms-query-status 工具调用。
 *
 * 查询 tracker → 返回所有运行中子代理的状态。
 */
export function interceptQueryStatus(ctx: InterceptorContext, toolCalls: InterceptedToolCall[]): InterceptResult {
  const matched = toolCalls.filter((tc) => tc.toolName === "query_agents_status");

  if (matched.length === 0) {
    return { handled: [], remaining: toolCalls, results: [] };
  }

  const results: InterceptedToolResult[] = [];

  for (const tc of matched) {
    const allAgents = subAgentTracker.listRunning();
    const statusList = allAgents.map((a) => ({
      agentId: a.agentId,
      agentName: a.agentName,
      instanceId: a.instanceId,
      isSelf: a.instanceId === ctx.instanceId,
      prompt: a.prompt || "N/A",
      runningFor: `${Math.floor((Date.now() - a.startedAt.getTime()) / 1000)}s`,
    }));

    results.push({
      isError: false,
      output: {
        agents: statusList,
        totalRunning: allAgents.length,
      },
      toolCallId: tc.toolCallId,
    });
  }

  const remaining = toolCalls.filter((tc) => tc.toolName !== "query_agents_status");

  return { handled: matched, remaining, results };
}

// ─── subagent-spawn ─────────────────────────────────────────

/**
 * 拦截 subagent-spawn 工具调用。
 *
 * 验证参数 → 自身 spawn 保护 → 注册新实例 → 异步执行 → 结果存入 tracker。
 */
export function interceptSpawnSubAgent(ctx: InterceptorContext, toolCalls: InterceptedToolCall[]): InterceptResult {
  const matched = toolCalls.filter((tc) => tc.toolName === "spawn_sub_agent");

  if (matched.length === 0 || !ctx.instanceId) {
    return { handled: [], remaining: toolCalls, results: [] };
  }

  const results: InterceptedToolResult[] = [];

  for (const tc of matched) {
    const spawnAgentId = getStringArg(tc.args, "agent_id");
    const spawnPrompt = getStringArg(tc.args, "prompt");

    if (!spawnAgentId || !spawnPrompt) {
      results.push({
        isError: false,
        output: { error: "Both agent_id and prompt are required", success: false },
        toolCallId: tc.toolCallId,
      });
      continue;
    }

    // 自身 spawn 保护
    if (spawnAgentId === ctx.agentId) {
      results.push({
        isError: false,
        output: {
          error: `REJECTED: You (${ctx.agentName}) attempted to spawn another "${spawnAgentId}" which is the SAME type as yourself. This is not allowed because it wastes resources and delegates work you should complete yourself. If you need help from a DIFFERENT specialization, spawn a different agent type.`,
          success: false,
        },
        toolCallId: tc.toolCallId,
      });
      continue;
    }

    // 检查目标 agent 是否存在
    const agentDef = getAgent(spawnAgentId);
    const spawnAgentName = agentDef?.label || agentDef?.name || spawnAgentId;

    const spawnInstanceId = prefixedId("spawn");

    ctx.spawnedChildInstanceIds.add(spawnInstanceId);

    // 异步执行 spawn(如果有 spawnExecutor)
    if (!ctx.spawnExecutor) {
      results.push({
        isError: false,
        output: {
          error: "Spawn executor not available in current context",
          success: false,
        },
        toolCallId: tc.toolCallId,
      });
      continue;
    }

    // 注册到 tracker
    const childAbortController = new AbortController();
    subAgentTracker.register({
      abortController: childAbortController,
      agentId: spawnAgentId,
      agentName: spawnAgentName,
      instanceId: spawnInstanceId,
      prompt: spawnPrompt,
    });

    // 异步执行 spawn
    ctx
      .spawnExecutor(spawnAgentId, spawnPrompt, spawnInstanceId, ctx.spawnDepth + 1)
      .then((result) => {
        subAgentTracker.storeSpawnedResult({
          agentId: spawnAgentId,
          agentName: spawnAgentName,
          completedAt: new Date(),
          error: result.error,
          instanceId: spawnInstanceId,
          prompt: spawnPrompt.length > 200 ? `${spawnPrompt.substring(0, 200)}...` : spawnPrompt,
          result: result.result,
          success: result.success,
        });
      })
      .catch((error: unknown) => {
        const errMsg = error instanceof Error ? error.message : "Unknown error";
        subAgentTracker.storeSpawnedResult({
          agentId: spawnAgentId,
          agentName: spawnAgentName,
          completedAt: new Date(),
          error: errMsg,
          instanceId: spawnInstanceId,
          prompt: spawnPrompt.length > 200 ? `${spawnPrompt.substring(0, 200)}...` : spawnPrompt,
          result: "",
          success: false,
        });
      })
      .finally(() => {
        subAgentTracker.unregister(spawnInstanceId);
      });

    log.info(`子代理 spawn: ${spawnAgentName} (${spawnInstanceId}), 父: ${ctx.agentName}`);

    results.push({
      isError: false,
      output: {
        result: `Agent "${spawnAgentName}" (${spawnAgentId}) has been spawned and is now running in the background with instance ID "${spawnInstanceId}". Its results will be automatically reported to the main workflow when it completes.`,
        success: true,
      },
      toolCallId: tc.toolCallId,
    });
  }

  const remaining = toolCalls.filter((tc) => tc.toolName !== "spawn_sub_agent");

  return { handled: matched, remaining, results };
}

// ─── askuser ─────────────────────────────────────────────────

/**
 * 拦截 askuser-* 工具调用。
 *
 * 将子代理的用户交互请求中继到主会话 UI。
 */
export async function interceptAskUser(
  ctx: InterceptorContext,
  toolCalls: InterceptedToolCall[],
): Promise<InterceptResult> {
  const matched = toolCalls.find((tc) => tc.toolName.startsWith("askuser-") || tc.toolName === "askuser-ask-question");

  if (!matched || !ctx.askUserCallback) {
    return { handled: [], remaining: toolCalls, results: [] };
  }

  let question = "Please select an option:";
  let options: string[] = ["Yes", "No"];
  let multiSelect = false;

  try {
    if (matched.args["question"]) {
      question = getStringArg(matched.args, "question") ?? question;
    }
    const rawOptions = matched.args["options"];
    if (Array.isArray(rawOptions) && rawOptions.length > 0 && typeof rawOptions[0] === "string") {
      options = rawOptions as string[];
    }
    if (matched.args["multiSelect"] === true) {
      multiSelect = true;
    }
  } catch {
    // 参数解析失败，使用默认值
  }

  try {
    const userAnswer = await ctx.askUserCallback(question, options, multiSelect);

    const answerText = userAnswer.customInput
      ? `${Array.isArray(userAnswer.selected) ? userAnswer.selected.join(", ") : userAnswer.selected}: ${userAnswer.customInput}`
      : Array.isArray(userAnswer.selected)
        ? userAnswer.selected.join(", ")
        : userAnswer.selected;

    const result = {
      isError: false,
      output: {
        answer: answerText,
        customInput: userAnswer.customInput,
        selected: userAnswer.selected,
      },
      toolCallId: matched.toolCallId,
    };

    const remaining = toolCalls.filter((tc) => tc.toolCallId !== matched.toolCallId);

    return { handled: [matched], remaining, results: [result] };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const result = {
      isError: true,
      output: { error: `AskUser failed: ${errMsg}` },
      toolCallId: matched.toolCallId,
    };

    const remaining = toolCalls.filter((tc) => tc.toolCallId !== matched.toolCallId);

    return { handled: [matched], remaining, results: [result] };
  }
}

// ─── 统一拦截入口 ────────────────────────────────────────────

/**
 * 统一拦截所有内置工具调用。
 *
 * 按顺序尝试拦截 4 个内置工具，未匹配的交给正常执行流程。
 */
export async function interceptBuiltinTools(
  ctx: InterceptorContext,
  toolCalls: InterceptedToolCall[],
): Promise<{ results: InterceptedToolResult[]; remaining: InterceptedToolCall[] }> {
  const allResults: InterceptedToolResult[] = [];
  let remaining = [...toolCalls];

  // 1. agent-comms-send-message
  const sendResult = interceptSendMessage(ctx, remaining);
  allResults.push(...sendResult.results);
  ({ remaining } = sendResult);

  // 2. agent-comms-query-status
  const queryResult = interceptQueryStatus(ctx, remaining);
  allResults.push(...queryResult.results);
  ({ remaining } = queryResult);

  // 3. subagent-spawn
  const spawnResult = interceptSpawnSubAgent(ctx, remaining);
  allResults.push(...spawnResult.results);
  ({ remaining } = spawnResult);

  // 4. askuser
  const askResult = await interceptAskUser(ctx, remaining);
  allResults.push(...askResult.results);
  ({ remaining } = askResult);

  return { remaining, results: allResults };
}
