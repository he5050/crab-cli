/**
 * 工具渲染规范模块 — 定义工具在UI中的渲染规范和行为配置
 *
 * 职责:
 *   - 定义工具渲染的类型系统(组别、变体、状态)
 *   - 配置工具的显示属性(图标、文字、交互行为)
 *   - 提供工具数据解析和渲染决策函数
 *
 * 模块功能:
 *   - ToolRenderGroup: 工具分组类型
 *   - ToolRenderVariant: 工具渲染变体类型
 *   - ToolRenderStatus: 工具执行状态类型
 *   - ToolRenderSpec: 工具渲染配置接口
 *   - TOOL_SPECS: 预定义工具渲染配置列表
 *   - GENERIC_SPEC: 通用工具的默认渲染配置
 *   - getToolFiles: 提取工具的文件元数据
 *   - getToolDiagnostics: 提取工具的诊断信息
 *   - getToolDiff: 提取工具的差异对比数据
 *   - hasToolStructuredBody: 检查工具是否有结构化内容
 *   - resolveToolRenderer: 根据工具名称和参数解析渲染配置
 *   - getToolInput: 解析工具输入参数
 *   - getToolTitle: 生成工具标题
 *   - getToolSubtitle: 生成工具副标题
 *   - getToolPreview: 生成工具预览内容
 *
 * 使用场景:
 *   - 会话页面中工具调用的渲染
 *   - 工具列表的展示和交互
 *   - 工具输出的格式化显示
 *
 * 边界:
 * 1. 只处理 ToolPart 类型的数据结构
 * 2. 不涉及工具的实际执行逻辑
 * 3. 渲染配置基于预定义的 TOOL_SPECS 映射表
 *
 * 流程:
 * 1. 暂无(这是纯工具函数模块，无特定执行流程)
 */
import type { ToolPart } from "@/ui/contexts/chat";

export type ToolRenderGroup = "context" | "shell" | "edit" | "task" | "todo" | "question" | "web" | "generic";

export type ToolRenderVariant = "inline" | "block" | "hybrid";

export type ToolRenderStatus = "pending" | "calling" | "running" | "done" | "error";

export interface ToolRenderSpec {
  name: string;
  aliases: string[];
  group: ToolRenderGroup;
  variant: ToolRenderVariant;
  icon: string;
  pendingText: string;
  click: "toggle" | "navigate-child-session" | "open-error" | "open-panel" | "none";
  visibility: "always" | "hide-when-success-and-details-off" | "generic-output-toggle";
}

