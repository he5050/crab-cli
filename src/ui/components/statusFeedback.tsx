/**
 * StatusFeedback 组件集合
 *
 * 职责:
 *   - 提供多种状态反馈组件，用于显示系统运行状态
 *   - 包括压缩状态、后台进程、Hook 错误、代码搜索状态等
 *
 * 模块功能:
 *   - CompressionStatus: 显示上下文压缩进度和消息数量变化
 *   - BackgroundProcessPanel: 显示后台进程列表及其状态
 *   - HookErrorDisplay: 显示 Hook 执行错误信息
 *   - CodebaseSearchStatus: 显示代码库搜索索引状态
 *
 * 使用场景:
 *   - 上下文压缩时显示进度
 *   - 后台任务执行时显示状态
 *   - Hook 执行出错时显示错误信息
 *   - 代码库索引状态显示
 *
 * 边界:
 *   1. 各组件均为纯展示组件，不处理业务逻辑
 *   2. 状态图标:● 运行中 / ✓ 完成 / ✗ 失败
 *   3. 搜索状态:idle / indexing / ready / error
 *
 * 流程:
 *   1. 接收 props 中的状态数据
 *   2. 根据状态计算显示文本和颜色
 *   3. 条件渲染(Show)控制显示/隐藏
 */

import { For, type JSX, Show, createMemo } from "solid-js";
import { useTheme } from "@/ui/contexts/theme";
import { Spinner } from "@/ui/components/spinner";
import {
  actionBullet,
  iconError,
  iconRunning,
  iconSuccess,
  iconWarning,
  spinnerFrames,
  symDot,
  symInfo,
} from "@/ui/utils/icon";
import { genericTaskIcon } from "@/core/icons/iconDerived";

export type FeedbackTone = "info" | "success" | "warning" | "error" | "loading" | "busy" | "empty" | "muted";

export interface FeedbackMeta {
  tone: FeedbackTone;
  icon: string;
  label: string;
  colorKey: "info" | "success" | "warning" | "error" | "muted" | "text";
  busy: boolean;
}

export type FeedbackColors = Partial<Record<FeedbackMeta["colorKey"], string>>;

export const FEEDBACK_META: Record<FeedbackTone, FeedbackMeta> = {
  busy: { busy: true, colorKey: "info", icon: iconRunning, label: "忙碌", tone: "busy" },
  empty: { busy: false, colorKey: "text", icon: symDot, label: "空", tone: "empty" },
  error: { busy: false, colorKey: "error", icon: iconError, label: "错误", tone: "error" },
  info: { busy: false, colorKey: "info", icon: symInfo, label: "信息", tone: "info" },
  loading: { busy: true, colorKey: "muted", icon: spinnerFrames[0] ?? "⠋", label: "加载中", tone: "loading" },
  muted: { busy: false, colorKey: "muted", icon: actionBullet, label: "状态", tone: "muted" },
  success: { busy: false, colorKey: "success", icon: iconSuccess, label: "成功", tone: "success" },
  warning: { busy: false, colorKey: "warning", icon: iconWarning, label: "警告", tone: "warning" },
};

export function normalizeFeedbackTone(value: unknown): FeedbackTone {
  if (
    value === "success" ||
    value === "warning" ||
    value === "error" ||
    value === "loading" ||
    value === "busy" ||
    value === "empty" ||
    value === "muted"
  ) {
    return value;
  }
  return "info";
}

export function getFeedbackMeta(value: unknown): FeedbackMeta {
  return FEEDBACK_META[normalizeFeedbackTone(value)];
}

export function feedbackColor(meta: FeedbackMeta, colors: FeedbackColors): string {
  return colors[meta.colorKey] ?? colors.text ?? "";
}

export function feedbackStatusText(tone: FeedbackTone, message?: string): string {
  if (message?.trim()) {
    return message.trim();
  }
  switch (tone) {
    case "loading": {
      return "加载中...";
    }
    case "busy": {
      return "处理中...";
    }
    case "empty": {
      return "暂无数据";
    }
    case "error": {
      return "出现错误";
    }
    case "success": {
      return "已完成";
    }
    case "warning": {
      return "需要注意";
    }
    case "muted": {
      return "空闲";
    }
    case "info":
    default: {
      return "就绪";
    }
  }
}

export function FeedbackLine(props: { tone: FeedbackTone; message?: string; title?: string; right?: JSX.Element }) {
  const theme = useTheme();
  const meta = createMemo(() => getFeedbackMeta(props.tone));
  const color = createMemo(() => feedbackColor(meta(), theme.colors));

  return (
    <box flexDirection="row" gap={1} alignItems="center">
      <Show when={meta().busy} fallback={<text fg={color()}>{meta().icon}</text>}>
        <Spinner color={color()} />
      </Show>
      <text fg={color()} wrapMode="word">
        <Show when={props.title}>
          <b>{props.title}</b>
          {" · "}
        </Show>
        {feedbackStatusText(props.tone, props.message)}
      </text>
      <Show when={props.right}>{props.right}</Show>
    </box>
  );
}

