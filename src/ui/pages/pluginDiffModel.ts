/**
 * Diff 查看器数据模型 — diff 解析、树形结构构建和格式化工具。
 *
 * 职责:
 *   - 解析 Git diff 格式文本
 *   - 构建 diff 文件树形结构
 *   - 提供 diff 相关的数据结构和工具函数
 *   - 处理 diff 视图的布局和交互逻辑
 *
 * 模块功能:
 *   - DiffFileEntry/DiffSummary/DiffTreeRow: 数据结构定义
 *   - DiffSourceOption/DiffViewMode/DiffFileStatus: 类型定义
 *   - parseDiffFiles: 解析 diff 文本为文件列表
 *   - summarizeDiffFiles: 汇总 diff 统计
 *   - buildDiffTreeRows: 构建文件树形结构
 *   - toggleExpandedFolder: 切换文件夹展开状态
 *   - findDiffFileIndex: 查找文件索引
 *   - clamp*Index: 索引边界限制
 *   - formatDiffTreeRow*: 树形行格式化
 *
 * 使用场景:
 *   - diff 查看器组件
 *   - 会话 diff 展示
 *   - 工具调用 diff 显示
 *
 * 边界:
 *   1. 仅处理数据解析和格式化，不涉及 UI 渲染
 *   2. 假设输入为标准 Git diff 格式
 *   3. 文件树构建支持嵌套目录结构
 *   4. 视图模式支持 split/unified 两种
 *
 * 流程:
 *   1. 接收原始 diff 文本
 *   2. 解析为文件列表(含统计信息)
 *   3. 构建树形结构(文件夹+文件)
 *   4. 处理用户交互(展开/折叠/选择)
 *   5. 格式化显示数据
 */
export interface DiffFileEntry {
  path: string;
  oldPath?: string;
  additions: number;
  deletions: number;
  hunks: number;
  diff: string;
  status: DiffFileStatus;
}

export interface DiffSummary {
  files: number;
  additions: number;
  deletions: number;
}

export interface DiffTreeRow {
  kind: "folder" | "file";
  path: string;
  name: string;
  depth: number;
  expanded?: boolean;
  fileIndex?: number;
  additions?: number;
  deletions?: number;
  status?: DiffFileStatus;
}

export interface DiffSourceOption {
  id: string;
  label: string;
  diff: string;
  filename?: string;
  selectedFile?: string;
  source?: string;
  args?: string;
  tool?: string;
  callId?: string;
}

export type DiffViewMode = "split" | "unified";
export type DiffFileStatus = "added" | "deleted" | "modified";

export const DIFF_VIEWER_SHOW_FILE_TREE_KEY = "diff_viewer_show_file_tree";
export const DIFF_VIEWER_SINGLE_PATCH_KEY = "diff_viewer_single_patch";
export const DIFF_VIEWER_VIEW_KEY = "diff_viewer_view";

export function parseDiffFiles(diff: string): DiffFileEntry[] {
  const lines = diff.split("\n");
  const files: DiffFileEntry[] = [];
  let current: DiffFileEntry | undefined;

  const pushCurrent = () => {
    if (current && current.diff.trim()) {
      files.push(current);
    }
  };

  for (const line of lines) {
    const gitMatch = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (gitMatch) {
      pushCurrent();
      current = {
        additions: 0,
        deletions: 0,
        diff: line,
        hunks: 0,
        oldPath: gitMatch[1],
        path: gitMatch[2] ?? gitMatch[1]!,
        status: "modified",
      };
      continue;
    }

    const plusMatch = /^\+\+\+ b\/(.+)$/.exec(line);
    const minusMatch = /^--- a\/(.+)$/.exec(line);
    if (!current && plusMatch) {
      current = {
        additions: 0,
        deletions: 0,
        diff: "",
        hunks: 0,
        path: plusMatch[1]!,
        status: "modified",
      };
    } else if (current && plusMatch && current.path === "patch") {
      current.path = plusMatch[1]!;
    }

    if (!current && line.trim()) {
      current = {
        additions: 0,
        deletions: 0,
        diff: "",
        hunks: 0,
        path: "patch",
        status: "modified",
      };
    }

    if (!current) {
      continue;
    }
    current.diff = current.diff ? `${current.diff}\n${line}` : line;

    if (line.startsWith("new file mode") || line === "--- /dev/null") {
      current.status = "added";
    }
    if (line.startsWith("deleted file mode") || line === "+++ /dev/null") {
      current.status = "deleted";
    }
    if (plusMatch && current.status !== "deleted") {
      current.path = plusMatch[1]!;
    }
    if (minusMatch && !current.oldPath) {
      current.oldPath = minusMatch[1]!;
    }
    if (line.startsWith("@@")) {
      current.hunks += 1;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.additions += 1;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      current.deletions += 1;
    }
  }

  pushCurrent();
  return files;
}

