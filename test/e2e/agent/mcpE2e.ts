/**
 * 子代理 MCP 端到端测试模块 — 验证子代理工具调用权限审批闭环
 *
 * 职责:
 *   - 提供子代理 MCP 工具调用审批流程的端到端测试能力
 *   - 模拟子代理调用 MCP 工具时的权限申请和审批闭环
 *   - 验证权限事件订阅、处理和响应机制
 *
 * 模块功能:
 *   - runSubagentMcpApprovalE2E: 执行端到端测试
 *   - buildChildAgent: 构建用于 E2E 测试的临时子代理配置
 *   - SubagentMcpApprovalE2EOptions: E2E 测试选项接口
 *   - SubagentMcpApprovalE2EResult: E2E 测试结果接口
 *   - PermissionEventRecord: 权限事件记录结构
 *
 * 使用场景:
 *   - 系统启动时验证 MCP 子代理权限审批流程是否正常
 *   - 集成测试中验证权限事件的订阅和处理机制
 *
 * 边界:
 * 1. 测试过程中会创建临时子代理，测试结束后自动清理
 * 2. 默认使用 "zread_get_trending" 工具进行测试
 * 3. 流超时时间最低限制为 120 秒
 * 4. 需要 MCP 运行时和事件总线已初始化
 *
 * 流程:
 * 1. 配置临时子代理并注册到 AgentManager
 * 2. 订阅 PermissionAsked 事件监听权限申请
 * 3. 启动父 Agent 并生成子代理执行测试任务
 * 4. 验证权限事件触发和自动审批机制
 * 5. 收集测试结果并清理临时资源
 */
import { ensureMcpRuntimeStarted } from "@/mcp/manager/runtime";
import {
  agentEvents,
  AgentSession,
  type AgentInfo,
  initBuiltinAgents,
  registerAgent,
  subscribeAgentEvents,
  unregisterAgent,
} from "@/agent";
import type { AppConfigSchema } from "@/schema/config";

export interface PermissionEventRecord {
  permission: string;
  tool: string;
  patterns?: string[];
}

export interface SubagentMcpApprovalE2EResult {
  ok: boolean;
  text: string;
  error?: string;
  permissionEvents: PermissionEventRecord[];
  effectiveStreamTimeoutMs: number;
}

export interface SubagentMcpApprovalE2EOptions {
  toolName?: string;
  childAgentName?: string;
  autoRespond?: (event: PermissionEventRecord) => boolean | undefined;
  autoApprove?: (event: PermissionEventRecord) => boolean;
}

const E2E_MIN_STREAM_TIMEOUT_MS = 120_000;

function buildChildAgent(name: string, toolName: string): AgentInfo {
  return {
    allowedTools: [toolName],
    description: "用于验证子代理 MCP 审批闭环的临时 Agent",
    hidden: true,
    label: "MCP E2E 子代理",
    mode: "subagent",
    name,
    native: false,
    options: {},
    prompt: `你是一个受控验证子代理，只允许调用 ${toolName}。`,
  };
}

export async function runSubagentMcpApprovalE2E(
  config: AppConfigSchema,
  options: SubagentMcpApprovalE2EOptions = {},
): Promise<SubagentMcpApprovalE2EResult> {
  const toolName = options.toolName ?? "zread_get_trending";
  const childAgentName = options.childAgentName ?? `mcp-e2e-child-${Date.now().toString(36)}`;
  const permissionEvents: PermissionEventRecord[] = [];
  const effectiveConfig = structuredClone(config);
  effectiveConfig.permissions = effectiveConfig.permissions ?? [];
  effectiveConfig.permissions.push(
    {
      action: "ask",
      pattern: "*",
      permission: "mcp.zread.get_trending",
    },
    {
      action: "ask",
      pattern: "*",
      permission: "mcp.zread_get_trending",
    },
  );

  const providerId = effectiveConfig.defaultProvider.provider;
  const providerConfig = effectiveConfig.providerConfig[providerId];
  const effectiveStreamTimeoutMs = Math.max(providerConfig?.streamTimeout ?? 0, E2E_MIN_STREAM_TIMEOUT_MS);

  if (providerConfig) {
    effectiveConfig.providerConfig[providerId] = {
      ...providerConfig,
      streamTimeout: effectiveStreamTimeoutMs,
    };
  }

  const unsub = subscribeAgentEvents({
    onPermissionAsked: (props) => {
      const record: PermissionEventRecord = {
        patterns: props.patterns,
        permission: props.permission,
        tool: props.tool,
      };
      permissionEvents.push(record);

      const decision = options.autoRespond?.(record);
      if (typeof decision === "boolean") {
        agentEvents.permissionResolved({
          allowed: decision,
          id: props.id,
        });
        return;
      }

      if (options.autoApprove?.(record)) {
        agentEvents.permissionResolved({
          allowed: true,
          id: props.id,
        });
      }
    },
  });

  initBuiltinAgents();
  registerAgent(buildChildAgent(childAgentName, toolName));
  await ensureMcpRuntimeStarted();

  const parent = new AgentSession("general", effectiveConfig, {
    instanceId: `subagent-mcp-e2e-${Date.now().toString(36)}`,
  });

  try {
    const basePrompt = `请立即调用 ${toolName} 工具完成验证，并用一句话返回核心结果。不要调用其他工具。`;
    const forceToolPrompt = `必须先调用 ${toolName} 工具，拿到结果后再回复一句话。不要直接基于常识回答，也不要在没有工具结果时结束。`;

    let result = await parent.spawnSubagent(childAgentName, basePrompt);
    if (!permissionEvents.some((evt) => evt.permission === "mcp.zread.get_trending")) {
      const retryAgentName = `${childAgentName}-retry`;
      registerAgent(buildChildAgent(retryAgentName, toolName));
      try {
        result = await parent.spawnSubagent(retryAgentName, forceToolPrompt);
      } finally {
        unregisterAgent(retryAgentName);
      }
    }

    return {
      effectiveStreamTimeoutMs,
      error: result.error,
      ok: result.ok,
      permissionEvents,
      text: result.text,
    };
  } finally {
    unsub();
    parent.destroy();
    unregisterAgent(childAgentName);
  }
}
