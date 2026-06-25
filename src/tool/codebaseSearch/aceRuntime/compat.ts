/**
 * Compatibility facade for the legacy ACE search helpers.
 *
 * Canonical ACE code now lives under @tool/codebaseSearch/aceRuntime. This module
 * keeps the old helper shapes available without leaving runtime callers tied
 * to the legacy aceSearch.ts implementation file.
 */
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { createLogger } from "@/core/logging/logger";
import { sshConnectionPool } from "@/server/ssh/client";
import { getCodebaseSearchErrorMessage } from "@/tool/codebaseSearch/errors";
import { escapeRegex } from "@/tool/shared";
import { LANGUAGE_CONFIG, detectLanguage as detectLanguageKey } from "./language";
import { parseFileSymbols as parseFileSymbolsFromContent } from "./symbol";

const log = createLogger("tool:ace-compat");

/** @internal 兼容层内部使用的代码符号类型（无外部消费者） */
interface LegacyCodeSymbol {
  name: string;
  kind: string;
  file: string;
  line: number;
  endLine?: number;
  language: string;
  signature?: string;
  parent?: string;
}

/** @internal 兼容层内部使用的路径搜索结果类型（无外部消费者） */
interface PathSearchResult {
  path: string;
  score: number;
  segments: string[];
}

/** @internal 兼容层内部使用的远程搜索结果类型（无外部消费者） */
interface RemoteSearchResult {
  file: string;
  line: number;
  text: string;
  type: "symbol" | "reference" | "text";
}

const LANGUAGE_LABELS: Record<string, string> = {
  c: "C",
  cpp: "C++",
  csharp: "C#",
  css: "CSS",
  go: "Go",
  java: "Java",
  javascript: "JavaScript",
  php: "PHP",
  python: "Python",
  ruby: "Ruby",
  rust: "Rust",
  sql: "SQL",
  swift: "Swift",
  typescript: "TypeScript",
};

function normalizeLanguageKey(language: string): string {
  const lower = language.toLowerCase();
  if (lower === "typeScript".toLowerCase()) {
    return "typescript";
  }
  if (lower === "javaScript".toLowerCase()) {
    return "javascript";
  }
  if (lower === "c#") {
    return "csharp";
  }
  if (lower === "c++") {
    return "cpp";
  }
  return lower;
}

