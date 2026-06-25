/**
 * PendingToolCalls
 *
 * 职责:
 *   - 显示正在执行或排队中的工具调用
 *   - 显示工具参数信息
 *   - 显示执行状态和结果预览
 *
 * 模块功能:
 *   - 显示工具调用列表，支持展开/折叠
 *   - 显示状态统计(运行中、待执行、完成、错误)
 *   - 为不同工具类型显示对应图标
 *   - 显示执行时长
 *   - 支持取消待执行的工具调用
 *   - 提供简洁版组件用于状态栏显示
 *
 * 使用场景:
 *   - 当 AI 调用多个工具时显示调用队列
 *   - 在对话界面中显示执行进度
 *   - 状态栏显示工具执行概况
 *
 * 边界:
 *   1. 仅显示状态，不处理工具执行逻辑
 *   2. 取消操作仅对 pending 状态有效
 *   3. 参数显示长度限制为 100 字符
 *
 * 流程:
 *   1. 接收工具调用列表
 *   2. 计算并显示状态统计
 *   3. 渲染每个工具调用项(状态图标 + 工具名 + 时长)
 *   4. 展开时显示参数和结果预览
 */
import { For, Show, createSignal } from "solid-js";
import { useTheme } from "@/ui/contexts/theme";
import { Spinner } from "@/ui/components/spinner";

/** 工具调用状态 */
export type ToolCallStatus = "pending" | "executing" | "completed" | "error" | "cancelled";

/** 工具调用项 */
export interface PendingToolCall {
  /** 调用 ID */
  id: string;
  /** 工具名称 */
  toolName: string;
  /** 工具参数 */
  args: Record<string, unknown>;
  /** 状态 */
  status: ToolCallStatus;
  /** 开始时间 */
  startedAt?: number;
  /** 完成时间 */
  completedAt?: number;
  /** 结果预览 */
  resultPreview?: string;
  /** 错误信息 */
  error?: string;
}

/** 组件属性 */
export interface PendingToolCallsProps {
  /** 待执行的工具调用列表 */
  toolCalls: PendingToolCall[];
  /** 折叠状态 */
  collapsed?: boolean;
  /** 折叠回调 */
  onToggleCollapse?: () => void;
  /** 取消回调 */
  onCancel?: (id: string) => void;
}

import {
  toolBash,
  toolRead,
  toolWrite,
  toolCodeSearch,
  toolWebSearch,
  toolWebFetch,
  toolGit,
  toolSubagent,
  toolGeneric,
  iconLoading,
  actionExpand,
  actionCollapse,
} from "@/ui/utils/icon";
import { asciiCheckGlyph, asciiCrossGlyph, asciiCircleGlyph, toolIcon } from "@/core/icons/iconDerived";

/** 工具图标映射 */
const TOOL_ICONS: Record<string, string> = {
  "ace-code-search": toolCodeSearch,
  bash: toolBash,
  "codebase-search": toolCodeSearch,
  default: toolGeneric,
  "filesystem-edit": toolWrite,
  "filesystem-read": toolRead,
  "filesystem-write": toolWrite,
  git: toolGit,
  "subagent-execute": toolSubagent,
  "terminal-execute": toolBash,
  "web-fetch": toolWebFetch,
  "web-search": toolWebSearch,
};

/**
 * 获取工具图标
 */
/** getToolIcon 已迁 @core/iconDerived.toolIcon */

/**
 * 格式化参数为显示字符串
 */
function formatArgs(args: Record<string, unknown>, maxLength: number = 50): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    let str = `${key}=`;
    if (typeof value === "string") {
      str += `"${value.length > 20 ? `${value.slice(0, 20)}...` : value}"`;
    } else if (typeof value === "number" || typeof value === "boolean") {
      str += String(value);
    } else if (Array.isArray(value)) {
      str += `[${value.length} items]`;
    } else if (typeof value === "object" && value !== null) {
      str += `{${Object.keys(value).length} keys}`;
    } else {
      str += String(value);
    }
    parts.push(str);
  }
  const result = parts.join(", ");
  return result.length > maxLength ? `${result.slice(0, maxLength)}...` : result;
}

/**
 * 待执行工具调用组件。
 */
export function PendingToolCalls(props: PendingToolCallsProps) {
  const theme = useTheme();
  const { colors } = theme;

  const executingCount = () => props.toolCalls.filter((t) => t.status === "executing").length;

  const pendingCount = () => props.toolCalls.filter((t) => t.status === "pending").length;

  const completedCount = () => props.toolCalls.filter((t) => t.status === "completed").length;

  const errorCount = () => props.toolCalls.filter((t) => t.status === "error").length;

  return (
    <div
      style={{
        "margin-y": 1,
        padding: "0 1",
      }}
    >
      {/* 标题栏 */}
      <div
        style={{
          "align-items": "center",
          cursor: props.onToggleCollapse ? "pointer" : "default",
          display: "flex",
          "justify-content": "space-between",
        }}
        onClick={props.onToggleCollapse}
      >
        <div style={{ "align-items": "center", display: "flex", gap: 1 }}>
          <Show when={executingCount() > 0}>
            <Spinner />
          </Show>
          <Show when={executingCount() === 0}>
            <span style={{ color: colors.primary }}>{toolGeneric}</span>
          </Show>

          <span style={{ color: colors.text, "font-weight": "bold" }}>工具调用</span>

          <span style={{ color: colors.muted }}>({props.toolCalls.length})</span>
        </div>

        <div style={{ "align-items": "center", display: "flex", gap: 2 }}>
          {/* 状态统计 */}
          <Show when={executingCount() > 0}>
            <span style={{ color: colors.primary }}>运行中: {executingCount()}</span>
          </Show>
          <Show when={pendingCount() > 0}>
            <span style={{ color: colors.warning }}>待执行: {pendingCount()}</span>
          </Show>
          <Show when={completedCount() > 0}>
            <span style={{ color: colors.success }}>完成: {completedCount()}</span>
          </Show>
          <Show when={errorCount() > 0}>
            <span style={{ color: colors.error }}>错误: {errorCount()}</span>
          </Show>

          {/* 折叠按钮 */}
          <Show when={props.onToggleCollapse}>
            <span style={{ color: colors.muted }}>{props.collapsed ? actionExpand : actionCollapse}</span>
          </Show>
        </div>
      </div>

      {/* 工具调用列表 */}
      <Show when={!props.collapsed}>
        <div style={{ "margin-top": 1 }}>
          <For each={props.toolCalls}>
            {(toolCall) => <ToolCallItem toolCall={toolCall} colors={colors} onCancel={props.onCancel} />}
          </For>
        </div>
      </Show>
    </div>
  );
}

