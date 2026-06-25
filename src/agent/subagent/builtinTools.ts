/**
 * 子代理内置协作工具 — 注入到子代理的工具集中，支持子代理间通信和协作。
 *
 * 职责:
 *   - 定义子代理间通信的工具 schema
 *   - 将内置工具注入到子代理的白名单
 *   - 构建 Peer Agent 上下文
 *   - 支持子代理 spawn 深度控制
 *
 * 模块功能:
 *   - BUILTIN_AGENT_TOOL_NAMES: 内置工具名称数组
 *   - BUILTIN_TOOL_PREFIXES: 内置工具前缀集合
 *   - SEND_MESSAGE_TOOL_SCHEMA: 发送消息工具 schema
 *   - QUERY_STATUS_TOOL_SCHEMA: 查询状态工具 schema
 *   - SPAWN_SUB_AGENT_TOOL_SCHEMA: spawn 子代理工具 schema
 *   - getBuiltinAgentToolSchemas: 获取内置工具 schema
 *   - injectBuiltinToolNames: 将内置工具名称注入白名单
 *   - buildPeerAgentsContext: 构建 Peer Agent 上下文
 *   - buildSubAgentInitialMessages: 构建子代理初始消息
 *
 * 使用场景:
 *   - 子代理需要与其他子代理通信
 *   - 查询运行中的子代理状态
 *   - 子代理需要 spawn 更深层的子代理
 *   - 构建子代理的协作上下文
 *
 * 边界:
 *   1. 这些工具不注册到工具注册表，通过拦截器在执行循环中直接处理
 *   2. 仅添加到子代理的 allowedTools 白名单，让 LLM 知道可以调用
 *   3. spawn_sub_agent 工具仅在未达到最大深度时可用
 *   4. 最大 spawn 深度为 3 层
 *
 * 流程:
 *   1. 子代理创建时调用 injectBuiltinToolNames() 注入工具名称
 *   2. 调用 getBuiltinAgentToolSchemas() 获取工具 schema
 *   3. 调用 buildSubAgentInitialMessages() 构建包含 peer context 的初始消息
 *   4. 子代理执行时通过拦截器处理内置工具调用
 *   5. send_message_to_agent 通过 subAgentTracker 传递消息
 *   6. query_agents_status 查询 subAgentTracker 获取运行状态
 *   7. spawn_sub_agent 创建新的子代理实例
 */
import { subAgentTracker } from "./tracker";
import { createLogger } from "@/core/logging/logger";
import { BUILTIN_TOOL_PREFIXES } from "@/tool/registry/builtinToolPrefixes";
import { MAX_SPAWN_DEPTH } from "@/config";
import { jsonSchema } from "ai";

const log = createLogger("agent:builtin-tools");

// ─── 内置工具名称 ────────────────────────────────────────────

export const BUILTIN_AGENT_TOOL_NAMES = ["send_message_to_agent", "query_agents_status", "spawn_sub_agent"] as const;

/** 所有内置 agent 始终可用的全局工具（goal 管理目标，todo-ultra 管理任务清单） */
const GLOBAL_BUILTIN_TOOL_NAMES = ["goal", "todo-ultra"] as const;

export type BuiltinAgentToolName = (typeof BUILTIN_AGENT_TOOL_NAMES)[number];

export { BUILTIN_TOOL_PREFIXES };

// ─── 工具定义(用于 LLM function calling schema) ──────────

/** Send_message_to_agent 工具的 JSON Schema */
export const SEND_MESSAGE_TOOL_SCHEMA = {
  description:
    "向另一个正在运行的子代理发送消息。用于共享信息、发现或协调并行任务。消息会注入目标代理上下文。重要:发送前先使用 query_agents_status 确认目标代理仍在运行。",
  name: "send_message_to_agent",
  parameters: {
    properties: {
      message: {
        description: "发送给目标代理的消息内容。请清楚说明共享的信息或请求的动作。",
        type: "string",
      },
      target_agent_id: {
        description: '目标子代理的类型 ID，例如 "explore" 或 "review"。如果同类型有多个实例，会发送给第一个匹配实例。',
        type: "string",
      },
      target_instance_id: {
        description: "可选。目标子代理的具体实例 ID。同类型有多个实例时用于精确发送。",
        type: "string",
      },
    },
    required: ["message"],
    type: "object",
  },
};

