/**
 * 代码库 TODO 扫描器 — 扫描项目中的 TODO/FIXME/HACK/XXX/BUG 注释
 *
 *
 * 支持单行注释、块注释、HTML注释、@todo注解等 TODO/FIXME/HACK/XXX/BUG 匹配
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

// ─── 类型 ──────────────────────────────────────────────────

export interface TodoItem {
  id: string; // "relativePath:lineNumber"
  file: string; // relative path from project root
  line: number; // 1-based line number
  content: string; // matched TODO content text
  fullLine: string; // the trimmed original line
}

// ─── 常量 ──────────────────────────────────────────────────

const IGNORE_PATTERNS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  ".output",
  "out",
  ".DS_Store",
  "*.log",
  "*.lock",
];

const SCANNABLE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".cs",
  ".php",
  ".rb",
  ".swift",
  ".kt",
  ".scala",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".vim",
  ".lua",
  ".sql",
  ".html",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".vue",
  ".svelte",
  ".md",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".xml",
]);

const TODO_PATTERNS: RegExp[] = [
  // 单行 // 注释
  /\/\/\s*(TODO|FIXME|HACK|XXX|BUG)\b\s*(.*)/i,
  // 块注释 (单行内)
  /\/\*\s*(TODO|FIXME|HACK|XXX|BUG)\b\s*(.*?)\s*\*\//i,
  // # 注释 (Python/Ruby/Shell)
  /#\s*(TODO|FIXME|HACK|XXX|BUG)\b\s*(.*)/i,
  // HTML 注释
  /<!--\s*(TODO|FIXME|HACK|XXX|BUG)\b\s*(.*?)\s*-->/i,
  // @todo 注解 (JSDoc/PHPDoc)
  /@\s*todo\b\s*(.*)/i,
  // TODO 带括号
  /(?:TODO|FIXME|HACK|XXX|BUG)\s*\(([^)]*)\)/i,
  // 多行块注释
  /\*\s*(TODO|FIXME|HACK|XXX|BUG)\b\s*:\s*(.*)/i,
];

// ─── 内部函数 ──────────────────────────────────────────────

function shouldIgnore(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  for (const pattern of IGNORE_PATTERNS) {
    if (pattern.includes("*")) {
      if (normalized.endsWith(pattern.replace("*", ""))) return true;
    } else if (normalized.includes(`/${pattern}/`) || normalized === pattern) {
      return true;
    }
  }
  return false;
}

function isScannableFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  // 扫描有扩展名且在白名单中的文件，或无扩展名的文件
  return ext === "" || SCANNABLE_EXTENSIONS.has(ext);
}

function scanFileForTodos(filePath: string, rootDir: string): TodoItem[] {
  if (!existsSync(filePath)) return [];

  try {
    const content = readFileSync(filePath, "utf-8");
    const relPath = relative(rootDir, filePath);
    const lines = content.split("\n");
    const items: TodoItem[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const trimmed = line.trim();
      if (!trimmed) continue;

      for (const pattern of TODO_PATTERNS) {
        const match = trimmed.match(pattern);
        if (match) {
          const tag = match[1] || "";
          const detail = (match[2] || "").trim();
          items.push({
            id: `${relPath}:${i + 1}`,
            file: relPath,
            line: i + 1,
            content: `[${tag}]${detail ? " " + detail : ""}`,
            fullLine: trimmed,
          });
          break; // 每行只匹配一次
        }
      }
    }

    return items;
  } catch {
    return [];
  }
}

function scanDirectory(dir: string, rootDir: string): TodoItem[] {
  if (!existsSync(dir)) return [];

  const items: TodoItem[] = [];
  let entries: string[];

  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);

    // 跳过忽略项
    if (shouldIgnore(entry)) continue;

    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      items.push(...scanDirectory(fullPath, rootDir));
    } else if (stat.isFile() && isScannableFile(entry)) {
      items.push(...scanFileForTodos(fullPath, rootDir));
    }
  }

  return items;
}

// ─── 公开 API ──────────────────────────────────────────────

/** 扫描项目目录中的所有 TODO/FIXME/HACK/XXX/BUG 注释 */
export function scanProjectTodos(projectRoot: string = process.cwd()): TodoItem[] {
  return scanDirectory(projectRoot, projectRoot);
}
