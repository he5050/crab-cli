/**
 * AgentSession 子代理编排: spawnSubagent + createSpawnExecutor + spawnToolSubagent.
 *
 * 职责:
 *   - 递归创建子 AgentSession 并管理其生命周期
 *   - 执行 SubAgentStart / SubAgentStop hooks
 *   - 处理 hook 注入的续接(shouldContinueConversation)
 *   - 等待 spawned children 完成并构建续接提示词(在 sendMessage 中调用)
 *   - spawnToolSubagent: 由 ToolContext 调用的底层 spawn 入口
 *
 * 边界:
 *   1. 不直接修改父 session 状态(只更新 subagentTasks)
 *   2. 子代理的创建参数由父 session 控制(继承 allowedTools / spawnDepth 等)
 */
import { setAgentStatus } from "@/agent/core/manager";
import { AgentSession } from "./session";
import { agentSessionDeps } from "./sessionDeps";
import { createId } from "@/core/identity";
import { createLogger } from "@/core/logging/logger";
import { prefixedId } from "@/core/id";
import { agentEvents } from "@/agent/core/agentEvents";
import { buildSpawnedToolResult, subAgentTracker } from "@/agent/subagent/tracker";
import type { AgentSessionResult, AgentSessionOptions, SubagentTask } from "./types";
import type { SpawnExecutor } from "@/agent/subagent/toolInterceptor";
import type { ToolContext } from "@/tool/types";
import type { AppConfigSchema } from "@/schema/config";

const log = createLogger("agent:session-subagent");

// ─── 公共子 session 创建与执行 ─────────────────────────────────

/** 创建子 AgentSession 所需的公共参数 */
interface ChildSessionParams {
  agentName: string;
  config: AppConfigSchema;
  prompt: string;
  instanceId: string;
  spawnDepth: number;
  abortSignal?: AbortSignal;
  askUserCallback?: AgentSession["askUserCallback"];
  permissionRequestHandler?: AgentSessionOptions["permissionRequestHandler"];
  effectiveAllowedTools?: string[];
  inheritAllTools: boolean;
  maxSpawnDepth?: number;
}

/**
 * 创建子 AgentSession 并执行 sendMessage，统一生命周期管理.
 * 被 spawnSubagent 和 createSessionSpawnExecutor 共同使用，消除重复逻辑.
 */
async function createAndRunChildSession(params: ChildSessionParams): Promise<AgentSessionResult> {
  let subSession: AgentSession | undefined;
  try {
    subSession = new AgentSession(params.agentName, params.config, {
      abortSignal: params.abortSignal,
      askUserCallback: params.askUserCallback,
      inheritAllTools: params.inheritAllTools || !params.effectiveAllowedTools,
      inheritedAllowedTools: params.effectiveAllowedTools,
      instanceId: params.instanceId,
      maxSpawnDepth: params.maxSpawnDepth,
      maxToolRounds: 5,
      permissionRequestHandler: params.permissionRequestHandler
        ? (params.permissionRequestHandler as AgentSessionOptions["permissionRequestHandler"])
        : undefined,
      spawnDepth: params.spawnDepth,
      systemPrompt: params.prompt,
    });

    const sessionResult = await subSession.sendMessage(params.prompt);

    return {
      agentName: params.agentName,
      durationMs: sessionResult.durationMs,
      error: sessionResult.ok ? undefined : sessionResult.error,
      ok: sessionResult.ok,
      reasoning: sessionResult.reasoning,
      text: sessionResult.text,
      toolRounds: sessionResult.toolRounds,
      usage: sessionResult.usage,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      agentName: params.agentName,
      durationMs: 0,
      error: errorMsg,
      ok: false,
      text: "",
      toolRounds: 0,
    };
  } finally {
    subSession?.destroy();
  }
}

// ─── spawnSubagent（带 hook + 任务管理）──────────────────────────

/**
 * 父代理 spawn 一个子代理并执行其 prompt.
 * 流程:
 *   1. 深度/同名校验
 *   2. 创建任务记录
 *   3. 触发 SubAgentStart hook
 *   4. 构造子 AgentSession 并 sendMessage（委托 createAndRunChildSession）
 *   5. 触发 SubAgentStop hook; 若 hook 请求续接且子代理失败, 再 sendMessage
 *   6. 更新任务状态 + 广播 SubagentCompleted 事件
 *
 * @param parent 父 session 的相关状态与配置
 * @returns 子代理的最终结果
 */