export function summarizeDiffFiles(files: DiffFileEntry[]): DiffSummary {
  return {
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    files: files.length,
  };
}

export function getDiffFolderPaths(files: DiffFileEntry[]): string[] {
  const folders = new Set<string>();
  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    for (let index = 1; index < parts.length; index++) {
      folders.add(parts.slice(0, index).join("/"));
    }
  }
  return [...folders].toSorted((a, b) => a.localeCompare(b));
}

export function getParentFolderPath(filePath: string | undefined): string | undefined {
  if (!filePath) {
    return undefined;
  }
  const parts = filePath.split("/").filter(Boolean);
  if (parts.length <= 1) {
    return undefined;
  }
  return parts.slice(0, -1).join("/");
}

export function buildDiffTreeRows(files: DiffFileEntry[], expandedFolders: Iterable<string>): DiffTreeRow[] {
  const expanded = new Set(expandedFolders);
  const root = createTreeFolder("", "");

  files.forEach((file, fileIndex) => {
    const parts = file.path.split("/").filter(Boolean);
    let current = root;
    for (let index = 0; index < parts.length; index++) {
      const name = parts[index]!;
      const path = parts.slice(0, index + 1).join("/");
      const isFile = index === parts.length - 1;
      let child = current.children.get(name);
      if (!child) {
        child = isFile ? createTreeFile(path, name, fileIndex, file) : createTreeFolder(path, name);
        current.children.set(name, child);
      }
      if (isFile) {
        child.kind = "file";
        child.fileIndex = fileIndex;
        child.additions = file.additions;
        child.deletions = file.deletions;
        child.status = file.status;
      }
      current = child;
    }
  });

  return flattenTreeRows(root, expanded, -1);
}

export function getDiffSourceLabel(data: Record<string, unknown> | undefined): string {
  const source = typeof data?.source === "string" ? data.source : "git";
  const args = typeof data?.args === "string" && data.args.trim() ? ` ${data.args.trim()}` : "";
  if (source === "tool") {
    return "tool diff";
  }
  if (source === "session") {
    return "session diff";
  }
  return `git diff${args}`;
}

export function toggleExpandedFolder(folders: Iterable<string>, folderPath: string | undefined): string[] {
  if (!folderPath) {
    return [...folders];
  }
  const next = new Set(folders);
  if (next.has(folderPath)) {
    next.delete(folderPath);
  } else {
    next.add(folderPath);
  }
  return [...next].toSorted((a, b) => a.localeCompare(b));
}

export function getDiffSourceOptions(data: Record<string, unknown> | undefined): DiffSourceOption[] {
  const options: DiffSourceOption[] = [];
  const base = toSourceOption(data, "source-0");
  if (base) {
    options.push(base);
  }

  const sources = data?.sources;
  if (Array.isArray(sources)) {
    for (const [index, source] of sources.entries()) {
      const option = toSourceOption(asRecord(source), `source-${index + 1}`);
      if (option && !options.some((current) => current.id === option.id)) {
        options.push(option);
      }
    }
  }

  return options;
}

export function clampFileIndex(index: number, files: DiffFileEntry[]): number {
  if (files.length === 0) {
    return 0;
  }
  if (index < 0) {
    return files.length - 1;
  }
  if (index >= files.length) {
    return 0;
  }
  return index;
}

export function moveDiffFileIndex(index: number, files: DiffFileEntry[], offset: number): number {
  if (files.length === 0) {
    return 0;
  }
  return Math.max(0, Math.min(files.length - 1, index + offset));
}

export function clampDiffTreeRowIndex(index: number, rows: DiffTreeRow[]): number {
  if (rows.length === 0) {
    return 0;
  }
  return Math.max(0, Math.min(rows.length - 1, index));
}

export function findDiffTreeRowIndexForFile(rows: DiffTreeRow[], fileIndex: number): number {
  const index = rows.findIndex((row) => row.fileIndex === fileIndex);
  return index !== -1 ? index : 0;
}

export function clampSourceIndex(index: number, sources: DiffSourceOption[]): number {
  if (sources.length === 0) {
    return 0;
  }
  if (index < 0) {
    return sources.length - 1;
  }
  if (index >= sources.length) {
    return 0;
  }
  return index;
}

export function isDiffViewerSplitAvailable(patchPaneWidth: number): boolean {
  return patchPaneWidth >= 100;
}

export function resolveDiffViewerView(
  requested: unknown,
  splitAvailable: boolean,
  defaultStyle: "auto" | "stacked" = "auto",
): DiffViewMode {
  const stored = requested === "split" || requested === "unified" ? requested : undefined;
  const defaultView: DiffViewMode = defaultStyle === "stacked" ? "unified" : splitAvailable ? "split" : "unified";
  if (!splitAvailable) {
    return "unified";
  }
  return stored ?? defaultView;
}

