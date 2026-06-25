/**
 * 块级工具显示组件 — 以块形式展示工具调用详情。
 *
 * 职责:
 *   - 以块形式显示工具调用
 *   - 支持展开/折叠详情
 *   - 显示工具状态(运行中/成功/失败)
 *   - 展示工具输入、输出、diff、诊断信息
 *
 * 模块功能:
 *   - BlockTool: 块级工具显示组件
 *   - blockColor: 根据状态返回边框颜色
 *
 * 使用场景:
 *   - 聊天消息中的工具调用展示
 *   - 工具执行过程展示
 *
 * 边界:
 *   1. 仅负责 UI 渲染
 *   2. 支持折叠以节省空间
 *   3. 依赖 toolRenderSpec 模块获取工具渲染规格
 *
 * 流程:
 *   1. 显示工具标题和图标
 *   2. 折叠状态显示预览信息
 *   3. 展开状态显示完整详情
 *   4. 点击可打开 diff 查看器
 */
import { For, Show } from "solid-js";
import type { ToolPart } from "@/ui/contexts/chat";
import type { ThemeColors } from "@/ui/contexts/theme";
import { useTheme } from "@/ui/contexts/theme";
import {
  type ToolRenderSpec,
  getToolDiagnostics,
  getToolDiff,
  getToolFiles,
  getToolInput,
  getToolPreview,
  getToolSubtitle,
  getToolTitle,
  resolveToolRenderer,
} from "./toolRenderSpec";
import { DiffViewer } from "./DiffViewer";
import { generateToolSyntaxStyle } from "@/ui/themes/syntaxGenerator";
import { filetypeFromPath } from "./toolRendererHelpers";

const ToolLeftBorder = {
  bottomLeft: "",
  bottomRight: "",
  bottomT: "",
  cross: "",
  horizontal: " ",
  leftT: "",
  rightT: "",
  topLeft: "",
  topRight: "",
  topT: "",
  vertical: "│",
};

function blockColor(part: ToolPart, colors: ThemeColors): string {
  if (part.status === "error" || !part.success) {
    return colors.error;
  }
  if (part.status === "running" || part.status === "calling") {
    return colors.warning;
  }
  return colors.border;
}

export function BlockTool(props: {
  part: ToolPart;
  colors: ThemeColors;
  spec?: ToolRenderSpec;
  expanded: boolean;
  onToggle: () => void;
  onOpenDiff?: () => void;
}) {
  const spec = () => props.spec ?? resolveToolRenderer(props.part);
  const running = () => props.part.status === "running" || props.part.status === "calling";
  const failed = () => props.part.status === "error" || !props.part.success;
  const title = () => (running() ? spec().pendingText : getToolTitle(props.part, spec()));
  const subtitle = () => getToolSubtitle(props.part);
  const preview = () => getToolPreview(props.part);
  const files = () => getToolFiles(props.part);
  const diagnostics = () => getToolDiagnostics(props.part);
  const diff = () => getToolDiff(props.part);
  const canToggle = () =>
    Boolean(props.part.args || props.part.output || preview() || files().length || diagnostics().length || diff());

  return (
    <box paddingLeft={2} marginTop={1} flexShrink={0}>
      <box border={["left"]} borderColor={blockColor(props.part, props.colors)} customBorderChars={ToolLeftBorder}>
        <box paddingTop={1} paddingBottom={1} paddingLeft={2} flexDirection="column" flexShrink={0}>
          <box flexDirection="row" flexShrink={0} onMouseUp={() => canToggle() && props.onToggle()}>
            <text fg={failed() ? props.colors.error : props.colors.text}>
              {`${spec().icon} `}
              <span style={{ bold: true }}>{title()}</span>
            </text>
            <Show when={subtitle()}>
              <text fg={props.colors.muted}> {subtitle()}</text>
            </Show>
            <Show when={canToggle() && !running()}>
              <text fg={props.colors.muted}> {props.expanded ? actionCollapse : "▸"}</text>
            </Show>
          </box>

          <Show when={!props.expanded && preview()}>
            <box marginTop={1} flexShrink={0}>
              <text fg={failed() ? props.colors.error : props.colors.muted}>{(preview() ?? "").slice(0, 240)}</text>
            </box>
          </Show>

          <Show when={props.expanded}>
            <Show when={files().length > 0}>
              <box marginTop={1} flexDirection="column" flexShrink={0}>
                <text fg={props.colors.muted}>文件:</text>
                <For each={files().slice(0, 8)}>
                  {(file) => (
                    <text fg={props.colors.text}>{`${file.status ?? "done"} ${file.kind ?? "file"} ${file.path}`}</text>
                  )}
                </For>
              </box>
            </Show>

            <Show when={diagnostics().length > 0}>
              <box marginTop={1} flexDirection="column" flexShrink={0}>
                <text fg={props.colors.muted}>诊断:</text>
                <For each={diagnostics().slice(0, 8)}>
                  {(diagnostic) => (
                    <text fg={props.colors.warning}>
                      {typeof diagnostic === "string" ? diagnostic : JSON.stringify(diagnostic)}
                    </text>
                  )}
                </For>
              </box>
            </Show>

            <Show when={diff()}>
              <box marginTop={1} flexDirection="column" flexShrink={0}>
                <box flexDirection="row" gap={1}>
                  <text fg={props.colors.muted}>Diff:</text>
                  <Show when={props.onOpenDiff}>
                    <text fg={props.colors.primary} onMouseUp={() => props.onOpenDiff?.()}>
                      打开查看器
                    </text>
                  </Show>
                </box>
                <DiffViewer
                  diff={diff() ?? ""}
                  filetype={filetypeFromPath(getToolFiles(props.part)[0]?.path)}
                  view="unified"
                  showLineNumbers={false}
                  wrapMode="none"
                  colors={props.colors}
                  syntaxStyle={generateToolSyntaxStyle(props.colors) as any}
                  conceal={false}
                />
              </box>
            </Show>

            <Show when={props.part.args}>
              <box marginTop={1} flexDirection="column" flexShrink={0}>
                <text fg={props.colors.muted}>输入:</text>
                <text fg={props.colors.text}>{(props.part.args ?? "").slice(0, 500)}</text>
              </box>
            </Show>
            <Show when={props.part.output}>
              <box marginTop={1} flexDirection="column" flexShrink={0}>
                <text fg={props.colors.muted}>输出:</text>
                <text fg={failed() ? props.colors.error : props.colors.text}>
                  {(props.part.output ?? "").slice(0, 1000)}
                </text>
              </box>
            </Show>
          </Show>
        </box>
      </box>
    </box>
  );
}

import { actionCollapse } from "@/ui/utils/icon";
