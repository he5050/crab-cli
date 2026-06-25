/**
 * ACE Code Search 搜索工具 — 搜索相关的工具函数集
 *
 * 职责:
 *   - 提供命令可用性检测
 *   - grep 输出解析和 glob 模式转换
 *   - 模糊匹配评分和 ReDoS 防护
 *   - 并发处理和按时效排序
 *
 * 模块功能:
 *   - isCommandAvailable: 检测命令是否在系统 PATH 中可用
 *   - parseGrepOutput: 解析 grep 输出(格式: filePath:lineNumber:lineContent)
 *   - globToRegex: glob 模式转正则表达式
 *   - globPatternToRegex: 将 glob 模式转换为匹配完整路径的正则
 *   - expandGlobBraces: 展开花括号 glob 模式
 *   - calculateFuzzyScore: 计算符号名的模糊匹配分数(0-100)
 *   - calculateRegexComplexity: 计算正则表达式复杂度分数(ReDoS 防护)
 *   - isSafeRegexPattern: 检查正则表达式模式是否安全
 *   - processWithConcurrency: 限制并发度的处理器
 *   - createTimeoutPromise: 创建超时 Promise
 *   - sortResultsByRecency: 按文件修改时间排序搜索结果
 *
 * 使用场景:
 *   - ACE 代码搜索服务中的文本搜索
 *   - grep 输出的标准化解析
 *   - 文件模式匹配和过滤
 *   - 搜索结果的智能排序
 *
 * 边界:
 * 1. glob 模式支持: *, **, ?, [abc], {js,ts}
 * 2. ReDoS 防护限制正则复杂度分数不超过 100
 * 3. 并发处理默认限制为 10，防止 EMFILE 错误
 * 4. 最近文件阈值默认为 24 小时
 *
 * 流程:
 * 1. 检测系统命令可用性
 * 2. 解析 grep 输出为结构化结果
 * 3. 转换 glob 模式为正则表达式
 * 4. 计算模糊匹配分数
 * 5. 检查正则安全性
 * 6. 并发处理大量文件
 * 7. 按修改时间排序结果
 */

import { spawn } from "node:child_process";
import { EOL } from "node:os";
import * as path from "node:path";
import { createLogger } from "@/core/logging/logger";
import { getCodebaseSearchErrorMessage } from "@/tool/codebaseSearch/errors";
import type { TextSearchResult } from "./types";

const log = createLogger("tool:ace-search");

/** 文件 stat 缓存条目，记录修改时间和缓存写入时间 */
export interface FileStatCacheEntry {
  mtimeMs: number;
  cachedAt: number;
}

/** 按时效排序搜索结果的配置选项 */
export interface SortResultsByRecencyOptions {
  statCache?: Map<string, FileStatCacheEntry>;
  statCacheTtlMs?: number;
  maxStatCacheSize?: number;
  now?: number;
}

const DEFAULT_FILE_STAT_CACHE_TTL_MS = 60 * 1000;

/** 裁剪文件 stat 缓存，移除最早的条目以控制缓存大小 @param statCache 缓存映射 @param maxStatCacheSize 最大缓存条数 */
export function trimFileStatCache(statCache: Map<string, FileStatCacheEntry>, maxStatCacheSize: number): void {
  const overflow = statCache.size - maxStatCacheSize;
  if (overflow <= 0) {
    return;
  }

  const entries = [...statCache.entries()].toSorted((a, b) => a[1].cachedAt - b[1].cachedAt);
  for (let i = 0; i < overflow; i++) {
    const filePath = entries[i]?.[0];
    if (filePath) {
      statCache.delete(filePath);
    }
  }
}

/**
 * 检测命令是否在系统 PATH 中可用。
 */
/** isCommandAvailable 的实现 */
export function isCommandAvailable(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      let child;
      if (process.platform === "win32") {
        child = spawn("where", [command], {
          stdio: "ignore",
          windowsHide: true,
        });
      } else {
        child = spawn("which", [command], {
          stdio: "ignore",
        });
      }

      child.on("close", (code) => resolve(code === 0));
      child.on("error", (error) => {
        log.debug("ACE command availability probe failed", {
          command,
          error: getCodebaseSearchErrorMessage(error),
        });
        resolve(false);
      });
    } catch (error) {
      log.debug("ACE command availability probe threw", {
        command,
        error: getCodebaseSearchErrorMessage(error),
      });
      resolve(false);
    }
  });
}

/**
 * 解析 grep 输出(格式: filePath:lineNumber:lineContent)。
 */
