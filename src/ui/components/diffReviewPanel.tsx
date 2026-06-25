/**
 * Diff 审查面板
 *
 * 职责:
 *   - 显示文件修改的差异内容
 *   - 展示新增/删除行统计
 *   - 支持接受或拒绝修改
 *
 * 模块功能:
 *   - 渲染文件路径和变更统计(新增/删除行数)
 *   - 显示 diff 内容(新增行绿色、删除行红色、上下文灰色)
 *   - 限制显示行数(最多20行)，超出显示省略提示
 *   - 支持多文件 diff 展示
 *
 * 使用场景:
 *   - AI 代码修改后需要人工审查
 *   - 查看文件变更的详细差异
 *   - 批量审查多个文件的修改
 *
 * 边界:
 *   1. 仅展示 diff 内容，不处理文件实际写入
 *   2. 每文件最多显示 20 行差异
 *   3. 接受/拒绝操作由外部处理
 *
 * 流程:
 *   1. 接收 DiffFile 数组
 *   2. 遍历渲染每个文件的差异
 *   3. 根据行类型应用不同颜色样式
 */
import { For, Show, createSignal } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import type { ThemeColors } from "@/ui/contexts/theme";

export interface DiffLine {
  type: "add" | "remove" | "context";
  content: string;
  lineNumber?: number;
}

export interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
  lines: DiffLine[];
}

interface DiffReviewPanelProps {
  colors: ThemeColors;
  files: DiffFile[];
  onAccept?: (filePath: string) => void;
  onReject?: (filePath: string) => void;
}

export function DiffReviewPanel(props: DiffReviewPanelProps) {
  const [selectedIdx, setSelectedIdx] = createSignal(0);

  useKeyboard((event) => {
    const name = event.name?.toLowerCase();
    if (name === "a" && props.onAccept) {
      const file = props.files[selectedIdx()];
      if (file) {
        props.onAccept(file.path);
      }
    }
    if (name === "r" && props.onReject) {
      const file = props.files[selectedIdx()];
      if (file) {
        props.onReject(file.path);
      }
    }
    if (name === "up" && selectedIdx() > 0) {
      setSelectedIdx((i) => i - 1);
    }
    if (name === "down" && selectedIdx() < props.files.length - 1) {
      setSelectedIdx((i) => i + 1);
    }
  });

  return (
    <box flexDirection="column" padding={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={props.colors.accent}>Diff 审查</text>
        <text fg={props.colors.muted}>↑↓ 选择 · a 接受 · r 拒绝</text>
      </box>

      <Show when={props.files.length === 0}>
        <box marginTop={1}>
          <text fg={props.colors.muted}>暂无待审查的变更。</text>
        </box>
      </Show>

      <For each={props.files}>
        {(file, index) => (
          <box flexDirection="column" marginTop={1}>
            <box>
              <text fg={index() === selectedIdx() ? props.colors.accent : props.colors.text}>
                {index() === selectedIdx() ? "▸ " : "  "}
                {file.path}
              </text>
              <text fg={props.colors.success}> +{file.additions}</text>
              <text fg={props.colors.error}> -{file.deletions}</text>
            </box>

            <Show when={index() === selectedIdx()}>
              <box flexDirection="column" paddingLeft={2}>
                <For each={file.lines.slice(0, 20)}>
                  {(line) => {
                    const color =
                      line.type === "add"
                        ? props.colors.success
                        : line.type === "remove"
                          ? props.colors.error
                          : props.colors.muted;
                    const prefix = line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";
                    return (
                      <box>
                        <text fg={color}>
                          {prefix} {line.content}
                        </text>
                      </box>
                    );
                  }}
                </For>
                <Show when={file.lines.length > 20}>
                  <text fg={props.colors.muted}>...(还有 {file.lines.length - 20} 行)</text>
                </Show>
              </box>
            </Show>
          </box>
        )}
      </For>
    </box>
  );
}
