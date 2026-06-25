/**
 * CodebaseSearchStatus
 *
 * 职责:
 *   - 显示代码库搜索的当前状态(搜索中、重试、结果提示)
 *   - 显示搜索进度和统计信息
 *   - 支持取消搜索操作
 *
 * 模块功能:
 *   - 支持多种搜索状态:searching、retrying、completed、error、cancelled
 *   - 显示状态图标和标签
 *   - 显示搜索查询内容
 *   - 显示搜索进度(已搜索文件数/总文件数)
 *   - 显示重试次数
 *   - 显示搜索结果数量
 *   - 支持取消正在进行的搜索
 *   - 提供简洁版组件用于紧凑布局
 *
 * 使用场景:
 *   - 当 AI 调用 codebase-search 工具时显示
 *   - 在对话界面中作为临时状态提示
 *   - 状态栏显示搜索进度
 *
 * 边界:
 *   1. 仅显示搜索状态，不处理实际搜索逻辑
 *   2. 取消操作仅对 searching 状态有效
 *   3. 查询内容超过 30 字符时截断显示
 *
 * 流程:
 *   1. 接收搜索状态和查询信息
 *   2. 根据状态渲染对应图标和颜色
 *   3. 显示进度和结果统计
 *   4. 处理取消操作
 */
import { Show } from "solid-js";
import { useTheme } from "@/ui/contexts/theme";
import { Spinner } from "@/ui/components/spinner";
import { actionRefresh, iconError, iconSearch, iconSuccess } from "@/ui/utils/icon";

/** 搜索状态类型 */
export type SearchStatus = "searching" | "retrying" | "completed" | "error" | "cancelled";

/** 组件属性 */
export interface CodebaseSearchStatusProps {
  /** 当前状态 */
  status: SearchStatus;
  /** 搜索查询 */
  query: string;
  /** 已搜索文件数 */
  searchedFiles?: number;
  /** 总文件数 */
  totalFiles?: number;
  /** 找到结果数 */
  resultsCount?: number;
  /** 重试次数 */
  retryCount?: number;
  /** 错误信息 */
  error?: string;
  /** 取消回调 */
  onCancel?: () => void;
}

/**
 * 代码库搜索状态组件。
 */
export function CodebaseSearchStatus(props: CodebaseSearchStatusProps) {
  const theme = useTheme();
  const { colors } = theme;

  const statusConfig = {
    cancelled: {
      color: colors.muted,
      icon: "⊘",
      label: "已取消",
    },
    completed: {
      color: colors.success,
      icon: iconSuccess,
      label: "搜索完成",
    },
    error: {
      color: colors.error,
      icon: iconError,
      label: "搜索失败",
    },
    retrying: {
      color: colors.warning,
      icon: actionRefresh,
      label: "重试中",
    },
    searching: {
      color: colors.primary,
      icon: iconSearch,
      label: "搜索中",
    },
  };

  const config = statusConfig[props.status];

  return (
    <div
      style={{
        "border-color": config.color,
        "border-left": true,
        "margin-y": 1,
        padding: "0 1",
      }}
    >
      {/* 状态行 */}
      <div style={{ "align-items": "center", display: "flex", gap: 1 }}>
        <span style={{ color: config.color }}>{config.icon}</span>

        <Show when={props.status === "searching" || props.status === "retrying"}>
          <Spinner />
        </Show>

        <span style={{ color: colors.text, "font-weight": "bold" }}>{config.label}</span>

        <Show when={props.retryCount && props.retryCount > 0}>
          <span style={{ color: colors.warning }}>(重试 {props.retryCount} 次)</span>
        </Show>

        <Show when={props.status === "searching" && props.onCancel}>
          <button
            onClick={props.onCancel}
            style={{
              color: colors.muted,
              cursor: "pointer",
              "margin-left": 2,
            }}
          >
            [取消]
          </button>
        </Show>
      </div>

      {/* 查询信息 */}
      <div style={{ color: colors.muted, "margin-top": 1 }}>
        查询: <span style={{ color: colors.text }}>{props.query}</span>
      </div>

      {/* 进度信息 */}
      <Show when={props.status === "searching" && props.totalFiles && props.totalFiles > 0}>
        <div style={{ color: colors.muted, "margin-top": 1 }}>
          进度: {props.searchedFiles ?? 0} / {props.totalFiles} 文件
          <Show when={props.resultsCount !== undefined}> | 已找到 {props.resultsCount} 个结果</Show>
        </div>
      </Show>

      {/* 完成信息 */}
      <Show when={props.status === "completed" && props.resultsCount !== undefined}>
        <div style={{ color: colors.success, "margin-top": 1 }}>找到 {props.resultsCount} 个相关结果</div>
      </Show>

      {/* 错误信息 */}
      <Show when={props.status === "error" && props.error}>
        <div style={{ color: colors.error, "margin-top": 1 }}>错误: {props.error}</div>
      </Show>
    </div>
  );
}

/**
 * 简洁版搜索状态(用于紧凑布局)。
 */
export function CodebaseSearchStatusCompact(
  props: Pick<CodebaseSearchStatusProps, "status" | "query" | "resultsCount">,
) {
  const theme = useTheme();
  const { colors } = theme;

  const statusIcon = {
    cancelled: "⊘",
    completed: iconSuccess,
    error: iconError,
    retrying: actionRefresh,
    searching: iconSearch,
  };

  const statusColor = {
    cancelled: colors.muted,
    completed: colors.success,
    error: colors.error,
    retrying: colors.warning,
    searching: colors.primary,
  };

  return (
    <div style={{ "align-items": "center", display: "flex", gap: 1 }}>
      <span style={{ color: statusColor[props.status] }}>{statusIcon[props.status]}</span>
      <Show when={props.status === "searching" || props.status === "retrying"}>
        <Spinner />
      </Show>
      <span style={{ color: colors.muted }}>
        {props.query.slice(0, 30)}
        {props.query.length > 30 ? "..." : ""}
      </span>
      <Show when={props.status === "completed" && props.resultsCount !== undefined}>
        <span style={{ color: colors.success }}>({props.resultsCount} 结果)</span>
      </Show>
    </div>
  );
}
