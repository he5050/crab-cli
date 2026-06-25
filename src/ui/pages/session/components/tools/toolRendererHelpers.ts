/**
 * OpenCode 工具渲染辅助 — 通用 SyntaxStyle 构造与输出截断常量。
 *
 * 职责:
 *   - 提供工具块边框/截断/语法高亮样式
 *   - 为各工具渲染器共享通用渲染常量
 */
import type { ToolPart } from "@/ui/contexts/chat";
import type { ThemeColors } from "@/ui/contexts/theme";
import { generateToolSyntaxStyle } from "@/ui/themes/syntaxGenerator";

export type RecordValue = Record<string, unknown>;

export const BLOCK_MAX_OUTPUT_LINES = 10;
export const GENERIC_MAX_OUTPUT_LINES = 3;

export const LeftBorder = {
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

export function createToolSyntaxStyle(colors: ThemeColors) {
  return generateToolSyntaxStyle(colors);
}

export function isRunning(part: ToolPart): boolean {
  return part.status === "running" || part.status === "calling";
}

export function failed(part: ToolPart): boolean {
  return part.status === "error" || part.success === false;
}

export function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function objectValue(value: unknown): RecordValue | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : undefined;
}

export function primaryInput(input: RecordValue, keys: string[]): string | undefined {
  return keys.map((key) => textValue(input[key])).find(Boolean);
}

export function pathInput(input: RecordValue): string | undefined {
  return primaryInput(input, ["filePath", "file_path", "path", "relativePath"]);
}

export function commandInput(input: RecordValue): string | undefined {
  return primaryInput(input, ["command", "cmd"]);
}

export function formatInput(input: RecordValue, skip: string[] = []): string {
  const skipped = new Set(skip);
  return Object.entries(input)
    .filter(([key]) => !skipped.has(key))
    .flatMap(([key, value]) => {
      if (typeof value === "string") {
        return [`${key}=${value.slice(0, 64)}`];
      }
      if (typeof value === "number" || typeof value === "boolean") {
        return [`${key}=${value}`];
      }
      return [];
    })
    .slice(0, 3)
    .join(" ");
}

export function filetypeFromPath(filePath: string | undefined): string | undefined {
  const ext = filePath?.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    bash: "bash",
    c: "c",
    cpp: "cpp",
    css: "css",
    go: "go",
    h: "c",
    html: "html",
    java: "java",
    js: "javascript",
    json: "json",
    jsx: "javascript",
    md: "markdown",
    py: "python",
    rb: "ruby",
    rs: "rust",
    scss: "scss",
    sh: "bash",
    sql: "sql",
    swift: "swift",
    toml: "toml",
    ts: "typescript",
    tsx: "typescript",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
    zig: "zig",
  };
  return ext ? map[ext] : undefined;
}

export function collapseToolOutput(output: string, maxLines: number, maxChars = maxLines * 96) {
  const lines = output.split("\n");
  if (lines.length <= maxLines && [...output].length <= maxChars) {
    return { output, overflow: false };
  }
  const preview = lines.slice(0, maxLines).join("\n");
  if ([...preview].length > maxChars) {
    return {
      output: `${[...preview].slice(0, Math.max(0, maxChars - 1)).join("")}…`,
      overflow: true,
    };
  }
  return { output: [...lines.slice(0, maxLines), "…"].join("\n"), overflow: true };
}

export function copyToClip(text: string, label = "已复制", eventBus?: import("@bus").EventBus): void {
  import("@/ui/utils/clipboard")
    .then(({ copyWithToast }) => copyWithToast(text, label, eventBus))
    .catch(() => {
      /* 剪贴板操作失败不影响主流程 */
    });
}

export function blockBorderColor(part: ToolPart, colors: ThemeColors): string {
  if (failed(part)) {
    return colors.error;
  }
  if (isRunning(part)) {
    return colors.warning;
  }
  return colors.background ?? colors.border;
}

export function inlineColor(part: ToolPart, colors: ThemeColors): string {
  if (failed(part)) {
    return colors.error;
  }
  if (isRunning(part)) {
    return colors.text;
  }
  return colors.muted;
}