/** 根据文件扩展名检测编程语言的显示名称 */
export function detectLanguage(filePath: string): string {
  const key = detectLanguageKey(filePath);
  if (!key) {
    return "Unknown";
  }
  return LANGUAGE_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

/** 根据语言配置生成符号名的正则匹配模式列表 */
export function getSymbolPatterns(language: string, symbolName: string): RegExp[] {
  const key = normalizeLanguageKey(language);
  const config = LANGUAGE_CONFIG[key];
  if (!config) {
    return [new RegExp(`\\b${escapeRegex(symbolName)}\\b`)];
  }

  return Object.values(config.symbolPatterns).map((pattern) => {
    const source = pattern.source.replace(/\((\w+)\)/, `(?:${escapeRegex(symbolName)})`);
    return new RegExp(source, pattern.flags);
  });
}

/** 解析文件的代码符号（函数、类、变量等），返回结构化符号列表 */
export async function parseFileSymbols(filePath: string): Promise<LegacyCodeSymbol[]> {
  try {
    const content = readFileSync(filePath, "utf8");
    const symbols = await parseFileSymbolsFromContent(filePath, content, dirname(filePath));
    return symbols.map((symbol) => ({
      endLine: symbol.endLine,
      file: symbol.filePath,
      kind: symbol.type,
      language: detectLanguage(filePath),
      line: symbol.line,
      name: symbol.name,
      parent: symbol.scope,
      signature: symbol.signature,
    }));
  } catch (error) {
    log.debug("legacy ACE file symbol parse failed, returning empty symbols", {
      error: getCodebaseSearchErrorMessage(error),
      file: filePath,
    });
    return [];
  }
}

/** 模糊路径搜索，按路径片段匹配度评分并返回排序结果 */
export function fuzzyPathSearch(query: string, paths: string[], maxResults = 50): PathSearchResult[] {
  const lowerQuery = query.toLowerCase();
  const results: PathSearchResult[] = [];

  for (const path of paths) {
    const lowerPath = path.toLowerCase();
    const score = computePathScore(lowerQuery, lowerPath);
    if (score > 0) {
      results.push({ path, score, segments: path.split("/") });
    }
  }

  return results.toSorted((a, b) => b.score - a.score).slice(0, maxResults);
}

/** 通过 SSH 在远程主机上执行代码搜索（符号/引用/文本模式） */
export async function remoteSearch(
  sshConfig: { host: string; port?: number; username?: string; privateKey?: string },
  query: string,
  remotePath: string,
  mode: "symbols" | "references" | "text" = "text",
  maxResults = 50,
): Promise<RemoteSearchResult[]> {
  const conn = await sshConnectionPool.getConnection({
    host: sshConfig.host,
    port: sshConfig.port ?? 22,
    privateKey: sshConfig.privateKey,
    username: sshConfig.username ?? "root",
  });

  let command: string;
  switch (mode) {
    case "symbols": {
      const symbolPatterns = [
        `function\\s+${escapeRegex(query)}`,
        `class\\s+${escapeRegex(query)}`,
        `interface\\s+${escapeRegex(query)}`,
        `(?:const|let|var)\\s+${escapeRegex(query)}`,
        `def\\s+${escapeRegex(query)}`,
      ].join("|");
      command = `grep -rn -E '${symbolPatterns}' '${remotePath}' | head -${maxResults}`;
      break;
    }
    case "references": {
      command = `grep -rn -w '${escapeRegex(query)}' '${remotePath}' | head -${maxResults}`;
      break;
    }
    case "text":
    default: {
      command = `grep -rn '${escapeRegex(query)}' '${remotePath}' | head -${maxResults}`;
      break;
    }
  }

  const stdout = await new Promise<string>((resolve, reject) => {
    conn.client.exec(command, (err: Error | undefined, stream: any) => {
      if (err) {
        reject(err);
        return;
      }
      let output = "";
      stream.on("data", (data: Buffer) => {
        output += data.toString();
      });
      stream.on("close", () => {
        resolve(output);
      });
      stream.stderr.on("data", (data: Buffer) => {
        output += data.toString();
      });
    });
  });
  if (!stdout) {
    return [];
  }

  return parseRemoteGrepOutput(stdout, mode === "symbols" ? "symbol" : mode === "references" ? "reference" : "text");
}

function computePathScore(query: string, path: string): number {
  if (path.includes(query)) {
    const fileName = path.split("/").pop() ?? "";
    if (fileName.includes(query)) {
      return 100;
    }
    return 80;
  }

  let score = 0;
  let queryIdx = 0;
  let lastMatchIdx = -1;
  for (let i = 0; i < path.length && queryIdx < query.length; i++) {
    if (path[i] === query[queryIdx]) {
      if (i === 0 || path[i - 1] === "/" || path[i - 1] === ".") {
        score += 10;
      }
      if (lastMatchIdx >= 0 && i === lastMatchIdx + 1) {
        score += 5;
      }
      score += 1;
      lastMatchIdx = i;
      queryIdx++;
    }
  }

  return queryIdx === query.length ? score : 0;
}

function parseRemoteGrepOutput(output: string, type: "symbol" | "reference" | "text"): RemoteSearchResult[] {
  const results: RemoteSearchResult[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const match = line.match(/^(.+?)[:-](\d+)[:-](.*)$/);
    if (!match) {
      continue;
    }
    results.push({
      file: match[1]!,
      line: parseInt(match[2]!, 10),
      text: match[3]!,
      type,
    });
  }
  return results;
}
