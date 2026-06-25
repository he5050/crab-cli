/**
 * 子代理工具 — 在当前会话中启动子代理执行任务。
 *
 * 职责:
 *   - 创建子代理执行独立任务
 *   - 查询子代理状态
 *   - 列出所有子代理
 *   - 停止子代理
 *
 * 模块功能:
 *   - subagentTool: 子代理工具定义
 *   - spawn: 创建子代理
 *   - status: 查询子代理状态
 *   - list: 列出所有子代理
 *   - stop: 停止子代理
 *
 * 使用场景:
 *   - 并行处理多个任务
 *   - 分工协作
 *   - 隔离不同任务的上下文
 *
 * 边界:
 *   1. 权限:subagent
 *   2. 子代理继承父代理的权限上下文
 *   3. 子代理有独立的工具白名单
 *   4. 通过 AgentManager 管理生命周期
 *   5. 支持设置最大执行轮次
 *
 * 流程:
 *   1. 接收操作参数
 *   2. 根据 action 执行对应操作
 *   3. 创建/查询/停止子代理
 *   4. 返回操作结果
 */
import { z } from "zod";
import { type ToolContext, defineTool } from "@/tool/types";
import { createLogger } from "@/core/logging/logger";
import { resolveToolSubAgent } from "@/agent";
import { prefixedId } from "@/core/id";

const log = createLogger("tool:subagent");

/** 已创建的子代理 ID 集合(无 context 时用于存在性校验) */
const spawnedAgentIds = new Set<string>();

/** 子代理工具 — 启动隔离上下文执行独立任务 */
export const subagentTool = defineTool({
  description:
    "启动子代理执行独立任务。子代理在隔离的上下文中运行，" +
    "可以调用指定的工具集。适用于并行处理、分工协作。" +
    "子代理完成后返回执行结果(成功/失败 + 输出)。",
  execute: async (
    { action, name, model, allowedTools, agentName, prompt, agentId, maxTurns },
    context?: ToolContext,
  ) => {
    try {
      switch (action) {
        case "spawn": {
          return handleSpawn(name, model, allowedTools, agentName, prompt, maxTurns, context);
        }
        case "status": {
          return handleStatus(agentId, context);
        }
        case "list": {
          return handleList(context);
        }
        case "stop": {
          return handleStop(agentId, context);
        }
        default: {
          return { error: `未知操作: ${action}`, success: false };
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error(`子代理操作失败: ${action}`, { error: msg });
      return { error: msg, success: false };
    }
  },
  name: "subagent",
  parameters: z.object({
    /** 操作 */
    action: z
      .enum(["spawn", "status", "list", "stop"])
      .describe("操作:spawn(创建子代理)、status(查询状态)、list(列出所有)、stop(停止子代理)"),
    /** 子代理 ID(status 时使用) */
    agentId: z.string().optional().describe("子代理 ID(status 查询时使用)"),
    /** 显式指定注册表中的 Agent 名称 */
    agentName: z.string().optional().describe("显式指定注册表中的 Agent 名称；未提供时才动态路由"),
    /** 允许使用的工具列表 */
    allowedTools: z.array(z.string()).optional().describe("子代理允许使用的工具白名单"),
    /** 最大执行轮次 */
    maxTurns: z.number().optional().describe("子代理最大执行轮次(默认 10)"),
    /** 子代理使用的模型 */
    model: z.string().optional().describe("子代理使用的 AI 模型(默认继承父代理)"),
    /** 子代理名称/任务描述 */
    name: z.string().optional().describe("子代理名称或任务描述(spawn 时必填)"),
    /** 初始提示/任务指令 */
    prompt: z.string().optional().describe("子代理的初始任务指令(spawn 时必填)"),
  }),
  permission: "subagent",
  builtin: true,
});

async function handleSpawn(
  name?: string,
  model?: string,
  allowedTools?: string[],
  requestedAgentName?: string,
  prompt?: string,
  maxTurns?: number,
  context?: ToolContext,
): Promise<Record<string, unknown>> {
  if (!prompt && !name) {
    return { error: "创建子代理需要提供 prompt(任务指令)或 name(任务描述)", success: false };
  }

  const agentId = prefixedId("sub");
  const effectivePrompt = prompt ?? name ?? "";

  // 动态路由:根据任务内容智能选择最合适的子代理类型
  let agentName = requestedAgentName ?? "general";
  if (!requestedAgentName) {
    try {
      const resolution = await resolveToolSubAgent(effectivePrompt);
      if (resolution.resolved && resolution.agentName !== "none") {
        ({ agentName } = resolution);
        log.info(`子代理动态路由: ${agentName}`);
      }
    } catch (error) {
      log.warn("子代理路由失败，回退到 general", { error: String(error) });
    }
  }
  const displayName = name ?? agentName;

  log.info(`子代理已创建: ${agentId} - ${effectivePrompt.slice(0, 50)}`);
  spawnedAgentIds.add(agentId);

  // 通过 context 触发实际的子代理执行
  if (context?.spawnSubagent) {
    context.spawnSubagent({
      agentId,
      agentName,
      allowedTools: allowedTools ?? [],
      maxTurns: maxTurns ?? 10,
      model,
      name: displayName,
      prompt: effectivePrompt,
    });

    return {
      action: "spawn",
      agentId,
      agentName,
      message: `子代理 ${agentId} 已启动，正在执行任务...`,
      name: displayName,
      status: "running",
      success: true,
    };
  }

  // 无 context 时返回模拟结果(用于测试/独立调用)
  return {
    action: "spawn",
    agentId,
    agentName,
    allowedTools: allowedTools ?? [],
    maxTurns: maxTurns ?? 10,
    message: "子代理已创建(等待执行引擎接入)",
    model: model ?? "inherit",
    name: displayName,
    prompt: effectivePrompt,
    status: "pending",
    success: true,
  };
}

function handleStatus(agentId?: string, context?: ToolContext): Record<string, unknown> {
  if (!agentId) {
    return { error: "查询状态需要提供 agentId", success: false };
  }

  if (context?.getSubagentStatus) {
    const status = context.getSubagentStatus(agentId);
    if (!status) {
      return { error: `子代理不存在: ${agentId}`, success: false };
    }
    return { action: "status", success: true, ...status };
  }

  return {
    action: "status",
    agentId,
    error: `子代理不存在: ${agentId}`,
    success: false,
  };
}

function handleStop(agentId?: string, context?: ToolContext): Record<string, unknown> {
  if (!agentId) {
    return { error: "停止子代理需要提供 agentId", success: false };
  }

  if (!spawnedAgentIds.has(agentId)) {
    return { error: `子代理不存在: ${agentId}`, success: false };
  }

  // 通过 context 触发实际的停止操作
  if (context?.stopSubagent) {
    context.stopSubagent(agentId);
  }

  spawnedAgentIds.delete(agentId);
  log.info(`子代理已停止: ${agentId}`);

  return {
    action: "stop",
    agentId,
    message: `子代理 ${agentId} 已停止`,
    success: true,
  };
}

function handleList(context?: ToolContext): Record<string, unknown> {
  if (context?.listSubagents) {
    const agents = context.listSubagents();
    return { action: "list", agents, success: true, total: agents.length };
  }

  return { action: "list", agents: [], message: "暂无活跃子代理", success: true, total: 0 };
}