/** Query_agents_status 工具的 JSON Schema */
export const QUERY_STATUS_TOOL_SCHEMA = {
  description:
    "查询所有运行中子代理的当前状态。返回活跃代理的 ID、名称、提示词和运行时长。用于发送消息前确认目标代理状态，或发现新启动的代理。",
  name: "query_agents_status",
  parameters: {
    properties: {},
    required: [] as string[],
    type: "object",
  },
};

/** Spawn_sub_agent 工具的 JSON Schema */
export const SPAWN_SUB_AGENT_TOOL_SCHEMA = {
  description: `启动一个不同类型的新子代理以获得专项协助。新代理会并行运行，结果会自动回传。

**何时使用**:只有确实需要其他代理的专项能力时才启动:
- 当前是 explore，且需要代码修改:启动 general
- 当前是 general，且需要深入代码分析:启动 explore
- 需要详细实施计划:启动 plan
- 需要代码审查:启动 review
- 需要测试设计或验证分析:启动 qa
- 需要复现和定位问题:启动 debug

**何时不要使用**:不要为了转嫁自己的工作而启动子代理:
- 不要启动同类型代理来委派自己的任务
- 如果自己可以处理，不要只为了"拆任务"而启动代理
- 只是卡住时不要直接启动代理，应先继续排查或询问用户
- 如果当前工具足够完成任务，就自己完成

可用代理类型:general(通用执行)、explore(只读代码探索)、plan(实施规划)、review(代码审查)、qa(测试与验证)、debug(问题调试)、security(安全审计)、docs(文档维护)。`,
  name: "spawn_sub_agent",
  parameters: {
    properties: {
      agent_id: {
        description:
          '要启动的代理类型，必须不同于当前代理。例如 "general"、"explore"、"plan"、"review"、"qa"、"debug"、"security"、"docs"。',
        type: "string",
      },
      prompt: {
        description:
          "重要:给新代理的任务提示。新代理无法访问你的完整对话历史，因此必须包含完整上下文，包括相关文件路径、已知发现、约束和要求。",
        type: "string",
      },
    },
    required: ["agent_id", "prompt"],
    type: "object",
  },
};

export function getBuiltinAgentToolSchemas(
  spawnDepth: number,
): Record<string, { description: string; inputSchema: unknown }> {
  const tools: Record<string, { description: string; inputSchema: unknown }> = {
    [BUILTIN_AGENT_TOOL_NAMES[0]]: {
      description: SEND_MESSAGE_TOOL_SCHEMA.description,
      inputSchema: jsonSchema(SEND_MESSAGE_TOOL_SCHEMA.parameters as Parameters<typeof jsonSchema>[0]),
    },
    [BUILTIN_AGENT_TOOL_NAMES[1]]: {
      description: QUERY_STATUS_TOOL_SCHEMA.description,
      inputSchema: jsonSchema(QUERY_STATUS_TOOL_SCHEMA.parameters as Parameters<typeof jsonSchema>[0]),
    },
  };

  if (spawnDepth < MAX_SPAWN_DEPTH) {
    tools[BUILTIN_AGENT_TOOL_NAMES[2]] = {
      description: SPAWN_SUB_AGENT_TOOL_SCHEMA.description,
      inputSchema: jsonSchema(SPAWN_SUB_AGENT_TOOL_SCHEMA.parameters as Parameters<typeof jsonSchema>[0]),
    };
  }

  return tools;
}

// ─── 注入工具 ────────────────────────────────────────────────

/**
 * 构建子代理内置工具名称列表。
 *
 * 这是用于验证和调用方复用的轻量 helper，语义保持和运行时 schema/白名单注入一致:
 * 当前深度小于最大深度时允许继续 spawn。
 */