export function storedDiffViewerView(value: unknown): DiffViewMode | undefined {
  return value === "split" || value === "unified" ? value : undefined;
}

export function findDiffFileIndex(files: DiffFileEntry[], selectedFile: string | undefined): number {
  if (!selectedFile || files.length === 0) {
    return 0;
  }
  const normalized = normalizePath(selectedFile);
  const exact = files.findIndex(
    (file) => normalizePath(file.path) === normalized || normalizePath(file.oldPath) === normalized,
  );
  if (exact !== -1) {
    return exact;
  }
  const suffix = files.findIndex(
    (file) => normalizePath(file.path).endsWith(normalized) || normalized.endsWith(normalizePath(file.path)),
  );
  return suffix !== -1 ? suffix : 0;
}

function toSourceOption(data: Record<string, unknown> | undefined, fallbackId: string): DiffSourceOption | undefined {
  const diff = getString(data, "diff");
  if (!diff?.trim()) {
    return undefined;
  }

  const source = getString(data, "source");
  const args = getString(data, "args");
  const tool = getString(data, "tool");
  const callId = getString(data, "callId");
  const filename = getString(data, "filename");
  const selectedFile = getString(data, "selectedFile") ?? filename;
  const label = getString(data, "label") ?? getDiffSourceLabel(data);

  return {
    diff,
    id: getString(data, "id") ?? fallbackId,
    label,
    ...(filename ? { filename } : {}),
    ...(selectedFile ? { selectedFile } : {}),
    ...(source ? { source } : {}),
    ...(args ? { args } : {}),
    ...(tool ? { tool } : {}),
    ...(callId ? { callId } : {}),
  };
}

function getString(data: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = data?.[key];
  return typeof value === "string" ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

interface DiffTreeNode {
  kind: "folder" | "file";
  path: string;
  name: string;
  children: Map<string, DiffTreeNode>;
  fileIndex?: number;
  additions?: number;
  deletions?: number;
  status?: DiffFileStatus;
}

function createTreeFolder(path: string, name: string): DiffTreeNode {
  return { children: new Map(), kind: "folder", name, path };
}

function createTreeFile(path: string, name: string, fileIndex: number, file: DiffFileEntry): DiffTreeNode {
  return {
    additions: file.additions,
    children: new Map(),
    deletions: file.deletions,
    fileIndex,
    kind: "file",
    name,
    path,
    status: file.status,
  };
}

function flattenTreeRows(node: DiffTreeNode, expanded: Set<string>, depth: number): DiffTreeRow[] {
  const rows: DiffTreeRow[] = [];
  if (node.path) {
    rows.push({
      depth,
      kind: node.kind,
      name: node.name,
      path: node.path,
      ...(node.kind === "folder" ? { expanded: expanded.has(node.path) } : {}),
      ...(typeof node.fileIndex === "number" ? { fileIndex: node.fileIndex } : {}),
      ...(typeof node.additions === "number" ? { additions: node.additions } : {}),
      ...(typeof node.deletions === "number" ? { deletions: node.deletions } : {}),
      ...(node.status ? { status: node.status } : {}),
    });
  }

  if (node.kind === "file") {
    return rows;
  }
  if (node.path && !expanded.has(node.path)) {
    return rows;
  }

  const children = [...node.children.values()].toSorted((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === "folder" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
  for (const child of children) {
    rows.push(...flattenTreeRows(child, expanded, depth + 1));
  }
  return rows;
}

function normalizePath(path: string | undefined): string {
  return (path ?? "").replace(/^a\//, "").replace(/^b\//, "");
}

export function formatDiffTreeRowStatus(row: DiffTreeRow, reviewed: boolean): string {
  if (row.kind !== "file") {
    return "";
  }
  const marker = row.status === "added" ? "A" : row.status === "deleted" ? "D" : row.status === "modified" ? "M" : "?";
  return `${reviewed ? asciiCheck : " "}${marker}`.padStart(2);
}

export function formatDiffTreeRowPrefix(rows: DiffTreeRow[], index: number): string {
  const row = rows[index];
  if (!row) {
    return "";
  }
  const indentation = Array.from({ length: row.depth }, (_, depth) => {
    if (depth === 0 && !hasLaterSibling(rows, 0, 0)) {
      return " ";
    }
    return hasLaterSibling(rows, index, depth) ? "│  " : "   ";
  }).join("");
  const topRoot = index === 0 && row.depth === 0;
  const branch = topRoot ? " " : hasLaterSibling(rows, index, row.depth) ? "├─ " : "└─ ";
  const marker = row.kind === "folder" ? (row.expanded ? "▾ " : "▸ ") : "";
  return `${indentation}${branch}${marker}`;
}

function hasLaterSibling(rows: DiffTreeRow[], index: number, depth: number): boolean {
  return rows.slice(index + 1).find((row) => row.depth <= depth)?.depth === depth;
}

import { asciiCheck } from "@/core/icons/icon";
