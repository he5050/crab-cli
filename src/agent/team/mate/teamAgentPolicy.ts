/**
 * Team Agent 策略模块 — 解析队友的 Agent 配置、模型与权限。
 *
 * 职责:
 *   - 根据 agentName 查找 Agent 元数据
 *   - 合并允许工具/模型/权限策略
 *   - 在配置错误时返回 error 字符串
 *
 * 模块功能:
 *   - resolveTeammateAgentPolicy: 解析队友 Agent 策略
 *   - TeammateAgentPolicyOptions: 入参
 *   - ResolvedTeammateAgentPolicy: 解析结果
 */
import { type AgentInfo, getAgent } from "@/agent";
import type { AppConfigSchema } from "@/schema/config";

export interface TeammateAgentPolicyOptions {
  allowedTools?: string[];
  model?: string;
  agentName?: string;
}

export interface ResolvedTeammateAgentPolicy {
  agent?: AgentInfo;
  allowedTools?: string[];
  model?: string;
  permissions?: AppConfigSchema["permissions"];
}

export function resolveTeammateAgentPolicy(
  options?: TeammateAgentPolicyOptions,
): ResolvedTeammateAgentPolicy | { error: string } {
  if (!options?.agentName) {
    return {
      allowedTools: options?.allowedTools,
      model: options?.model,
    };
  }

  const agent = getAgent(options.agentName);
  if (!agent) {
    return { error: `关联的 Agent 不存在: ${options.agentName}` };
  }
  if (agent.mode === "primary") {
    return { error: `Agent 不允许作为 Team 队友使用: ${options.agentName}` };
  }

  return {
    agent,
    allowedTools: options.allowedTools ?? agent.allowedTools,
    model: options.model ?? agent.model?.modelID,
    permissions: agent.permissions?.map((rule) => ({
      action: rule.action,
      description: typeof rule.metadata?.description === "string" ? rule.metadata.description : undefined,
      pattern: rule.pattern,
      permission: rule.permission,
    })),
  };
}