export function buildSubAgentTools(spawnDepth: number, maxSpawnDepth = MAX_SPAWN_DEPTH): BuiltinAgentToolName[] {
  const tools: BuiltinAgentToolName[] = ["send_message_to_agent", "query_agents_status"];

  if (spawnDepth < maxSpawnDepth) {
    tools.push("spawn_sub_agent");
  }

  return tools;
}

/**
 * 将内置协作工具名称添加到子代理的 allowedTools 白名单。
 *
 * @param allowedTools - 当前允许的工具列表
 * @param spawnDepth - 当前 spawn 深度
 * @returns 添加了内置工具的新列表
 */
export function injectBuiltinToolNames(allowedTools: string[] | undefined, spawnDepth: number): string[] {
  const tools = allowedTools ? [...allowedTools] : [];

  // 始终注入消息和状态查询工具
  tools.push("send_message_to_agent", "query_agents_status");

  // 只在未达到最大深度时注入 spawn 工具
  if (spawnDepth < MAX_SPAWN_DEPTH) {
    tools.push("spawn_sub_agent");
  }

  // 始终注入全局内置工具（目标管理 + 任务清单）
  tools.push(...GLOBAL_BUILTIN_TOOL_NAMES);

  return tools;
}

// ─── Peer Agent 上下文构建 ───────────────────────────────────

/**
 * 构建 Peer Agent 上下文字符串，注入到子代理的初始消息中。
 *
 * 让子代理知道当前有哪些其他子代理在并行运行，
 * 以及它有哪些协作工具可用。
 *
 * @param instanceId - 当前子代理实例 ID
 * @param canSpawn - 是否可以 spawn 更深层的子代理
 * @returns 上下文字符串
 */
export function buildPeerAgentsContext(instanceId: string | undefined, canSpawn: boolean): string {
  const otherAgents = subAgentTracker.listRunning().filter((a) => a.instanceId !== instanceId);

  if (otherAgents.length > 0) {
    const agentList = otherAgents
      .map((a) => `- ${a.agentName} (id: ${a.agentId}, instance: ${a.instanceId})`)
      .join("\n");

    const spawnHint = canSpawn ? "，或使用 `spawn_sub_agent` 请求不同类型代理提供专项协助" : "";

    const spawnAdvice = canSpawn
      ? "\n\n**启动规则**:只有当前工具无法完成、且确实需要其他专项能力时，才启动不同类型代理。先完成自己能做的任务，不要把自己的任务转交出去。"
      : "";

    return `\n\n## 当前运行中的协作代理\n以下子代理正在与你并行运行。你可以使用 \`query_agents_status\` 获取实时状态，使用 \`send_message_to_agent\` 沟通${spawnHint}。\n\n${agentList}\n\n如果发现对其他代理有用的信息，请主动共享。${spawnAdvice}`;
  }

  // 没有其他子代理在运行
  const spawnToolLine = canSpawn
    ? "\n- `spawn_sub_agent`:启动不同类型代理提供专项协助(不要启动同类型代理来转交自己的工作)"
    : "";

  const spawnUsage = canSpawn
    ? "\n\n**启动规则**:只有确实需要其他代理的专项能力时才使用 `spawn_sub_agent`，例如当前代理只读但任务需要代码修改。不要为了转交自己的任务或把自己应完成的工作并行化而启动代理。"
    : "";

  return `\n\n## 代理协作工具\n你可以使用以下协作工具:\n- \`query_agents_status\`:查看当前运行中的子代理\n- \`send_message_to_agent\`:向运行中的协作代理发送消息(先检查状态)${spawnToolLine}${spawnUsage}`;
}

/**
 * 构建子代理的初始消息，包含 prompt + peer context。
 */
export function buildSubAgentInitialMessages(
  agentName: string,
  prompt: string,
  instanceId: string | undefined,
  spawnDepth: number,
): string {
  const canSpawn = spawnDepth < MAX_SPAWN_DEPTH;
  const peerContext = buildPeerAgentsContext(instanceId, canSpawn);
  return `${prompt}${peerContext}`;
}
