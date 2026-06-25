/**
 * 回滚面板
 *
 * 职责:
 *   - 显示会话 checkpoint 列表
 *   - 支持用户选择回滚点恢复会话状态
 *   - 展示每个 checkpoint 的详细信息
 *
 * 模块功能:
 *   - 渲染 checkpoint 列表(标签、消息数、时间戳、token 数)
 *   - 支持空状态展示
 *   - 提供回滚和取消回调接口
 *
 * 使用场景:
 *   - 用户需要回滚到会话的某个历史状态时
 *   - 需要查看会话历史 checkpoint 列表时
 *
 * 边界:
 *   1. checkpoint 数据通过 props 传入，组件不管理数据
 *   2. 实际的回滚逻辑由父组件通过 onRollback 回调处理
 *   3. 不处理键盘导航，仅做展示
 *
 * 流程:
 *   1. 接收 checkpoint 列表数据
 *   2. 渲染列表展示每个 checkpoint 的信息
 *   3. 用户选择后触发 onRollback 回调
 *   4. 用户取消时触发 onCancel 回调
 */
import { For, Show } from "solid-js";
import type { ThemeColors } from "@/ui/contexts/theme";

export interface CheckpointEntry {
  id: string;
  label: string;
  timestamp: Date;
  messageCount: number;
  tokenCount?: number;
}

export interface RollbackBranchPointEntry {
  id: string;
  sessionId: string;
  timestamp: Date | number;
  compactionIndex: number;
  messageCountBefore?: number;
  messageCountAfter?: number;
  tokensBefore?: number;
  tokensAfter?: number;
  compressionRatio?: number;
}

export interface RollbackPanelViewModel {
  checkpointCount: number;
  branchPointCount: number;
  hasAnyRollbackPoint: boolean;
  checkpoints: {
    id: string;
    title: string;
    meta: string;
    tokenMeta: string;
  }[];
  branchPoints: {
    id: string;
    title: string;
    meta: string;
    tokenMeta: string;
    actions: { strategy: "fork" | "replace"; label: string; hint: string }[];
  }[];
}

interface RollbackPanelProps {
  colors: ThemeColors;
  checkpoints: CheckpointEntry[];
  branchPoints?: RollbackBranchPointEntry[];
  onRollback?: (checkpointId: string) => void;
  onRollbackBranchPoint?: (branchPointId: string, strategy: "fork" | "replace") => void;
  onCancel?: () => void;
}

function normalizeDate(value: Date | number): Date {
  return value instanceof Date ? value : new Date(value);
}

function formatNumber(value: number | undefined): string {
  return value === undefined ? "-" : value.toLocaleString();
}

export function buildRollbackPanelViewModel(input: {
  checkpoints: CheckpointEntry[];
  branchPoints?: RollbackBranchPointEntry[];
}): RollbackPanelViewModel {
  const checkpoints = input.checkpoints.map((cp) => ({
    id: cp.id,
    meta: `${cp.messageCount} 条消息 · ${cp.timestamp.toLocaleString()}`,
    title: cp.label,
    tokenMeta: cp.tokenCount ? `${cp.tokenCount.toLocaleString()} tokens` : "",
  }));
  const branchPoints = (input.branchPoints ?? []).map((bp) => {
    const timestamp = normalizeDate(bp.timestamp);
    const ratio = bp.compressionRatio !== undefined ? ` · 压缩率 ${(bp.compressionRatio * 100).toFixed(1)}%` : "";
    return {
      actions: [
        { hint: `/rollback branch ${bp.id} fork`, label: "分叉恢复", strategy: "fork" as const },
        { hint: `/rollback branch ${bp.id} replace`, label: "原会话替换", strategy: "replace" as const },
      ],
      id: bp.id,
      meta: `会话 ${bp.sessionId} · ${timestamp.toLocaleString()}${ratio}`,
      title: `分支点 #${bp.compactionIndex}`,
      tokenMeta: `tokens ${formatNumber(bp.tokensBefore)} -> ${formatNumber(bp.tokensAfter)} · 消息 ${formatNumber(bp.messageCountBefore)} -> ${formatNumber(bp.messageCountAfter)}`,
    };
  });
  return {
    branchPointCount: branchPoints.length,
    branchPoints,
    checkpointCount: checkpoints.length,
    checkpoints,
    hasAnyRollbackPoint: checkpoints.length + branchPoints.length > 0,
  };
}

export function RollbackPanel(props: RollbackPanelProps) {
  const vm = () =>
    buildRollbackPanelViewModel({
      branchPoints: props.branchPoints,
      checkpoints: props.checkpoints,
    });

  return (
    <box flexDirection="column" padding={1}>
      <text fg={props.colors.accent}>会话回滚</text>

      <box marginTop={1}>
        <text fg={props.colors.muted}>选择要恢复的检查点或压缩分支点:</text>
      </box>

      <Show when={!vm().hasAnyRollbackPoint}>
        <box marginTop={1}>
          <text fg={props.colors.muted}>暂无可用回滚点。</text>
        </box>
      </Show>

      <Show when={vm().checkpointCount > 0}>
        <box marginTop={1}>
          <text fg={props.colors.info}>检查点</text>
        </box>
      </Show>

      <For each={vm().checkpoints}>
        {(cp) => (
          <box marginTop={1} flexDirection="column">
            <box>
              <text fg={props.colors.accent}>{cp.title}</text>
            </box>
            <box paddingLeft={2}>
              <text fg={props.colors.muted}>{cp.meta}</text>
              <Show when={cp.tokenMeta}>
                <text fg={props.colors.muted}>{` · ${cp.tokenMeta}`}</text>
              </Show>
            </box>
          </box>
        )}
      </For>

      <Show when={vm().branchPointCount > 0}>
        <box marginTop={1}>
          <text fg={props.colors.info}>压缩分支点</text>
        </box>
      </Show>

      <For each={vm().branchPoints}>
        {(bp) => (
          <box marginTop={1} flexDirection="column">
            <box>
              <text fg={props.colors.accent}>{bp.title}</text>
              <text fg={props.colors.muted}>{` · ${bp.id}`}</text>
            </box>
            <box paddingLeft={2}>
              <text fg={props.colors.muted}>{bp.meta}</text>
            </box>
            <box paddingLeft={2}>
              <text fg={props.colors.muted}>{bp.tokenMeta}</text>
            </box>
            <box paddingLeft={2} flexDirection="column">
              <For each={bp.actions}>
                {(action) => (
                  <text fg={action.strategy === "replace" ? props.colors.warning : props.colors.success}>
                    {`${action.label}: ${action.hint}`}
                  </text>
                )}
              </For>
            </box>
          </box>
        )}
      </For>
    </box>
  );
}
