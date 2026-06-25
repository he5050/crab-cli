/**
 * AgentPicker — Agent 选择器
 *
 * 职责:
 *   - 提供 Agent 选择功能
 *   - 统一使用 DialogSelect 组件
 *   - 避免 Agent 弹窗拥有独立键盘/布局模型
 *
 * 模块功能:
 *   - AgentPicker: Agent 选择器组件
 *   - AgentPickerProps: 组件属性接口
 *
 * 使用场景:
 *   - 切换当前使用的 Agent
 *   - Agent 配置选择
 *
 * 边界:
 * 1. 统一走 DialogSelect 组件
 * 2. 不维护独立的键盘/布局模型
 * 3. 依赖 agent 模块获取 Agent 列表
 *
 * 流程:
 * 1. 获取 Agent 列表
 * 2. 构建选择选项
 * 3. 显示 DialogSelect
 * 4. 用户选择后触发 onSelect 回调
 */
import { createMemo } from "solid-js";
import { type AgentInfo, getActiveAgentName, getAgentModel, listPrimaryAgents, setActiveAgent } from "@agent";
import type { AppConfigSchema } from "@/schema/config";
import { createLogger } from "@/core/logging/logger";
import { symDot } from "@/core/icons/icon";
import { DialogSelect, type SelectOption } from "@/ui/components/dialogSelect";

const log = createLogger("ui:agent-picker");

interface AgentPickerProps {
  config: AppConfigSchema;
  onClose: () => void;
  onSelect?: (agentName: string) => void;
}

export function AgentPicker(props: AgentPickerProps) {
  const agents = listPrimaryAgents();
  const options = createMemo<SelectOption<AgentInfo>[]>(() =>
    agents.map((agent) => {
      const modelInfo = getAgentModel(agent, props.config);
      const active = agent.name === getActiveAgentName();
      return {
        category: agent.mode,
        current: active,
        description: agent.description,
        keywords: [agent.name, agent.label, agent.description, agent.mode, modelInfo.providerID, modelInfo.modelID],
        marker: active ? symDot : undefined,
        meta: `${agent.name} · ${modelInfo.providerID}/${modelInfo.modelID}`,
        title: agent.label,
        value: agent,
      };
    }),
  );

  const handleSelect = (agent: AgentInfo) => {
    const success = setActiveAgent(agent.name);
    if (success) {
      log.info(`已选择 Agent: ${agent.name}`);
      props.onSelect?.(agent.name);
    }
    props.onClose();
  };

  return (
    <DialogSelect
      title="选择 Agent"
      options={options()}
      placeholder="搜索 agent / mode / model..."
      emptyText="没有可用 Agent"
      footer="↑↓/Ctrl+P/Ctrl+N 选择 · 输入搜索 · Enter 切换 Agent · Esc 取消"
      size="large"
      onClose={props.onClose}
      onSelect={(option) => handleSelect(option.value)}
    />
  );
}
