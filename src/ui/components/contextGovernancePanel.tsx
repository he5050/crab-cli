/**
 * 上下文治理面板 — 展示当前会话上下文的 token 用量与治理策略状态。
 *
 * 职责:
 *   - 渲染 ContextGovernancePanelModel 中的统计数据
 *   - 提供上下文压缩/丢弃的可视化提示
 */
import { For, Show } from "solid-js";
import type { ThemeColors } from "@/ui/contexts/theme";
import type { ContextGovernancePanelModel } from "@session";

export interface ContextGovernancePanelProps {
  colors: ThemeColors;
  model: ContextGovernancePanelModel;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function statusLabel(status: ContextGovernancePanelModel["budget"]["status"]): string {
  if (status === "overflow") {
    return "超限";
  }
  if (status === "critical") {
    return "紧急";
  }
  if (status === "watch") {
    return "观察";
  }
  return "健康";
}

export function ContextGovernancePanel(props: ContextGovernancePanelProps) {
  const c = props.colors;
  const model = () => props.model;

  return (
    <box flexDirection="column" padding={1}>
      <text fg={c.accent}>上下文治理</text>
      <box marginTop={1} flexDirection="column">
        <text fg={c.text}>
          {`预算 ${model().budget.usedTokens.toLocaleString()} / ${model().budget.maxTokens.toLocaleString()} tokens`}
        </text>
        <text fg={model().budget.status === "healthy" ? c.success : c.warning}>
          {`${statusLabel(model().budget.status)} · ${pct(model().budget.usageRatio)}`}
        </text>
      </box>

      <Show when={model().warnings.length > 0}>
        <box marginTop={1} flexDirection="column">
          <text fg={c.warning}>风险</text>
          <For each={model().warnings}>{(warning) => <text fg={c.muted}>{`- ${warning}`}</text>}</For>
        </box>
      </Show>

      <box marginTop={1} flexDirection="column">
        <text fg={c.info}>恢复点</text>
        <text fg={c.muted}>
          {`checkpoint ${model().checkpoints.length} · branch point ${model().branchPoints.length} · file rollback ${
            model().fileRollbacks.length
          }`}
        </text>
      </box>

      <box marginTop={1} flexDirection="column">
        <text fg={c.info}>动作</text>
        <For each={model().actions}>
          {(action) => (
            <text fg={action.severity === "danger" ? c.error : action.severity === "warning" ? c.warning : c.text}>
              {`${action.label}: ${action.hint}`}
            </text>
          )}
        </For>
      </box>
    </box>
  );
}