/** parseGrepOutput 的实现 */
export function parseGrepOutput(output: string, basePath: string): TextSearchResult[] {
  const results: TextSearchResult[] = [];
  if (!output) {
    return results;
  }

  const lines = output.split(EOL);

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    const firstColonIndex = line.indexOf(":");
    if (firstColonIndex === -1) {
      continue;
    }

    const secondColonIndex = line.indexOf(":", firstColonIndex + 1);
    if (secondColonIndex === -1) {
      continue;
    }

    const filePathRaw = line.substring(0, firstColonIndex);
    const lineNumberStr = line.substring(firstColonIndex + 1, secondColonIndex);
    const lineContent = line.substring(secondColonIndex + 1);

    const lineNumber = parseInt(lineNumberStr, 10);
    if (isNaN(lineNumber)) {
      continue;
    }

    const absoluteFilePath = path.resolve(basePath, filePathRaw);
    const relativeFilePath = path.relative(basePath, absoluteFilePath);

    results.push({
      column: 1,
      content: lineContent.trim(),
      filePath: relativeFilePath || path.basename(absoluteFilePath),
      line: lineNumber,
    });
  }

  return results;
}

/**
 * Glob 模式转正则表达式。
 * 支持: *, **, ?, [abc], {js,ts}
 */
/** globToRegex 的实现 */
export function globToRegex(glob: string): RegExp {
  let pattern = glob
    .replace(/[.+^${}()|[\]\\]/g, String.raw`\$&`)
    .replace(/\*\*/g, "<<<DOUBLESTAR>>>")
    .replace(/\*/g, "[^/]*")
    .replace(/<<<DOUBLESTAR>>>/g, ".*")
    .replace(/\?/g, "[^/]");

  // 处理 {js,ts} 替代模式
  pattern = pattern.replace(/\\{([^}]+)\\}/g, (_, alternatives) => `(${alternatives.split(",").join("|")})`);

  // 处理 [abc] 字符类
  pattern = pattern.replace(/\\\[([^\]]+)\\\]/g, "[$1]");

  return new RegExp(pattern, "i");
}

/**
 * 计算符号名的模糊匹配分数。
 * @returns 0-100 分，越高越好
 */
/** calculateFuzzyScore 的实现 */
export function calculateFuzzyScore(symbolName: string, query: string): number {
  const nameLower = symbolName.toLowerCase();
  const queryLower = query.toLowerCase();

  // 精确匹配
  if (nameLower === queryLower) {
    return 100;
  }

  // 前缀匹配
  if (nameLower.startsWith(queryLower)) {
    return 80;
  }

  // 包含匹配
  if (nameLower.includes(queryLower)) {
    return 60;
  }

  // 驼峰匹配("gfc" 匹配 "getFileContent")
  const camelCaseMatch = symbolName
    .split(/(?=[A-Z])/)
    .map((s) => s[0]?.toLowerCase() || "")
    .join("");
  if (camelCaseMatch.includes(queryLower)) {
    return 40;
  }

  // 模糊字符匹配
  let score = 0;
  let queryIndex = 0;
  for (let i = 0; i < nameLower.length && queryIndex < queryLower.length; i++) {
    if (nameLower[i] === queryLower[queryIndex]) {
      score += 20;
      queryIndex++;
    }
  }
  if (queryIndex === queryLower.length) {
    return score;
  }

  return 0;
}

/**
 * 展开花括号 glob 模式(如 "*.{ts,tsx}" → ["*.ts", "*.tsx"])。
 */
/** expandGlobBraces 的实现 */
export function expandGlobBraces(glob: string): string[] {
  const braceMatch = glob.match(/^(.+)\{([^}]+)\}(.*)$/);
  if (!braceMatch || !braceMatch[1] || !braceMatch[2] || braceMatch[3] === undefined) {
    return [glob];
  }

  const prefix = braceMatch[1];
  const alternatives = braceMatch[2].split(",");
  const suffix = braceMatch[3];

  return alternatives.map((alt) => `${prefix}${alt}${suffix}`);
}

/**
 * 将 glob 模式转换为匹配完整路径的正则表达式。
 * 支持: *, **, ?, {a,b}, [abc]
 */
/** globPatternToRegex 的实现 */
export function globPatternToRegex(globPattern: string): RegExp {
  const normalizedGlob = globPattern.replace(/\\/g, "/");

  let regexStr = normalizedGlob
    .replace(/\*\*/g, "\x00DOUBLESTAR\x00")
    .replace(/\*/g, "\x00STAR\x00")
    .replace(/\?/g, "\x00QUESTION\x00");

  // 转义正则特殊字符
  regexStr = regexStr.replace(/[.+^${}()|[\]\\]/g, String.raw`\$&`);

  // 替换占位符
  regexStr = regexStr
    .replace(/\x00DOUBLESTAR\x00/g, ".*")
    .replace(/\x00STAR\x00/g, "[^/]*")
    .replace(/\x00QUESTION\x00/g, ".");

  return new RegExp(regexStr, "i");
}

/**
 * 计算正则表达式模式的复杂度分数(ReDoS 防护)。
 * 分数越高表示灾难性回溯风险越大。
 */
