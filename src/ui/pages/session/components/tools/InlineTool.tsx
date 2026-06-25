/**
 * 内联工具显示组件 — 在行内展示工具调用概要。
 *
 * 职责:
 *   - 以单行形式显示工具调用
 *   - 展示工具状态和进度
 *   - 支持运行中动画(spinner)
 *   - 显示失败错误信息
 *
 * 模块功能:
 *   - InlineTool: 内联工具显示组件
 *   - InlineToolRow: 行组件
 *   - statusColor: 根据状态返回颜色
 *
 * 使用场景:
 *   - 聊天消息中的工具调用行内展示
 *   - 工具执行进度显示
 *
 * 边界:
 *   1. 仅负责 UI 渲染
 *   2. 不支持展开详情
 *   3. 依赖 toolRenderSpec 模块获取工具渲染规格
 *
 * 流程:
 *   1. 显示工具图标和名称
 *   2. 运行中显示 spinner 动画
 *   3. 失败时显示错误信息(截断)
 *   4. 点击可交互
 */
import { Show } from "solid-js";
import { SPINNER_FRAMES } from "@/ui/components/spinner";
import type { ToolPart } from "@/ui/contexts/chat";
import type { ThemeColors } from "@/ui/contexts/theme";
import { createStatusColorMap } from "@/ui/utils/statusColors";
import { type ToolRenderSpec, getToolSubtitle, getToolTitle, resolveToolRenderer } from "./toolRenderSpec";

const INLINE_TOOL_ICON_WIDTH = 2;

function statusColor(part: ToolPart, colors: ThemeColors): string {
  const status = part.status === "error" || !part.success ? "error" : (part.status ?? "");
  return createStatusColorMap<string>(
    {
      calling: colors.warning,
      error: colors.error,
      running: colors.warning,
    },
    colors.muted,
  )(status);
}

export function InlineToolRow(props: {
  icon: string;
  label: string;
  subtitle?: string;
  colors: ThemeColors;
  complete: boolean;
  failed?: boolean;
  pendingText?: string;
  spinFrame?: number;
  onClick?: () => void;
}) {
  return (
    <box paddingLeft={3} marginTop={1} flexDirection="column" flexShrink={0}>
      <Show
        when={props.complete}
        fallback={
          <text fg={props.colors.muted} paddingLeft={INLINE_TOOL_ICON_WIDTH + 1}>
            {`~ ${props.pendingText ?? "处理中..."}`}
          </text>
        }
      >
        <box flexDirection="row" flexShrink={0} onMouseUp={props.onClick}>
          <box width={INLINE_TOOL_ICON_WIDTH} flexShrink={0}>
            <text fg={props.failed ? props.colors.error : props.colors.muted}>{props.icon}</text>
          </box>
          <box flexGrow={1} flexDirection="row" flexShrink={0}>
            <Show when={props.spinFrame !== undefined}>
              <text fg={props.colors.warning}>{`${SPINNER_FRAMES[props.spinFrame ?? 0] ?? "⟳"} `}</text>
            </Show>
            <text fg={props.failed ? props.colors.error : props.colors.text}>{props.label}</text>
            <Show when={props.subtitle}>
              <text fg={props.colors.muted}> {props.subtitle}</text>
            </Show>
          </box>
        </box>
      </Show>
    </box>
  );
}

export function InlineTool(props: {
  part: ToolPart;
  colors: ThemeColors;
  spec?: ToolRenderSpec;
  spinFrame?: number;
  onClick?: () => void;
}) {
  const spec = () => props.spec ?? resolveToolRenderer(props.part);
  const running = () => props.part.status === "running" || props.part.status === "calling";
  const failed = () => props.part.status === "error" || !props.part.success;
  const title = () => {
    if (running()) {
      return spec().pendingText;
    }
    const primary = getToolTitle(props.part, spec());
    return spec().name === "GenericTool" ? `${props.part.tool} ${primary}`.trim() : primary;
  };
  const subtitle = () => getToolSubtitle(props.part);
  const color = () => statusColor(props.part, props.colors);

  return (
    <box flexDirection="column" flexShrink={0}>
      <InlineToolRow
        icon={spec().icon}
        label={title()}
        subtitle={subtitle()}
        colors={{ ...props.colors, text: color() }}
        complete={!running()}
        failed={failed()}
        pendingText={spec().pendingText}
        spinFrame={running() ? props.spinFrame : undefined}
        onClick={props.onClick}
      />
      <Show when={failed() && props.part.output}>
        <box paddingLeft={5} flexShrink={0}>
          <text fg={props.colors.error}>{(props.part.output ?? "").replace(/^Error:\s*/, "").slice(0, 160)}</text>
        </box>
      </Show>
    </box>
  );
}