export function FeedbackPanel(props: {
  tone: FeedbackTone;
  title?: string;
  message?: string;
  hint?: string;
  width?: number;
}) {
  const theme = useTheme();
  const meta = createMemo(() => getFeedbackMeta(props.tone));
  const color = createMemo(() => feedbackColor(meta(), theme.colors));
  const hintColor = createMemo(() => (props.tone === "empty" ? color() : theme.colors.muted));

  return (
    <box
      flexDirection="column"
      width={props.width}
      padding={1}
      border={true}
      borderColor={color()}
      backgroundColor={theme.extended.bg.panel}
      gap={1}
    >
      <FeedbackLine tone={props.tone} title={props.title} message={props.message} />
      <Show when={props.hint}>
        <text fg={hintColor()} wrapMode="word">
          {props.hint}
        </text>
      </Show>
    </box>
  );
}

export function StatusLabel(props: { tone: FeedbackTone; label: string; value?: string | number }) {
  const theme = useTheme();
  const meta = createMemo(() => getFeedbackMeta(props.tone));
  const color = createMemo(() => feedbackColor(meta(), theme.colors));
  return (
    <box flexDirection="row" gap={1} flexShrink={0}>
      <text fg={color()}>{meta().icon}</text>
      <text fg={theme.colors.muted}>{props.value === undefined ? props.label : `${props.value} ${props.label}`}</text>
    </box>
  );
}

// ─── CompressionStatus ─────────────────────────────────────

export interface CompressionStatusProps {
  isCompressing: boolean;
  originalCount?: number;
  compressedCount?: number;
}

export function CompressionStatus(props: CompressionStatusProps) {
  const theme = useTheme();

  return (
    <Show when={props.isCompressing}>
      <text fg={theme.colors.info}>
        {props.originalCount
          ? `压缩上下文中... (${props.originalCount} → ${props.compressedCount ?? "..."} 消息)`
          : "压缩上下文中..."}
      </text>
    </Show>
  );
}

// ─── BackgroundProcessPanel ────────────────────────────────

export interface BackgroundProcess {
  id: string;
  name: string;
  status: "running" | "completed" | "failed";
  startedAt?: string;
  output?: string;
}

export interface BackgroundProcessPanelProps {
  processes?: BackgroundProcess[];
}

export function BackgroundProcessPanel(props: BackgroundProcessPanelProps) {
  const theme = useTheme();

  const statusIcon = (status: string) =>
    status === "running" ? iconRunning : status === "completed" ? iconSuccess : iconError;

  const statusFg = (status: string) =>
    status === "running" ? theme.colors.info : status === "completed" ? theme.colors.success : theme.colors.error;

  return (
    <Show when={(props.processes?.length ?? 0) > 0}>
      <box flexDirection="column" gap={1}>
        <text fg={theme.colors.text}>
          <b>{"后台进程"}</b>
        </text>
        <For each={props.processes}>
          {(proc) => (
            <box flexDirection="row" gap={1}>
              <text fg={statusFg(proc.status)} flexShrink={0}>
                {statusIcon(proc.status)}
              </text>
              <text fg={theme.colors.text}>{`${proc.name} (${proc.status})`}</text>
            </box>
          )}
        </For>
      </box>
    </Show>
  );
}

// ─── HookErrorDisplay ──────────────────────────────────────

export interface HookErrorDisplayProps {
  error?: string;
  hookName?: string;
}

export function HookErrorDisplay(props: HookErrorDisplayProps) {
  const theme = useTheme();

  return (
    <Show when={props.error}>
      <text fg={theme.colors.error}>
        {`${iconWarning} Hook 错误${props.hookName ? ` (${props.hookName})` : ""}: ${props.error}`}
      </text>
    </Show>
  );
}

// ─── CodebaseSearchStatus ──────────────────────────────────

export interface CodebaseSearchStatusProps {
  status: "idle" | "indexing" | "ready" | "error";
  fileCount?: number;
  error?: string;
}

export function CodebaseSearchStatus(props: CodebaseSearchStatusProps) {
  const theme = useTheme();

  const statusText = createMemo(() => {
    switch (props.status) {
      case "idle": {
        return "未索引";
      }
      case "indexing": {
        return `索引中... (${props.fileCount ?? 0} 文件)`;
      }
      case "ready": {
        return `就绪 (${props.fileCount ?? 0} 文件)`;
      }
      case "error": {
        return `错误: ${props.error || "未知"}`;
      }
    }
  });

  const statusFg = createMemo(() => {
    switch (props.status) {
      case "idle": {
        return theme.colors.muted;
      }
      case "indexing": {
        return theme.colors.info;
      }
      case "ready": {
        return theme.colors.success;
      }
      case "error": {
        return theme.colors.error;
      }
    }
  });

  return <text fg={statusFg()}>{`代码搜索: ${statusText()}`}</text>;
}
