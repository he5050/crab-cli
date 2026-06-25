/**
 * GitEnhancedPanels
 *
 * 职责:
 *   - 提供 Git 相关的增强功能面板
 *   - 支持提交审查、运行中代理展示、文件回滚确认
 *   - 提供统一的键盘交互和视觉风格
 *
 * 模块功能:
 *   - ReviewCommitPanel: 审查提交面板，支持批准/拒绝/返回操作
 *   - RunningAgentsPanel: 展示运行中的代理列表和状态
 *   - FileRollbackConfirmation: 文件回滚确认对话框
 *   - 统一的键盘导航(上下箭头、回车确认、Esc 返回)
 *
 * 使用场景:
 *   - 需要审查 AI 生成的 Git 提交时
 *   - 查看当前运行的代理任务状态时
 *   - 确认文件回滚操作前需要用户确认时
 *
 * 边界:
 *   1. 数据通过 props 传入，组件不管理业务状态
 *   2. 所有操作通过回调函数通知父组件处理
 *   3. 不处理实际的 Git 操作，仅提供交互界面
 *   4. 使用 useKeyboard 处理键盘事件
 *
 * 流程:
 *   1. 根据场景渲染对应的面板组件
 *   2. 监听键盘事件处理导航和选择
 *   3. 用户确认后触发相应的回调函数
 *   4. 父组件处理实际的业务逻辑
 */

import { For, Show, createSignal } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useTheme } from "@/ui/contexts/theme";
import { actionSelect, iconError, iconRunning, iconSuccess, iconWarning } from "@/ui/utils/icon";

// ─── ReviewCommitPanel ─────────────────────────────────────

export interface ReviewCommitPanelProps {
  onClose: () => void;
  commitMessage?: string;
  files?: string[];
  onApprove?: () => void;
  onReject?: () => void;
}

export function ReviewCommitPanel(props: ReviewCommitPanelProps) {
  const theme = useTheme();
  const [focusIndex, setFocusIndex] = createSignal(0);

  const options = () => [
    { label: `${iconSuccess} 批准提交`, value: "approve" },
    { label: `${iconError} 拒绝提交`, value: "reject" },
    { label: "← 返回", value: "back" },
  ];

  useKeyboard((event) => {
    if (event.name === "escape") {
      props.onClose();
      return;
    }
    if (event.name === "up") {
      setFocusIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (event.name === "down") {
      setFocusIndex((i) => Math.min(options().length - 1, i + 1));
      return;
    }
    if (event.name === "return" || event.name === "enter") {
      const opt = options()[focusIndex()];
      if (!opt) {
        return;
      }
      if (opt.value === "approve") {
        props.onApprove?.();
      } else if (opt.value === "reject") {
        props.onReject?.();
      } else {
        props.onClose();
      }
    }
  });

  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.colors.warning}>
          <b>{"审查提交"}</b>
        </text>
        <text fg={theme.colors.muted}>{"esc 返回"}</text>
      </box>

      <Show when={props.commitMessage}>
        <text fg={theme.colors.text}>{`提交信息: ${props.commitMessage}`}</text>
      </Show>

      <Show when={(props.files?.length ?? 0) > 0}>
        <box flexDirection="column">
          <text fg={theme.colors.muted}>{"变更文件:"}</text>
          <For each={props.files}>{(file) => <text fg={theme.colors.text}>{`  • ${file}`}</text>}</For>
        </box>
      </Show>

      <For each={options()}>
        {(option, index) => {
          const isSelected = () => index() === focusIndex();
          return (
            <text
              fg={isSelected() ? theme.colors.text : theme.colors.muted}
              backgroundColor={isSelected() ? theme.colors.primary : undefined}
              {...({} as any)}
            >
              {isSelected() ? `${actionSelect} ` : "  "}
              {option.label}
            </text>
          );
        }}
      </For>
    </box>
  );
}

// ─── RunningAgentsPanel ────────────────────────────────────

export interface AgentInfo {
  id: string;
  name: string;
  status: "running" | "completed" | "failed";
  progress?: string;
}

export interface RunningAgentsPanelProps {
  onClose: () => void;
  agents?: AgentInfo[];
}

export function RunningAgentsPanel(props: RunningAgentsPanelProps) {
  const theme = useTheme();

  useKeyboard((event) => {
    if (event.name === "escape") {
      props.onClose();
    }
  });

  const statusFg = (status: string) =>
    status === "running" ? theme.colors.info : status === "completed" ? theme.colors.success : theme.colors.error;

  const statusIcon = (status: string) =>
    status === "running" ? iconRunning : status === "completed" ? iconSuccess : iconError;

  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.colors.warning}>
          <b>{"运行中的代理"}</b>
        </text>
        <text fg={theme.colors.muted}>{"esc 返回"}</text>
      </box>

      <Show when={(props.agents?.length ?? 0) === 0}>
        <text fg={theme.colors.muted}>{"暂无运行中的代理"}</text>
      </Show>

      <For each={props.agents}>
        {(agent) => (
          <box flexDirection="column">
            <text fg={statusFg(agent.status)}>{`${statusIcon(agent.status)} ${agent.name} (${agent.status})`}</text>
            <Show when={agent.progress}>
              <text fg={theme.colors.muted}>{`  ${agent.progress}`}</text>
            </Show>
          </box>
        )}
      </For>
    </box>
  );
}

// ─── FileRollbackConfirmation ──────────────────────────────

export interface FileRollbackConfirmationProps {
  onClose: () => void;
  filePath?: string;
  onConfirm?: () => void;
}

export function FileRollbackConfirmation(props: FileRollbackConfirmationProps) {
  const theme = useTheme();
  const [focusIndex, setFocusIndex] = createSignal(0);

  useKeyboard((event) => {
    if (event.name === "escape") {
      props.onClose();
      return;
    }
    if (event.name === "up" || event.name === "down") {
      setFocusIndex((i) => (i === 0 ? 1 : 0));
      return;
    }
    if (event.name === "return" || event.name === "enter") {
      if (focusIndex() === 0) {
        props.onConfirm?.();
      } else {
        props.onClose();
      }
    }
  });

  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} gap={1}>
      <text fg={theme.colors.error}>
        <b>{"确认文件回滚"}</b>
      </text>
      <Show when={props.filePath}>
        <text fg={theme.colors.warning}>{`${iconWarning} 此操作将撤销对 ${props.filePath} 的更改`}</text>
      </Show>
      <text
        fg={focusIndex() === 0 ? theme.colors.text : theme.colors.muted}
        backgroundColor={focusIndex() === 0 ? theme.colors.primary : undefined}
        {...({} as any)}
      >
        {focusIndex() === 0 ? `${actionSelect} ` : "  "}
        {`${iconSuccess} 确认回滚`}
      </text>
      <text
        fg={focusIndex() === 1 ? theme.colors.text : theme.colors.muted}
        backgroundColor={focusIndex() === 1 ? theme.colors.primary : undefined}
        {...({} as any)}
      >
        {focusIndex() === 1 ? `${actionSelect} ` : "  "}
        {`${iconError} 取消`}
      </text>
    </box>
  );
}
