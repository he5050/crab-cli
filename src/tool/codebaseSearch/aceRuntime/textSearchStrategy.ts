/**
 * ACE text-search strategy dispatcher.
 *
 * Chooses git grep, ripgrep, system grep, or JavaScript fallback and applies
 * the shared recency sorter to the selected result set.
 */
import { createLogger } from "@/core/logging/logger";
import { getCodebaseSearchErrorMessage } from "@/tool/codebaseSearch/errors";
import { MAX_FILE_STAT_CACHE_SIZE, RECENT_FILE_THRESHOLD } from "./constants";
import { type FileStatCacheEntry, sortResultsByRecency } from "./search";
import type { TextSearchResult } from "./types";

const log = createLogger("tool:ace-text-strategy");

/** 文本搜索策略调度器的输入参数 */
export interface ExecuteTextSearchStrategyInput {
  basePath: string;
  pattern: string;
  fileGlob?: string;
  isRegex?: boolean;
  maxResults?: number;
  statCache: Map<string, FileStatCacheEntry>;
  isGitRepository: () => Promise<boolean>;
  isCommandAvailable: (command: "git" | "rg" | "grep") => Promise<boolean>;
  gitGrepSearch: (
    pattern: string,
    fileGlob: string | undefined,
    maxResults: number,
    isRegex: boolean,
  ) => Promise<TextSearchResult[]>;
  systemGrepSearch: (
    pattern: string,
    fileGlob: string | undefined,
    maxResults: number,
    grepCommand: "rg" | "grep",
  ) => Promise<TextSearchResult[]>;
  jsTextSearch: (
    pattern: string,
    fileGlob: string | undefined,
    isRegex: boolean,
    maxResults: number,
  ) => Promise<TextSearchResult[]>;
}

/** 按优先级调度文本搜索策略（git grep → ripgrep → grep → JS 回退） */
export async function executeTextSearchStrategy(input: ExecuteTextSearchStrategyInput): Promise<TextSearchResult[]> {
  const maxResults = input.maxResults ?? 100;
  const isRegex = input.isRegex ?? true;

  const [isGitRepo, gitAvailable, rgAvailable, grepAvailable] = await Promise.all([
    input.isGitRepository(),
    input.isCommandAvailable("git"),
    input.isCommandAvailable("rg"),
    input.isCommandAvailable("grep"),
  ]);

  if (isGitRepo && gitAvailable) {
    try {
      const results = await input.gitGrepSearch(input.pattern, input.fileGlob, maxResults, isRegex);
      if (results.length > 0) {
        return sortByRecency(input, results);
      }
    } catch (error) {
      log.debug("git grep 搜索失败，尝试下一种策略", {
        basePath: input.basePath,
        error: getCodebaseSearchErrorMessage(error),
      });
    }
  }

  if (rgAvailable) {
    try {
      const results = await input.systemGrepSearch(input.pattern, input.fileGlob, maxResults, "rg");
      return sortByRecency(input, results);
    } catch (error) {
      log.info("ripgrep 搜索失败，尝试下一种策略", {
        basePath: input.basePath,
        error: getCodebaseSearchErrorMessage(error),
      });
    }
  }

  if (grepAvailable) {
    try {
      const results = await input.systemGrepSearch(input.pattern, input.fileGlob, maxResults, "grep");
      return sortByRecency(input, results);
    } catch (error) {
      log.info("系统 grep 搜索失败，回退到 JavaScript 搜索", {
        basePath: input.basePath,
        error: getCodebaseSearchErrorMessage(error),
      });
    }
  }

  log.info("使用 JavaScript 回退策略执行文本搜索");
  const results = await input.jsTextSearch(input.pattern, input.fileGlob, isRegex, maxResults);
  return sortByRecency(input, results);
}

function sortByRecency(
  input: ExecuteTextSearchStrategyInput,
  results: TextSearchResult[],
): Promise<TextSearchResult[]> {
  return sortResultsByRecency(results, input.basePath, RECENT_FILE_THRESHOLD, {
    maxStatCacheSize: MAX_FILE_STAT_CACHE_SIZE,
    statCache: input.statCache,
  });
}