const TOOL_SPECS: ToolRenderSpec[] = [
  {
    aliases: ["read", "filesystem-read", "file-read", "cat"],
    click: "none",
    group: "context",
    icon: symArrowRight,
    name: "ReadTool",
    pendingText: "Reading file...",
    variant: "inline",
    visibility: "always",
  },
  {
    aliases: ["grep"],
    click: "none",
    group: "context",
    icon: symStar,
    name: "GrepTool",
    pendingText: "Searching content...",
    variant: "inline",
    visibility: "always",
  },
  {
    aliases: ["glob", "list", "readdir", "ls"],
    click: "none",
    group: "context",
    icon: symStar,
    name: "GlobTool",
    pendingText: "Finding files...",
    variant: "inline",
    visibility: "always",
  },
  {
    aliases: ["codebase-search", "ace-search", "ace_search", "search"],
    click: "toggle",
    group: "context",
    icon: symStar,
    name: "CodebaseSearchTool",
    pendingText: "Searching codebase...",
    variant: "hybrid",
    visibility: "generic-output-toggle",
  },
  {
    aliases: ["shell", "bash", "terminal-execute", "terminal", "exec", "run"],
    click: "toggle",
    group: "shell",
    icon: "$",
    name: "ShellTool",
    pendingText: "Writing command...",
    variant: "block",
    visibility: "generic-output-toggle",
  },
  {
    aliases: ["write", "filesystem-write", "create", "filesystem-create"],
    click: "toggle",
    group: "edit",
    icon: symArrowLeft,
    name: "WriteTool",
    pendingText: "Preparing write...",
    variant: "hybrid",
    visibility: "generic-output-toggle",
  },
  {
    aliases: ["edit", "filesystem-edit", "filesystem-replaceedit"],
    click: "none",
    group: "edit",
    icon: symArrowLeft,
    name: "EditTool",
    pendingText: "Preparing edit...",
    variant: "block",
    visibility: "always",
  },
  {
    aliases: ["multiedit", "multi-edit", "filesystem-multi-edit"],
    click: "none",
    group: "edit",
    icon: symArrowLeft,
    name: "MultiEditTool",
    pendingText: "Preparing edits...",
    variant: "block",
    visibility: "always",
  },
  {
    aliases: ["apply_patch", "apply-patch"],
    click: "none",
    group: "edit",
    icon: "%",
    name: "ApplyPatchTool",
    pendingText: "Preparing patch...",
    variant: "block",
    visibility: "always",
  },
  {
    aliases: ["todowrite", "todo-write", "todo-ultra"],
    click: "open-panel",
    group: "todo",
    icon: iconSettings,
    name: "TodoTool",
    pendingText: "Updating todos...",
    variant: "hybrid",
    visibility: "always",
  },
  {
    aliases: ["question", "askuser-ask-question", "ask-user", "ask_user"],
    click: "none",
    group: "question",
    icon: symArrowRight,
    name: "QuestionTool",
    pendingText: "Asking questions...",
    variant: "hybrid",
    visibility: "always",
  },
  {
    aliases: ["skill", "skills"],
    click: "none",
    group: "task",
    icon: symArrowRight,
    name: "SkillTool",
    pendingText: "Loading skill...",
    variant: "inline",
    visibility: "always",
  },
  {
    aliases: ["task", "subagent", "subtask"],
    click: "navigate-child-session",
    group: "task",
    icon: "│",
    name: "TaskTool",
    pendingText: "Delegating...",
    variant: "inline",
    visibility: "always",
  },
  {
    aliases: ["webfetch", "web-fetch"],
    click: "none",
    group: "web",
    icon: "%",
    name: "WebFetchTool",
    pendingText: "Fetching from web...",
    variant: "inline",
    visibility: "always",
  },
  {
    aliases: ["websearch", "web-search"],
    click: "none",
    group: "web",
    icon: "◈",
    name: "WebSearchTool",
    pendingText: "Searching web...",
    variant: "inline",
    visibility: "always",
  },
  {
    aliases: ["lsp", "ide-diagnostics", "ide-get_diagnostics"],
    click: "toggle",
    group: "generic",
    icon: asciiBulletGlyph,
    name: "LspTool",
    pendingText: "Checking diagnostics...",
    variant: "hybrid",
    visibility: "generic-output-toggle",
  },
  {
    aliases: ["git"],
    click: "toggle",
    group: "generic",
    icon: "#",
    name: "GitTool",
    pendingText: "Running git...",
    variant: "hybrid",
    visibility: "generic-output-toggle",
  },
];

const GENERIC_SPEC: ToolRenderSpec = {
  aliases: ["*"],
  click: "toggle",
  group: "generic",
  icon: iconSettings,
  name: "GenericTool",
  pendingText: "Writing command...",
  variant: "hybrid",
  visibility: "generic-output-toggle",
};