/** calculateRegexComplexity 的实现 */
export function calculateRegexComplexity(pattern: string): number {
  let score = 0;

  // 嵌套量词 (a+)+
  const nestedQuantifierPattern = /\([^)]*[+?*]\)[+?*]/g;
  const nestedMatches = pattern.match(nestedQuantifierPattern);
  if (nestedMatches) {
    score += nestedMatches.length * 30;
  }

  // 重叠量词 a+a*
  const overlappingPattern = /[+?*][+?*]/g;
  const overlappingMatches = pattern.match(overlappingPattern);
  if (overlappingMatches) {
    score += overlappingMatches.length * 20;
  }

  // 量词内的交替组
  const altInGroupPattern = /\([^)]*\|[^)]*\)[+?*]/g;
  const altMatches = pattern.match(altInGroupPattern);
  if (altMatches) {
    score += altMatches.length * 25;
  }

  // 嵌套组深度
  const depth = (pattern.match(/\(/g) || []).length;
  if (depth > 3) {
    score += (depth - 3) * 10;
  }

  // 过多通配符
  const wildcardCount = (pattern.match(/\.\*/g) || []).length;
  if (wildcardCount > 5) {
    score += (wildcardCount - 5) * 5;
  }

  return score;
}

/**
 * 检查正则表达式模式是否安全(ReDoS 防护)。
 */
/** isSafeRegexPattern 的实现 */
export function isSafeRegexPattern(pattern: string, maxComplexity: number = 100): { isSafe: boolean; reason?: string } {
  try {
    // oxlint-disable-next-line no-new
    new RegExp(pattern);
  } catch (error) {
    log.debug("ACE regex safety check rejected invalid regex", {
      error: getCodebaseSearchErrorMessage(error),
      pattern,
    });
    return { isSafe: false, reason: "Invalid regex pattern" };
  }

  const complexity = calculateRegexComplexity(pattern);
  if (complexity > maxComplexity) {
    return {
      isSafe: false,
      reason: `Pattern too complex (score: ${complexity}, max: ${maxComplexity}). Simplify to avoid ReDoS attacks.`,
    };
  }

  return { isSafe: true };
}

/**
 * 限制并发度的处理器。
 * 防止处理大量文件时出现 EMFILE/ENFILE 错误。
 */
export async function processWithConcurrency<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  concurrency: number = 10,
): Promise<R[]> {
  // oxlint-disable-next-line unicorn/no-new-array
  const results: R[] = new Array(items.length);
  let index = 0;

  async function processNext(): Promise<void> {
    const currentIndex = index++;
    if (currentIndex >= items.length) {
      return;
    }

    results[currentIndex] = await processor(items[currentIndex]!);
    await processNext();
  }

  const workers = Array(Math.min(concurrency, items.length))
    .fill(null)
    .map(() => processNext());

  await Promise.all(workers);
  return results;
}

/**
 * 创建超时 Promise。
 */
/** createTimeoutPromise 的实现 */
export function createTimeoutPromise(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
}

/**
 * 按文件修改时间排序搜索结果(最近修改优先)。
 * 24 小时内修改的文件排在前面。
 */
export async function sortResultsByRecency(
  results: TextSearchResult[],
  basePath: string,
  recentThreshold: number = 24 * 60 * 60 * 1000,
  options: SortResultsByRecencyOptions = {},
): Promise<TextSearchResult[]> {
  if (results.length === 0) {
    return results;
  }

  const { promises: fs } = await import("node:fs");
  const now = options.now ?? Date.now();
  const { statCache } = options;
  const statCacheTtlMs = options.statCacheTtlMs ?? DEFAULT_FILE_STAT_CACHE_TTL_MS;

  const uniqueFiles = [...new Set(results.map((r) => r.filePath))];
  const uncachedFiles: string[] = [];
  const fileModTimes = new Map<string, number>();

  for (const filePath of uniqueFiles) {
    const cached = statCache?.get(filePath);
    if (cached && now - cached.cachedAt < statCacheTtlMs) {
      fileModTimes.set(filePath, cached.mtimeMs);
    } else {
      uncachedFiles.push(filePath);
    }
  }

  const statResults = await Promise.allSettled(
    uncachedFiles.map(async (filePath) => {
      const fullPath = path.resolve(basePath, filePath);
      const stats = await fs.stat(fullPath);
      return { filePath, mtimeMs: stats.mtimeMs };
    }),
  );

  statResults.forEach((result, index) => {
    const filePath = uncachedFiles[index]!;
    if (result.status === "fulfilled") {
      const { mtimeMs } = result.value;
      fileModTimes.set(filePath, mtimeMs);
      statCache?.set(filePath, { cachedAt: now, mtimeMs });
      if (statCache && options.maxStatCacheSize !== undefined) {
        trimFileStatCache(statCache, options.maxStatCacheSize);
      }
    } else {
      fileModTimes.set(filePath, 0);
    }
  });

  return results.toSorted((a, b) => {
    const aMtime = fileModTimes.get(a.filePath) || 0;
    const bMtime = fileModTimes.get(b.filePath) || 0;

    const aIsRecent = now - aMtime < recentThreshold;
    const bIsRecent = now - bMtime < recentThreshold;

    if (aIsRecent && !bIsRecent) {
      return -1;
    }
    if (!aIsRecent && bIsRecent) {
      return 1;
    }

    if (aIsRecent && bIsRecent) {
      return bMtime - aMtime;
    }

    return 0;
  });
}
