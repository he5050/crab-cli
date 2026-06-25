/**
 * DiffViewer 文件树导航组件 — 列出 diff 中所有文件并支持键盘导航。
 *
 * 职责:
 *   - 列出 diff 中所有文件
 *   - 支持上下键选择文件
 *   - 选中文件时显示该文件的 diff
 *   - 支持展开/折叠文件夹
 *
 * 模块功能:
 *   - DiffViewerFileTree: 文件树导航组件
 *   - 文件状态标记(A/M/D)
 *   - 增删行数统计
 *
 * 使用场景:
 *   - 工具 diff 展示中的文件导航
 *   - 会话 diff 展示
 *
 * 边界:
 *   1. 仅负责文件列表展示和导航
 *   2. 依赖 pluginDiffModel 解析 diff 文件
 *   3. 支持键盘上下键和点击选择
 *
 * 流程:
 *   1. 解析 diff 为文件列表
 *   2. 构建树形结构
 *   3. 渲染文件树
 *   4. 处理键盘/点击导航
 */
import { For, Show, createMemo, createSignal } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import type { ThemeColors } from "@/ui/contexts/theme";
import {
  type DiffFileEntry,
  type DiffTreeRow,
  buildDiffTreeRows,
  clampDiffTreeRowIndex,
  formatDiffTreeRowPrefix,
  formatDiffTreeRowStatus,
  getDiffFolderPaths,
  parseDiffFiles,
  summarizeDiffFiles,
  toggleExpandedFolder,
} from "@/ui/pages/pluginDiffModel";

export interface DiffViewerFileTreeProps {
  /** Unified diff 字符串 */
  diff: string;
  /** 主题色 */
  colors: ThemeColors;
  /** 选中文件回调 */
  onSelectFile?: (file: DiffFileEntry) => void;
  /** 初始选中文件路径 */
  selectedFile?: string;
}

export function DiffViewerFileTree(props: DiffViewerFileTreeProps) {
  const [highlightedIndex, setHighlightedIndex] = createSignal(0);
  const [expandedFolders, setExpandedFolders] = createSignal<string[]>([]);

  const files = createMemo(() => parseDiffFiles(props.diff));
  const summary = createMemo(() => summarizeDiffFiles(files()));
  const folderPaths = createMemo(() => getDiffFolderPaths(files()));

  // 初始化展开所有文件夹
  const treeRows = createMemo(() => {
    const folders = expandedFolders().length === 0 ? folderPaths() : expandedFolders();
    return buildDiffTreeRows(files(), folders);
  });

  const highlightedRow = createMemo(() => treeRows()[clampDiffTreeRowIndex(highlightedIndex(), treeRows())]);

  const moveFocus = (offset: number) => {
    const next = clampDiffTreeRowIndex(highlightedIndex() + offset, treeRows());
    setHighlightedIndex(next);
    const row = treeRows()[next];
    if (typeof row?.fileIndex === "number") {
      const file = files()[row.fileIndex];
      if (file) {
        props.onSelectFile?.(file);
      }
    }
  };

  const toggleFolder = (folderPath: string | undefined) => {
    if (!folderPath) {
      return;
    }
    setExpandedFolders((folders) => toggleExpandedFolder(folders, folderPath));
  };

  const handleRowClick = (row: DiffTreeRow, index: number) => {
    setHighlightedIndex(index);
    if (row.kind === "folder") {
      toggleFolder(row.path);
    } else if (typeof row.fileIndex === "number") {
      const file = files()[row.fileIndex];
      if (file) {
        props.onSelectFile?.(file);
      }
    }
  };

  useKeyboard((event) => {
    if (event.name === "down" || event.name === "j") {
      moveFocus(1);
      event.stopPropagation();
      return;
    }
    if (event.name === "up" || event.name === "k") {
      moveFocus(-1);
      event.stopPropagation();
      return;
    }
    if (event.name === "return" || event.name === "enter" || event.name === "space") {
      const row = highlightedRow();
      if (row?.kind === "folder") {
        toggleFolder(row.path);
      }
      event.stopPropagation();
    }
  });

  return (
    <Show when={files().length > 0}>
      <box flexDirection="column" flexShrink={0}>
        <text fg={props.colors.muted}>
          {summary().files} 个文件 · +{summary().additions} -{summary().deletions}
        </text>
        <For each={treeRows()}>
          {(row, index) => (
            <box
              flexDirection="row"
              backgroundColor={
                index() === clampDiffTreeRowIndex(highlightedIndex(), treeRows()) ? props.colors.primary : undefined
              }
              onMouseUp={() => handleRowClick(row, index())}
            >
              <text fg={index() === highlightedIndex() ? props.colors.background : props.colors.muted} wrapMode="none">
                {formatDiffTreeRowPrefix(treeRows(), index())}
              </text>
              <text
                fg={index() === highlightedIndex() ? props.colors.background : props.colors.text}
                wrapMode="none"
                flexGrow={1}
              >
                {row.name}
              </text>
              <text fg={index() === highlightedIndex() ? props.colors.background : props.colors.muted} wrapMode="none">
                {formatDiffTreeRowStatus(row, false)}
              </text>
            </box>
          )}
        </For>
      </box>
    </Show>
  );
}