function parseInput(part: ToolPart): Record<string, unknown> {
  if (part.input && typeof part.input === "object" && !Array.isArray(part.input)) {
    return part.input as Record<string, unknown>;
  }
  if (!part.args) {
    return {};
  }
  try {
    const parsed = JSON.parse(part.args) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function hasFileMetadata(part: ToolPart): boolean {
  return (part.files?.length ?? 0) > 0 || Boolean(part.metadata?.["diff"] ?? part.metadata?.["patch"]);
}

function hasDiagnostics(part: ToolPart): boolean {
  return (part.diagnostics?.length ?? 0) > 0 || Array.isArray(part.metadata?.["diagnostics"]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function arrayFromMetadata(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function getToolFiles(part: ToolPart) {
  const metadataFiles = arrayFromMetadata(part.metadata?.["files"])
    .filter(isRecord)
    .map((file) => ({
      diff: typeof file["diff"] === "string" ? file["diff"] : undefined,
      kind: typeof file["kind"] === "string" ? file["kind"] : undefined,
      path: typeof file["path"] === "string" ? file["path"] : String(file["path"] ?? ""),
      status: typeof file["status"] === "string" ? file["status"] : undefined,
    }))
    .filter((file) => file.path.length > 0);
  return part.files && part.files.length > 0 ? part.files : metadataFiles;
}

export function getToolDiagnostics(part: ToolPart): unknown[] {
  const metadataDiagnostics = arrayFromMetadata(part.metadata?.["diagnostics"]);
  return part.diagnostics && part.diagnostics.length > 0 ? part.diagnostics : metadataDiagnostics;
}

export function getToolDiff(part: ToolPart): string | undefined {
  if (typeof part.metadata?.["diff"] === "string") {
    return part.metadata["diff"];
  }
  if (typeof part.metadata?.["patch"] === "string") {
    return part.metadata["patch"];
  }
  const fileDiff = getToolFiles(part)
    .map((file) => file.diff)
    .find((diff): diff is string => Boolean(diff));
  if (fileDiff) {
    return fileDiff;
  }
  if (!part.output) {
    return undefined;
  }
  const lines = part.output.split("\n");
  const idx = lines.findIndex((line) => line.startsWith("--- ") || line.startsWith("diff --git"));
  return idx !== -1 ? lines.slice(idx).join("\n") : undefined;
}

export function hasToolStructuredBody(part: ToolPart): boolean {
  return getToolFiles(part).length > 0 || getToolDiagnostics(part).length > 0 || Boolean(getToolDiff(part));
}

export function resolveToolRenderer(part: ToolPart): ToolRenderSpec {
  const name = part.tool.toLowerCase();
  const exact = TOOL_SPECS.find((spec) => spec.aliases.includes(name));
  if (exact) {
    return exact;
  }
  if (hasFileMetadata(part)) {
    return TOOL_SPECS.find((spec) => spec.name === "ApplyPatchTool") ?? GENERIC_SPEC;
  }
  if (hasDiagnostics(part)) {
    return TOOL_SPECS.find((spec) => spec.name === "LspTool") ?? GENERIC_SPEC;
  }
  return GENERIC_SPEC;
}

export function getToolInput(part: ToolPart): Record<string, unknown> {
  return parseInput(part);
}

export function getToolTitle(part: ToolPart, spec = resolveToolRenderer(part)): string {
  const input = parseInput(part);
  const primaryKeys = [
    "description",
    "query",
    "url",
    "filePath",
    "file_path",
    "path",
    "pattern",
    "name",
    "command",
    "cmd",
  ];
  const value = primaryKeys
    .map((key) => input[key])
    .find((item): item is string => typeof item === "string" && item.length > 0);
  if (spec.group === "task" && part.subSessionId) {
    return `${value ?? part.tool} · ${part.subSessionId}`;
  }
  return value ?? part.detail ?? part.tool;
}

export function getToolSubtitle(part: ToolPart): string | undefined {
  const input = parseInput(part);
  const skip = new Set([
    "description",
    "query",
    "url",
    "filePath",
    "file_path",
    "path",
    "pattern",
    "name",
    "command",
    "cmd",
  ]);
  const args = Object.entries(input)
    .filter(([key]) => !skip.has(key))
    .flatMap(([key, value]) => {
      if (typeof value === "string") {
        return [`${key}=${value.slice(0, 48)}`];
      }
      if (typeof value === "number" || typeof value === "boolean") {
        return [`${key}=${value}`];
      }
      return [];
    })
    .slice(0, 3);
  const duration = part.durationMs !== undefined ? `${part.durationMs}ms` : undefined;
  return [...args, duration].filter(Boolean).join(" ") || undefined;
}

export function getToolPreview(part: ToolPart): string | undefined {
  if (typeof part.metadata?.["summary"] === "string") {
    return part.metadata["summary"];
  }
  const files = getToolFiles(part);
  if (files.length > 0) {
    return files
      .slice(0, 3)
      .map((file) => file.path)
      .join(", ");
  }
  const diagnostics = getToolDiagnostics(part);
  if (diagnostics.length > 0) {
    return `${diagnostics.length} diagnostics`;
  }
  const diff = getToolDiff(part);
  if (diff) {
    return diff.split("\n").slice(0, 4).join("\n");
  }
  if (part.output) {
    return part.output.split("\n").slice(0, 8).join("\n");
  }
  return undefined;
}

import { iconSettings, symArrowLeft, symArrowRight, symStar } from "@/core/icons/icon";
import { asciiBulletGlyph } from "@/core/icons/iconDerived";
