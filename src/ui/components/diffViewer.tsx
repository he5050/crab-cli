/**
 * DiffViewer 组件
 *
 * 职责:
 *   - 提供代码差异查看功能，基于 OpenTUI 原生 <diff> 组件
 *   - 支持 unified 和 split 两种视图模式
 *
 * 模块功能:
 *   - 支持 unified diff 字符串直接渲染
 *   - 支持 old/new content 对比生成 diff
 *   - 自动推断文件类型进行语法高亮
 *   - 主题色映射(添加/删除/上下文行颜色)
 *   - 显示行号、文件名标题
 *
 * 使用场景:
 *   - 查看代码变更差异时
 *   - 审查代码修改时
 *   - 显示文件对比结果时
 *
 * 边界:
 *   1. 优先使用传入的 unified diff 字符串
 *   2. 支持 20+ 种编程语言的高亮
 *   3. 默认使用 unified 视图，可选 split 视图
 *   4. 行号默认显示，可通过 props 控制
 *
 * 流程:
 *   1. 接收 diff 字符串或 old/new content
 *   2. 如需要，从 old/new content 生成 unified diff
 *   3. 根据文件名推断语言类型
 *   4. 映射主题色到 diff 组件
 *   5. 渲染 OpenTUI <diff> 组件
 */

import { Show, createMemo } from "solid-js";
import { useTheme } from "@/ui/contexts/theme";

// ─── Props 类型 ──────────────────────────────────────────────

export interface DiffViewerProps {
  /** Unified diff 格式字符串(优先使用) */
  diff?: string;
  /** 旧内容(当无 unified diff 时使用) */
  oldContent?: string;
  /** 新内容 */
  newContent?: string;
  /** 文件名(用于推断语言和显示标题) */
  filename?: string;
  /** 完整旧内容(用于 diff 生成) */
  completeOldContent?: string;
  /** 完整新内容(用于 diff 生成) */
  completeNewContent?: string;
  /** 起始行号 */
  startLineNumber?: number;
  /** 视图模式:unified 或 split */
  view?: "unified" | "split";
  /** 是否显示行号 */
  showLineNumbers?: boolean;
}

// ─── 文件扩展名 → 语言 ──────────────────────────────────────

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  bash: "bash",
  cjs: "javascript",
  css: "css",
  go: "go",
  html: "html",
  java: "java",
  js: "javascript",
  json: "json",
  jsx: "javascript",
  kt: "kotlin",
  less: "less",
  md: "markdown",
  mjs: "javascript",
  php: "php",
  py: "python",
  rb: "ruby",
  rs: "rust",
  scss: "scss",
  sh: "bash",
  sql: "sql",
  swift: "swift",
  ts: "typescript",
  tsx: "typescript",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
};

function inferFiletype(filename?: string): string | undefined {
  if (!filename) {
    return undefined;
  }
  const normalized = filename.split(/[?#]/)[0] ?? filename;
  const ext = normalized.split(".").pop()?.toLowerCase();
  if (!ext || ext === normalized.toLowerCase()) {
    return undefined;
  }
  return LANGUAGE_BY_EXTENSION[ext] ?? ext;
}

// ─── 生成 unified diff 字符串 ────────────────────────────────

/**
 * 从 old/new content 生成简单的 unified diff 格式字符串。
 * 如果外部已提供 unified diff 字符串，则直接使用。
 *
 * OpenTUI <diff> 组件接受 unified diff 格式，所以我们尽量
 * 直接传入 diff string。如果只有 old/new content，则生成
 * 一个简单的 line-level diff。
 */
function generateUnifiedDiff(oldContent: string, newContent: string, filename?: string): string {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const lines: string[] = [];

  // Diff header
  if (filename) {
    lines.push(`--- a/${filename}`);
    lines.push(`+++ b/${filename}`);
  }
  lines.push(`@@ -1,${oldLines.length} +1,${newLines.length} @@`);

  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];

    if (i >= oldLines.length) {
      // 新增行
      lines.push(`+${newLine}`);
    } else if (i >= newLines.length) {
      // 删除行
      lines.push(`-${oldLine}`);
    } else if (oldLine !== newLine) {
      // 修改行
      lines.push(`-${oldLine}`);
      lines.push(`+${newLine}`);
    } else {
      // 未变行
      lines.push(` ${oldLine}`);
    }
  }

  return lines.join("\n");
}

// ─── DiffViewer 组件 ──────────────────────────────────────

export function DiffViewer(props: DiffViewerProps) {
  const theme = useTheme();

  const filetype = createMemo(() => inferFiletype(props.filename));

  // 准备 diff 字符串
  const diffString = createMemo(() => {
    // 优先使用已有的 unified diff
    if (props.diff) {
      return props.diff;
    }

    // 从 old/new content 生成
    const oldC = props.completeOldContent ?? props.oldContent ?? "";
    const newC = props.completeNewContent ?? props.newContent ?? "";
    if (!oldC && !newC) {
      return "";
    }

    return generateUnifiedDiff(oldC, newC, props.filename);
  });

  // 主题色映射
  const colors = createMemo(() => {
    const c = theme.colors;
    return {
      addedBg: c.success,
      addedSignColor: c.success,
      contextBg: c.background,
      lineNumberFg: c.muted,
      removedBg: c.error,
      removedSignColor: c.error,
    };
  });

  return (
    <Show when={diffString().length > 0}>
      <box flexDirection="column">
        {/* 文件名标题 */}
        <Show when={props.filename}>
          <box paddingBottom={1}>
            <text>
              <span style={{ bold: true, fg: theme.colors.info }}>{props.filename}</span>
              <Show when={props.view === "split"}>
                <span style={{ fg: theme.colors.muted }}>{" (split view)"}</span>
              </Show>
            </text>
          </box>
        </Show>

        {/* OpenTUI 原生 diff 组件 */}
        <diff
          diff={diffString()}
          view={props.view ?? "unified"}
          filetype={filetype()}
          showLineNumbers={props.showLineNumbers ?? true}
          addedBg={colors().addedBg}
          removedBg={colors().removedBg}
          addedSignColor={colors().addedSignColor}
          removedSignColor={colors().removedSignColor}
          lineNumberFg={colors().lineNumberFg}
          conceal={true}
          wrapMode="word"
        />
      </box>
    </Show>
  );
}