export async function spawnSubagent(
  parent: {
    agentName: string;
    config: AppConfigSchema;
    effectiveAllowedTools?: string[];
    inheritAllTools: boolean;
    askUserCallback?: AgentSession["askUserCallback"];
    permissionRequestHandler?: AgentSessionOptions["permissionRequestHandler"];
    spawnDepth: number;
    maxSpawnDepth: number;
    abortSignal?: AbortSignal;
  },
  subagentName: string,
  prompt: string,
  taskList: SubagentTask[],
): Promise<AgentSessionResult> {
  // 1. 深度校验
  if (parent.spawnDepth >= parent.maxSpawnDepth) {
    const errMsg = `子代理递归深度已达上限 (${parent.maxSpawnDepth})，无法继续 spawn`;
    log.warn(errMsg);
    return { agentName: subagentName, durationMs: 0, error: errMsg, ok: false, text: "", toolRounds: 0 };
  }
  if (subagentName === parent.agentName) {
    const errMsg = `不允许 spawn 同类型的子代理 (${subagentName})，请使用不同类型的 Agent`;
    log.warn(errMsg);
    return { agentName: subagentName, durationMs: 0, error: errMsg, ok: false, text: "", toolRounds: 0 };
  }

  // 2. 创建任务记录
  const task: SubagentTask = {
    agentName: subagentName,
    id: createId("sat"),
    prompt,
    status: "pending",
  };
  taskList.push(task);

  const subInstanceId = prefixedId("sub");
  log.info(`子代理启动: ${subagentName} (task=${task.id}, instance=${subInstanceId})`);

  // 3. SubAgentStart hook
  await agentSessionDeps.hookExecutor.subAgentStart(task.id, subagentName, parent.agentName);
  agentEvents.subagentStarted({
    parentAgent: parent.agentName,
    subagentName,
    taskId: task.id,
  });

  task.status = "running";
  task.startTime = Date.now();

  try {
    // 4. 委托公共函数构造子 session 并执行
    const result = await createAndRunChildSession({
      agentName: subagentName,
      config: parent.config,
      effectiveAllowedTools: parent.effectiveAllowedTools,
      inheritAllTools: parent.inheritAllTools,
      askUserCallback: parent.askUserCallback,
      permissionRequestHandler: parent.permissionRequestHandler,
      abortSignal: parent.abortSignal,
      spawnDepth: parent.spawnDepth + 1,
      maxSpawnDepth: parent.maxSpawnDepth,
      prompt,
      instanceId: subInstanceId,
    });

    task.status = result.ok ? "completed" : "error";
    task.endTime = Date.now();
    task.result = result;

    agentEvents.subagentCompleted({
      durationMs: task.endTime - (task.startTime ?? task.endTime),
      parentAgent: parent.agentName,
      subagentName,
      success: result.ok,
      taskId: task.id,
    });

    // 5. SubAgentStop hook: 若请求续接且子代理失败, 构造新 session 再次 sendMessage
    const hookResults = await agentSessionDeps.hookExecutor.subAgentStop(
      task.id,
      subagentName,
      result.ok,
      parent.agentName,
    );

    for (const hr of hookResults) {
      if (hr.decision.action === "inject" && hr.success) {
        const injectDecision = hr.decision;
        if (injectDecision.shouldContinueConversation && !result.ok) {
          log.info(`SubAgentStop Hook 请求继续子代理对话: ${subagentName}`);
          const continueResult = await createAndRunChildSession({
            agentName: subagentName,
            config: parent.config,
            effectiveAllowedTools: parent.effectiveAllowedTools,
            inheritAllTools: parent.inheritAllTools,
            askUserCallback: parent.askUserCallback,
            permissionRequestHandler: parent.permissionRequestHandler,
            abortSignal: parent.abortSignal,
            spawnDepth: parent.spawnDepth + 1,
            maxSpawnDepth: parent.maxSpawnDepth,
            prompt: injectDecision.message,
            instanceId: prefixedId("sub-continue"),
          });
          result.text = continueResult.text;
          result.ok = continueResult.ok;
          result.error = continueResult.ok ? undefined : continueResult.error;
          result.toolRounds += continueResult.toolRounds;
          result.durationMs += continueResult.durationMs;
          task.status = result.ok ? "completed" : "error";
          task.result = result;
        }
      }
    }

    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    task.status = "error";
    task.endTime = Date.now();

    agentEvents.subagentCompleted({
      durationMs: task.endTime - (task.startTime ?? task.endTime),
      parentAgent: parent.agentName,
      subagentName,
      success: false,
      taskId: task.id,
    });

    await agentSessionDeps.hookExecutor.subAgentStop(task.id, subagentName, false, parent.agentName);

    return {
      agentName: subagentName,
      durationMs: task.endTime - (task.startTime ?? task.endTime),
      error: errorMsg,
      ok: false,
      text: "",
      toolRounds: 0,
    };
  }
}

