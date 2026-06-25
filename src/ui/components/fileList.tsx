/**
 * FileList 组件
 *
 * 职责:
 *   - 提供文件列表展示组件，支持多文件操作结果、文件树、搜索结果
 *   - 支持交互式文件选择和操作
 *
 * 模块功能:
 *   - 显示文件列表，支持文件状态标识(added/modified/deleted/renamed/untracked)
 *   - 支持显示文件差异统计(新增/删除行数)
 *   - 支持交互式导航(上下键选择、Enter 确认)
 *   - 滚动窗口显示，支持大量文件
 *   - 支持目录标识(📁)
 *
 * 使用场景:
 *   - 显示 Git 状态文件列表时
 *   - 显示搜索结果文件列表时
 *   - 需要用户选择文件进行操作时
 *   - 显示文件操作结果时
 *
 * 边界:
 *   1. 状态图标:+ added / ~ modified / - deleted / → renamed / ? untracked
 *   2. 默认最大显示 15 条，可通过 maxHeight 配置
 *   3. 交互模式支持键盘导航和选择
 *   4. 支持显示重命名文件的旧路径
 *
 * 流程:
 *   1. 接收文件列表数据
 *   2. 计算显示窗口(滚动)
 *   3. 渲染文件列表，显示状态和差异统计
 *   4. 交互模式下响应键盘事件
 *   5. 选择时调用 onSelect 回调
 */

import { For, Show, createMemo, createSignal } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useTheme } from "@/ui/contexts/theme";
import { createStatusColorMap } from "@/ui/utils/statusColors";
import { iconFolder } from "@/ui/utils/icon";
import { gitFileStatusIcon } from "@/core/icons/iconDerived";

// ─── 文件条目类型 ──────────────────────────────────────────

export interface FileEntry {
  path: string;
  status?: "added" | "modified" | "deleted" | "renamed" | "untracked";
  oldPath?: string;
  linesAdded?: number;
  linesRemoved?: number;
  isDir?: boolean;
  expandable?: boolean;
}

export interface FileListProps {
  files: FileEntry[];
  title?: string;
  showStatus?: boolean;
  showDiffStats?: boolean;
  interactive?: boolean;
  onSelect?: (file: FileEntry) => void;
  onClose?: () => void;
  maxHeight?: number;
}

// ─── 状态图标和颜色 ────────────────────────────────────────

/** statusIcon 已迁 @core/iconDerived.gitFileStatusIcon */

function statusColor(
  status: string | undefined,
  colors: { success: string; warning: string; error: string; info: string; muted: string },
): string {
  return createStatusColorMap<string>(
    {
      added: colors.success,
      deleted: colors.error,
      modified: colors.warning,
      renamed: colors.info,
      untracked: colors.muted,
    },
    colors.muted,
  )(status ?? "");
}

// ─── FileList 组件 ─────────────────────────────────────────

export function FileList(props: FileListProps) {
  const theme = useTheme();
  const [focusIndex, setFocusIndex] = createSignal(0);

  const files = () => props.files || [];
  const maxVisible = createMemo(() => props.maxHeight ?? 15);

  const displayWindow = createMemo(() => {
    const items = files();
    const sel = focusIndex();
    const max = maxVisible();
    if (items.length <= max) {
      return { items, startIndex: 0 };
    }
    let start = Math.max(0, sel - Math.floor(max / 2));
    const end = Math.min(items.length, start + max);
    if (end - start < max) {
      start = Math.max(0, end - max);
    }
    return { items: items.slice(start, end), startIndex: start };
  });

  useKeyboard((event) => {
    if (!props.interactive) {
      return;
    }
    if (event.name === "escape") {
      props.onClose?.();
      return;
    }
    if (event.name === "up") {
      setFocusIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (event.name === "down") {
      setFocusIndex((i) => Math.min(files().length - 1, i + 1));
      return;
    }
    if (event.name === "return" || event.name === "enter") {
      const file = files()[focusIndex()];
      if (file) {
        props.onSelect?.(file);
      }
    }
  });

  return (
    <box flexDirection="column" gap={1}>
      <Show when={props.title}>
        <text fg={theme.colors.text}>
          <b>{props.title}</b>
          <span style={{ fg: theme.colors.muted }}> {`(${files().length})`}</span>
        </text>
      </Show>

      <Show when={files().length === 0}>
        <text fg={theme.colors.muted}>{"暂无文件"}</text>
      </Show>

      <Show when={files().length > 0}>
        <For each={displayWindow().items}>
          {(file, index) => {
            const originalIndex = () => displayWindow().startIndex + index();
            const isSelected = () => props.interactive && originalIndex() === focusIndex();
            return (
              <box
                flexDirection="row"
                gap={1}
                backgroundColor={isSelected() ? theme.colors.primary : undefined}
                paddingLeft={1}
                paddingRight={1}
              >
                <Show when={props.showStatus && file.status}>
                  <text fg={statusColor(file.status, theme.colors)} flexShrink={0}>
                    {gitFileStatusIcon(file.status)}
                  </text>
                </Show>
                <text fg={isSelected() ? theme.colors.text : theme.colors.muted} flexGrow={1} wrapMode="word">
                  {file.isDir ? `${iconFolder} ` : ""}
                  {file.path}
                  <Show when={file.oldPath}>
                    <span style={{ fg: theme.colors.muted }}>{` ← ${file.oldPath}`}</span>
                  </Show>
                </text>
                <Show when={props.showDiffStats && (file.linesAdded || file.linesRemoved)}>
                  <box flexDirection="row" gap={0} flexShrink={0}>
                    <Show when={file.linesAdded}>
                      <text fg={theme.colors.success}>{`+${file.linesAdded}`}</text>
                    </Show>
                    <Show when={file.linesRemoved}>
                      <text fg={theme.colors.error}>{`-${file.linesRemoved}`}</text>
                    </Show>
                  </box>
                </Show>
              </box>
            );
          }}
        </For>
      </Show>

      <Show when={props.interactive}>
        <text fg={theme.colors.muted}>{"↑↓ 导航 · Enter 选择 · Esc 返回"}</text>
      </Show>
    </box>
  );
}
