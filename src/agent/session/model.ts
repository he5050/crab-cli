/**
 * Agent 会话模型解析 — 选择 Agent 实际使用的 Provider/Model 与可用工具。
 *
 * 设计动机:
 *   - 将 Agent 配置映射（provider/model 选择、工具过滤）与 AgentSession 构造解耦。
 *   - AgentSession 构造时调用 getAgentModel 确定 LLM 后端，
 *     调用 getToolsForAgent 确定工具白名单。
 *   - 独立文件便于单元测试 mock 和替换。
 */
import type { AgentInfo } from "@/agent/core/manager";
import { filterToolsForAgent } from "@/agent/subagent/permissions";
import type { AppConfigSchema } from "@/schema/config";
import { getRegisteredTools } from "@/tool/registry/toolRegistry";

/** 获取 Agent 允许使用的工具列表（经过 permissions 过滤） */
export function getToolsForAgent(agent: AgentInfo): string[] {
  const allTools = Object.keys(getRegisteredTools());
  return filterToolsForAgent(allTools, agent);
}

/**
 * 解析 Agent 实际使用的 Provider/Model。
 * 优先使用 Agent 自定义配置，否则回退到全局默认配置。
 */
export function getAgentModel(
  agent: AgentInfo,
  config: AppConfigSchema,
): {
  providerID: string;
  modelID: string;
} {
  if (agent.model) {
    return agent.model;
  }
  const providerID = config.defaultProvider.provider;
  const modelID = config.defaultProvider.model;
  return { modelID, providerID };
}