// ─── createSessionSpawnExecutor（底层 executor 闭包）──────────────

/**
 * 构造 spawnExecutor 闭包(供 toolInterceptor / createSessionToolContext 使用).
 * 使用公共 createAndRunChildSession，错误路径额外通知父 session 状态.
 */
export function createSessionSpawnExecutor(
  parent: {
    agentName: string;
    config: AppConfigSchema;
    effectiveAllowedTools?: string[];
    inheritAllTools: boolean;
    askUserCallback?: AgentSession["askUserCallback"];
    permissionRequestHandler?: AgentSessionOptions["permissionRequestHandler"];
    spawnDepth: number;
    maxSpawnDepth: number;
    abortSignal?: AbortSignal;
  },
  onError?: (errorMsg: string) => void,
): SpawnExecutor {
  return async (
    agentId: string,
    prompt: string,
    instanceId: string,
    spawnDepth: number,
  ): Promise<{ success: boolean; result: string; error?: string }> => {
    // 深度校验（防止通过 ToolContext 绕过）
    if (spawnDepth >= parent.maxSpawnDepth) {
      const errMsg = `子代理递归深度已达上限 (${parent.maxSpawnDepth})，无法继续 spawn`;
      log.warn(errMsg);
      onError?.(errMsg);
      return { error: errMsg, result: "", success: false };
    }

    // 委托公共函数（内部已有 destroy 保证）
    const result = await createAndRunChildSession({
      agentName: agentId,
      config: parent.config,
      effectiveAllowedTools: parent.effectiveAllowedTools,
      inheritAllTools: parent.inheritAllTools,
      askUserCallback: parent.askUserCallback,
      permissionRequestHandler: parent.permissionRequestHandler,
      abortSignal: parent.abortSignal,
      spawnDepth,
      prompt,
      instanceId,
    });

    // 错误路径通知父 session 状态
    if (!result.ok && result.error) {
      setAgentStatus(parent.agentName, "error", result.error);
      onError?.(result.error);
    }

    return {
      error: result.ok ? undefined : result.error,
      result: result.text,
      success: result.ok,
    };
  };
}

// ─── spawnToolSubagent（从原 toolContext.ts 合并）─────────────────

/** spawn 工具子代理所需的依赖与状态 */
export interface SpawnToolSubagentDeps {
  spawnDepth: number;
  maxSpawnDepth: number;
  spawnedChildInstanceIds: Set<string>;
  createSpawnExecutor: () => SpawnExecutor;
}

/**
 * 由 ToolContext.spawnSubagent 调用的底层 spawn 入口.
 * 校验深度限制后注册子代理到 tracker 并异步执行.
 */
export function spawnToolSubagent(
  params: Parameters<NonNullable<ToolContext["spawnSubagent"]>>[0],
  deps: SpawnToolSubagentDeps,
): void {
  // 深度校验（防止 LLM 通过 spawn_sub_agent 工具无限递归）
  if (deps.spawnDepth >= deps.maxSpawnDepth) {
    log.warn(`子代理递归深度已达上限 (${deps.maxSpawnDepth})，无法继续 spawn`);
    return;
  }

  const childInstanceId = prefixedId("spawn");
  deps.spawnedChildInstanceIds.add(childInstanceId);

  const childAbortController = new AbortController();
  subAgentTracker.register({
    abortController: childAbortController,
    agentId: params.agentId,
    agentName: params.name,
    instanceId: childInstanceId,
    prompt: params.prompt,
  });

  const childAgentName = params.agentName ?? params.name;
  const storeResult = (success: boolean, result: string, error?: string) => {
    subAgentTracker.storeSpawnedResult(
      buildSpawnedToolResult({
        agentId: params.agentId,
        agentName: childAgentName,
        error,
        instanceId: childInstanceId,
        prompt: params.prompt,
        result,
        success,
      }),
    );
  };

  deps
    .createSpawnExecutor()(childAgentName, params.prompt, childInstanceId, deps.spawnDepth + 1)
    .then((result) => {
      storeResult(result.success, result.result, result.error);
    })
    .catch((error: unknown) => {
      storeResult(false, "", error instanceof Error ? error.message : "Unknown error");
    })
    .finally(() => {
      subAgentTracker.unregister(childInstanceId);
    });
}
