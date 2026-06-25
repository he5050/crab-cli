/**
 * LSP 处理函数辅助 — JS 回退搜索、符号提取、输出解析等内部工具函数。
 */
import { escapeRegex } from "@/tool/shared";
import fs from "node:fs";
import path from "node:path";

/** LSP 操作结果 */
export interface LspResult {
  file: string;
  line: number;
  column?: number;
  text: string;
  kind?: string;
}

// ── 工具函数 ──────────────────────────────────────────────────────

/** 将 LSP URI (file://) 转换为本地文件路径 */
export function uriToPath(uri: string): string {
  return uri.replace(/^file:\/\//, "");
}

/** 递归展平 LSP 符号树为一维数组 */
export function flattenSymbols(
  symbols: {
    name: string;
    kind: string;
    location: { uri: string; range: { start: { line: number; character: number } } };
    children?: unknown[];
  }[],
): { name: string; kind: string; line: number }[] {
  const result: { name: string; kind: string; line: number }[] = [];
  for (const s of symbols) {
    result.push({ kind: s.kind, line: s.location.range.start.line + 1, name: s.name });
    if (s.children && Array.isArray(s.children)) {
      result.push(...flattenSymbols(s.children as typeof symbols));
    }
  }
  return result;
}

/** 解析 ripgrep 输出为 LspResult 数组 */
export function parseRgOutput(output: string): LspResult[] {
  const results: LspResult[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const match = line.match(/^(.+?)[:-](\d+)[:-](.*)$/);
    if (match) {
      results.push({ file: match[1]!, line: parseInt(match[2]!, 10), text: match[3]!.trim() });
    }
  }
  return results;
}

/** 在指定行和列位置提取完整的符号名称 */
export function extractSymbolAtPosition(filePath: string, line?: number, column?: number): string | null {
  if (!line || !column) {
    return null;
  }
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const targetLine = content.split("\n")[line - 1];
    if (!targetLine) {
      return null;
    }
    let start = column - 1;
    let end = column - 1;
    while (start > 0 && /\w/.test(targetLine[start - 1]!)) {
      start--;
    }
    while (end < targetLine.length && /\w/.test(targetLine[end]!)) {
      end++;
    }
    return targetLine.slice(start, end) || null;
  } catch {
    return null;
  }
}

/** 从文件内容中通过正则提取顶层符号（函数、类、接口等） */
export function extractSymbols(content: string, filePath: string): { name: string; kind: string; line: number }[] {
  const symbols: { name: string; kind: string; line: number }[] = [];
  const ext = path.extname(filePath);
  if ([".ts", ".tsx", ".js", ".jsx"].includes(ext)) {
    const patterns = [
      { kind: "function", re: /export\s+(?:default\s+)?function\s+(\w+)/g },
      { kind: "class", re: /(?:export\s+)?(?:default\s+)?class\s+(\w+)/g },
      { kind: "interface", re: /(?:export\s+)?interface\s+(\w+)/g },
      { kind: "type", re: /(?:export\s+)?type\s+(\w+)\s*=/g },
      { kind: "enum", re: /(?:export\s+)?enum\s+(\w+)/g },
      { kind: "variable", re: /(?:export\s+)?const\s+(\w+)/g },
    ];
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      for (const { re, kind } of patterns) {
        re.lastIndex = 0;
        const match = re.exec(line);
        if (match) {
          symbols.push({ kind, line: i + 1, name: match[1]! });
        }
      }
    }
  }
  return symbols;
}

/** 纯 JS 搜索定义(rg 不可用时的回退) */
export function jsSearchDefinition(symbol: string, searchDir: string): LspResult[] {
  const results: LspResult[] = [];
  const escaped = escapeRegex(symbol);
  const patterns = [
    new RegExp(`function\\s+${escaped}`, "g"),
    new RegExp(`(?:export\\s+)?(?:default\\s+)?(?:class|interface|type|enum)\\s+${escaped}`, "g"),
    new RegExp(`(?:export\\s+)?(?:const|let|var)\\s+${escaped}\\s*[=:]`, "g"),
  ];
  const combined = new RegExp(patterns.map((p) => `(${p.source})`).join("|"), "g");

  try {
    const glob = new Bun.Glob("**/*.{ts,tsx,js,jsx}");
    for (const filePath of glob.scanSync({ cwd: searchDir, dot: false })) {
      if (results.length >= 20) {
        break;
      }
      if (filePath.includes("node_modules") || filePath.includes(".git") || filePath.endsWith(".d.ts")) {
        continue;
      }
      try {
        const content = fs.readFileSync(path.resolve(searchDir, filePath), "utf8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length && results.length < 20; i++) {
          combined.lastIndex = 0;
          if (combined.test(lines[i]!)) {
            results.push({ file: filePath, line: i + 1, text: lines[i]!.trim() });
          }
        }
      } catch {
        /* Skip unreadable files */
      }
    }
  } catch {
    /* Glob scan failed */
  }
  return results;
}

/** 纯 JS 搜索引用(rg 不可用时的回退) */
export function jsSearchReferences(symbol: string, searchDir: string): LspResult[] {
  const results: LspResult[] = [];
  const wordRegex = new RegExp(`\\b${escapeRegex(symbol)}\\b`, "g");

  try {
    const glob = new Bun.Glob("**/*.{ts,tsx,js,jsx}");
    for (const filePath of glob.scanSync({ cwd: searchDir, dot: false })) {
      if (results.length >= 50) {
        break;
      }
      if (filePath.includes("node_modules") || filePath.includes(".git")) {
        continue;
      }
      try {
        const content = fs.readFileSync(path.resolve(searchDir, filePath), "utf8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length && results.length < 50; i++) {
          wordRegex.lastIndex = 0;
          if (wordRegex.test(lines[i]!)) {
            results.push({ file: filePath, line: i + 1, text: lines[i]!.trim() });
          }
        }
      } catch {
        /* Skip unreadable files */
      }
    }
  } catch {
    /* Glob scan failed */
  }
  return results;
}