/**
 * 单个工具调用项。
 */
function ToolCallItem(props: {
  toolCall: PendingToolCall;
  colors: ReturnType<typeof useTheme>["colors"];
  onCancel?: (id: string) => void;
}) {
  const { toolCall, colors, onCancel } = props;
  const [expanded, setExpanded] = createSignal(false);

  const statusIcon = {
    cancelled: "⊘",
    completed: asciiCheckGlyph,
    error: asciiCrossGlyph,
    executing: iconLoading,
    pending: asciiCircleGlyph,
  };

  const statusColor = {
    cancelled: colors.muted,
    completed: colors.success,
    error: colors.error,
    executing: colors.primary,
    pending: colors.muted,
  };

  const duration = () => {
    if (!toolCall.startedAt) {
      return null;
    }
    const end = toolCall.completedAt ?? Date.now();
    return Math.floor((end - toolCall.startedAt) / 1000);
  };

  return (
    <div
      style={{
        "border-color": statusColor[toolCall.status],
        "border-left": true,
        "margin-y": 1,
        padding: "0 1",
      }}
    >
      {/* 工具调用头部 */}
      <div
        style={{
          "align-items": "center",
          cursor: "pointer",
          display: "flex",
          "justify-content": "space-between",
        }}
        onClick={() => setExpanded(!expanded())}
      >
        <div style={{ "align-items": "center", display: "flex", gap: 1 }}>
          <span style={{ color: statusColor[toolCall.status] }}>{statusIcon[toolCall.status]}</span>

          <Show when={toolCall.status === "executing"}>
            <Spinner />
          </Show>

          <span style={{ color: colors.accent }}>{toolIcon(toolCall.toolName)}</span>

          <span style={{ color: colors.text, "font-weight": "bold" }}>{toolCall.toolName}</span>

          <Show when={duration() !== null}>
            <span style={{ color: colors.muted, "font-size": "small" }}>({duration()}s)</span>
          </Show>
        </div>

        <div style={{ "align-items": "center", display: "flex", gap: 1 }}>
          <Show when={toolCall.status === "pending" && onCancel}>
            <button
              onClick={(e: MouseEvent) => {
                e.stopPropagation();
                onCancel?.(toolCall.id);
              }}
              style={{
                color: colors.muted,
                cursor: "pointer",
                "font-size": "small",
              }}
            >
              [取消]
            </button>
          </Show>

          <span style={{ color: colors.muted, "font-size": "small" }}>
            {expanded() ? actionExpand : actionCollapse}
          </span>
        </div>
      </div>

      {/* 参数信息 */}
      <Show when={expanded()}>
        <div
          style={{
            color: colors.muted,
            "font-size": "small",
            "margin-top": 1,
            "padding-left": 2,
          }}
        >
          <div>参数: {formatArgs(toolCall.args, 100)}</div>

          {/* 结果预览 */}
          <Show when={toolCall.resultPreview}>
            <div
              style={{
                color: colors.success,
                "margin-top": 1,
              }}
            >
              结果: {toolCall.resultPreview}
            </div>
          </Show>

          {/* 错误信息 */}
          <Show when={toolCall.error}>
            <div
              style={{
                color: colors.error,
                "margin-top": 1,
              }}
            >
              错误: {toolCall.error}
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}

/**
 * 简洁版工具调用状态(用于状态栏)。
 */
export function PendingToolCallsCompact(props: { toolCalls: PendingToolCall[] }) {
  const theme = useTheme();
  const { colors } = theme;

  const executingCount = () => props.toolCalls.filter((t) => t.status === "executing").length;

  const pendingCount = () => props.toolCalls.filter((t) => t.status === "pending").length;

  const hasErrors = () => props.toolCalls.some((t) => t.status === "error");

  return (
    <Show when={props.toolCalls.length > 0}>
      <div
        style={{
          "align-items": "center",
          display: "flex",
          gap: 1,
        }}
      >
        <Show when={executingCount() > 0}>
          <Spinner />
          <span style={{ color: colors.primary }}>执行中: {executingCount()}</span>
        </Show>

        <Show when={pendingCount() > 0}>
          <span style={{ color: colors.warning }}>待执行: {pendingCount()}</span>
        </Show>

        <Show when={hasErrors()}>
          <span style={{ color: colors.error }}>✗</span>
        </Show>
      </div>
    </Show>
  );
}
