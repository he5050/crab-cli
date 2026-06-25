/**
 * JavaScript text-search fallback for ACE search.
 *
 * This module is used when git grep, ripgrep, and system grep are unavailable
 * or fail. It keeps filesystem walking and line matching out of
 * ACECodeSearchService.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { createLogger } from "@/core/logging/logger";
import { createInternalError } from "@/core/errors/appError";
import { getCodebaseSearchErrorMessage } from "@/tool/codebaseSearch/errors";
import {
  BINARY_EXTENSIONS,
  LARGE_FILE_THRESHOLD,
  MAX_CONCURRENT_FILE_READS,
  MAX_REGEX_COMPLEXITY_SCORE,
  TEXT_SEARCH_TIMEOUT_MS,
} from "./constants";
import { shouldExcludeDirectory } from "./filesystem";
import { globPatternToRegex, isSafeRegexPattern, processWithConcurrency } from "./search";
import type { TextSearchResult } from "./types";

const log = createLogger("tool:ace-text-fallback");

/** 待搜索的文件信息 */
export interface FileToSearch {
  fullPath: string;
  relativePath: string;
}

/** JavaScript 文本搜索回退策略配置 */
export interface JsTextSearchFallbackOptions {
  basePath: string;
  customExcludes: string[];
  regexCache: Map<string, RegExp>;
  pattern: string;
  fileGlob?: string;
  isRegex?: boolean;
  maxResults?: number;
  onActivity?: () => void;
  searchInLargeFile: (
    fileInfo: FileToSearch,
    searchRegex: RegExp,
    results: TextSearchResult[],
    maxResults: number,
    isAborted: () => boolean,
  ) => Promise<void>;
}

/** @param options 搜索配置 @returns 匹配的文本搜索结果 */
export async function jsTextSearchFallback(options: JsTextSearchFallbackOptions): Promise<TextSearchResult[]> {
  options.onActivity?.();

  const maxResults = options.maxResults ?? 100;
  const isRegex = options.isRegex ?? true;
  const results: TextSearchResult[] = [];
  let isAborted = false;
  const startTime = Date.now();

  const checkTimeout = (): void => {
    if (Date.now() - startTime > TEXT_SEARCH_TIMEOUT_MS) {
      isAborted = true;
      log.warn(`文本搜索在 ${TEXT_SEARCH_TIMEOUT_MS}ms 后超时`);
    }
  };

  const searchRegex = compileSearchRegex(options.pattern, isRegex);
  const globRegex = options.fileGlob ? globPatternToRegex(options.fileGlob) : null;
  const filesToSearch: FileToSearch[] = [];

  const collectFiles = async (dirPath: string): Promise<void> => {
    if (isAborted || filesToSearch.length >= maxResults * 10) {
      return;
    }
    checkTimeout();

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (isAborted || filesToSearch.length >= maxResults * 10) {
          break;
        }

        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          if (
            shouldExcludeDirectory(entry.name, fullPath, options.basePath, options.customExcludes, options.regexCache)
          ) {
            continue;
          }
          await collectFiles(fullPath);
          continue;
        }

        if (!entry.isFile()) {
          continue;
        }

        const relativePath = path.relative(options.basePath, fullPath).replace(/\\/g, "/");
        if (globRegex && !globRegex.test(relativePath)) {
          continue;
        }

        const ext = path.extname(entry.name).toLowerCase();
        if (BINARY_EXTENSIONS.has(ext)) {
          continue;
        }

        filesToSearch.push({ fullPath, relativePath });
      }
    } catch (error) {
      log.debug("文本搜索目录不可访问，已跳过", {
        dir: dirPath,
        error: getCodebaseSearchErrorMessage(error),
      });
    }
  };

  await collectFiles(options.basePath);

  const processFile = async (fileInfo: FileToSearch): Promise<void> => {
    if (isAborted || results.length >= maxResults) {
      return;
    }
    checkTimeout();

    try {
      const stats = await fs.stat(fileInfo.fullPath);

      if (stats.size <= LARGE_FILE_THRESHOLD) {
        const content = await fs.readFile(fileInfo.fullPath, "utf8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          if (isAborted || results.length >= maxResults) {
            break;
          }

          const line = lines[i];
          if (!line) {
            continue;
          }

          searchRegex.lastIndex = 0;
          const match = searchRegex.exec(line);

          if (match) {
            results.push({
              column: match.index + 1,
              content: line.trim(),
              filePath: fileInfo.relativePath,
              line: i + 1,
            });
          }
        }
      } else {
        await options.searchInLargeFile(fileInfo, searchRegex, results, maxResults, () => isAborted);
      }
    } catch (error) {
      log.debug("文本搜索文件不可读，已跳过", {
        error: getCodebaseSearchErrorMessage(error),
        file: fileInfo.relativePath,
      });
    }
  };

  await processWithConcurrency(filesToSearch, processFile, MAX_CONCURRENT_FILE_READS);

  if (isAborted) {
    log.warn(`Text search aborted after ${Date.now() - startTime}ms, returning ${results.length} partial results`);
  }

  return results;
}

function compileSearchRegex(pattern: string, isRegex: boolean): RegExp {
  try {
    if (isRegex) {
      const safety = isSafeRegexPattern(pattern, MAX_REGEX_COMPLEXITY_SCORE);
      if (!safety.isSafe) {
        throw createInternalError("INTERNAL_ERROR", `正则表达式可能不安全: ${safety.reason}`);
      }
      return new RegExp(pattern, "gi");
    }

    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
    return new RegExp(escaped, "gi");
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw createInternalError("INTERNAL_ERROR", `无效的正则表达式: ${pattern}`);
  }
}
