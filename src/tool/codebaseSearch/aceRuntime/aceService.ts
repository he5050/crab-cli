/**
 * ACE Code Search 服务 — 增强型符号索引与搜索聚合入口
 *
 * 拆分为:
 *   - aceServiceLifecycle.ts: 缓存、内存管理、索引构建锁、排除模式
 *   - aceGrepEngine.ts: grep 搜索引擎
 *   - textSearchFallback.ts: JS 回退搜索
 *   - textSearchStrategy.ts: 多层文本搜索策略
 *   - indexBuilder.ts: 符号索引构建
 *   - referenceSearch.ts: 引用搜索
 *   - aceServiceHelpers.ts: 定义搜索与文件大纲
 *
 * 本文件保留 ACECodeSearchService 核心类。
 */

import * as path from "node:path";

import { createLogger } from "@/core/logging/logger";

import type { CodeReference, CodeSymbol, SemanticSearchResult, SymbolType, TextSearchResult } from "./types";
import { ACE_IDLE_CLEANUP_MS, TEXT_SEARCH_TIMEOUT_MS } from "./constants";
import { calculateFuzzyScore } from "./search";
import { GrepSearchEngine } from "./aceGrepEngine";
import { createInternalError } from "@/core/errors/appError";
import { jsTextSearchFallback } from "./textSearchFallback";
import { buildSymbolIndex } from "./indexBuilder";
import { findSymbolReferences } from "./referenceSearch";
import { executeTextSearchStrategy } from "./textSearchStrategy";
import { findDefinitionInSymbolIndex, getAceFileOutline } from "./aceServiceHelpers";
import {
  type ACEServiceState,
  createACEServiceState,
  buildContentCacheCallbacks,
  withIndexBuildLock,
  markActivity,
  markIndexTruncated,
  clearContentCache,
  removeFromContentCache,
  trimContentCacheByBytes,
  getMemoryStats,
  clearCaches,
  loadExclusionPatternsIfNeeded,
  isCommandAvailableCached,
  isGitRepository,
  canUseIndexCache,
  updateLastIndexTime,
  scheduleIdleCleanup,
} from "./aceServiceLifecycle";

const log = createLogger("tool:ace-service");

// ─── ACE Code Search Service ────────────────────────────────────────

/** 增强型代码搜索服务，提供符号索引、文本搜索、引用查找和定义跳转 */
export class ACECodeSearchService {
  private basePath: string;
  private state: ACEServiceState;
  private contentCacheCallbacks: ReturnType<typeof buildContentCacheCallbacks>;
  private grepEngine: GrepSearchEngine;
  private idleCleanupTimer: NodeJS.Timeout | undefined;
  private isDisposed = false;
  private readonly idleCleanupMs: number;

  constructor(basePath: string = process.cwd(), options?: { idleCleanupMs?: number }) {
    this.basePath = path.resolve(basePath);
    this.idleCleanupMs = options?.idleCleanupMs ?? ACE_IDLE_CLEANUP_MS;
    this.state = createACEServiceState();
    this.contentCacheCallbacks = buildContentCacheCallbacks(this.state);
    this.grepEngine = new GrepSearchEngine(this.basePath, () => this.markActivity());
    this.scheduleIdleCleanup();
  }

  // ─── 生命周期方法 ──────────────────────────────────────────────

  private ensureNotDisposed(): void {
    if (this.isDisposed) {
      throw createInternalError("INTERNAL_ERROR", "ACE 代码搜索服务已释放");
    }
  }

  private scheduleIdleCleanup(): void {
    scheduleIdleCleanup(this.state, this.isDisposed, this.idleCleanupMs, { timer: this.idleCleanupTimer }, () => {
      if (this.isDisposed) {
        return;
      }
      log.debug(`ACE 空闲清理已触发: ${this.basePath}`);
      this.clearAllCaches({ preserveCommandCache: true, preserveExclusions: true });
    });
    this.idleCleanupTimer = undefined;
  }

  private markActivity(): void {
    this.ensureNotDisposed();
    this.scheduleIdleCleanup();
  }

  /** 获取内存使用统计 */
  getMemoryStats(): ReturnType<typeof getMemoryStats> {
    return getMemoryStats(this.state);
  }

  private clearAllCaches(options?: { preserveExclusions?: boolean; preserveCommandCache?: boolean }): void {
    clearCaches(this.state, options);
  }

  /** 释放所有资源 */
  dispose(): void {
    if (this.idleCleanupTimer) {
      clearTimeout(this.idleCleanupTimer);
      this.idleCleanupTimer = undefined;
    }
    this.clearAllCaches();
    this.isDisposed = true;
  }

  // ─── 索引构建 ─────────────────────────────────────────────────

  /**
   * 构建或刷新符号索引(增量更新)。
   * 仅重新解析修改时间变化的文件。
   */
  private async buildIndex(forceRefresh: boolean = false): Promise<void> {
    this.markActivity();

    return withIndexBuildLock(this.state, async () => {
      if (canUseIndexCache(this.state, forceRefresh)) {
        return;
      }

      await loadExclusionPatternsIfNeeded(this.state, this.basePath);

      if (forceRefresh) {
        this.clearAllCaches({ preserveCommandCache: true, preserveExclusions: true });
      }

      await buildSymbolIndex({
        allIndexedFiles: this.state.allIndexedFiles,
        basePath: this.basePath,
        clearContentCache: () => clearContentCache(this.state),
        contentCacheCallbacks: this.contentCacheCallbacks,
        customExcludes: this.state.customExcludes,
        fileContentCache: this.state.fileContentCache,
        fileModTimes: this.state.fileModTimes,
        indexCache: this.state.indexCache,
        markIndexTruncated: (message) => markIndexTruncated(this.state, message),
        regexCache: this.state.regexCache,
        removeFromContentCache: (filePath) => removeFromContentCache(this.state, filePath),
      });

      updateLastIndexTime(this.state);
    });
  }

  // ─── 符号搜索 ─────────────────────────────────────────────────

  /**
   * 按名称模糊搜索符号。
   * 使用内置模糊评分(crab-cli 不依赖 fzf 库)。
   */
  async searchSymbols(
    query: string,
    symbolType?: CodeSymbol["type"],
    language?: string,
    maxResults: number = 100,
  ): Promise<SemanticSearchResult> {
    this.markActivity();
    const startTime = Date.now();
    await this.buildIndex();
    await this.state.indexBuildQueue;

    // 模糊匹配评分
    const calculateScore = (symbolName: string): number => calculateFuzzyScore(symbolName, query);

    // 搜索所有索引符号
    const symbolsWithScores: { symbol: CodeSymbol; score: number }[] = [];

    for (const fileSymbols of this.state.indexCache.values()) {
      for (const symbol of fileSymbols) {
        if (symbolType && symbol.type !== symbolType) {
          continue;
        }
        if (language && symbol.language !== language) {
          continue;
        }

        const score = calculateScore(symbol.name);
        if (score > 0) {
          symbolsWithScores.push({ score, symbol: { ...symbol } });
        }

        if (symbolsWithScores.length >= maxResults * 2) {
          break;
        }
      }
      if (symbolsWithScores.length >= maxResults * 2) {
        break;
      }
    }

    symbolsWithScores.sort((a, b) => b.score - a.score);

    const symbols = symbolsWithScores.slice(0, maxResults).map((item) => item.symbol);

    const searchTime = Date.now() - startTime;

    return {
      query,
      references: [],
      searchTime,
      symbols,
      totalResults: symbols.length,
    };
  }

  // ─── 引用搜索 ─────────────────────────────────────────────────

  /**
   * 查找符号的所有引用。
   */
  async findReferences(symbolName: string, maxResults: number = 100): Promise<CodeReference[]> {
    this.markActivity();
    await loadExclusionPatternsIfNeeded(this.state, this.basePath);
    const references = await findSymbolReferences({
      basePath: this.basePath,
      contentCacheCallbacks: this.contentCacheCallbacks,
      customExcludes: this.state.customExcludes,
      fileContentCache: this.state.fileContentCache,
      maxResults,
      regexCache: this.state.regexCache,
      symbolName,
    });
    trimContentCacheByBytes(this.state);

    return references;
  }

  // ─── 定义搜索 ─────────────────────────────────────────────────

  /**
   * 查找符号定义(go to definition)。
   */
  async findDefinition(symbolName: string, contextFile?: string): Promise<CodeSymbol | null> {
    this.markActivity();
    await this.buildIndex();
    await this.state.indexBuildQueue;

    return findDefinitionInSymbolIndex(
      this.state.indexCache,
      symbolName,
      contextFile ? path.resolve(this.basePath, contextFile) : undefined,
    );
  }

  // ─── 文件大纲 ─────────────────────────────────────────────────

  /**
   * 获取文件的代码大纲(所有符号)。
   */
  async getFileOutline(
    filePath: string,
    options?: {
      maxResults?: number;
      includeContext?: boolean;
      symbolTypes?: SymbolType[];
    },
  ): Promise<CodeSymbol[]> {
    this.markActivity();
    return getAceFileOutline({ basePath: this.basePath, filePath, options });
  }

  // ─── 文本搜索(多层策略) ─────────────────────────────────────

  /**
   * 快速文本搜索(多层策略)。
   * 策略 1:git grep(最快，使用 git 索引)
   * 策略 2:ripgrep(快速，系统优化)
   * 策略 3:系统 grep(可靠，全平台)
   * 策略 4:JS 回退(总是可用)
   */
  async textSearch(
    pattern: string,
    fileGlob?: string,
    isRegex: boolean = true,
    maxResults: number = 100,
  ): Promise<TextSearchResult[]> {
    this.markActivity();

    const timeoutMs = TEXT_SEARCH_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`文本搜索超过 ${timeoutMs}ms 超时。请尝试使用更具体的 pattern 或 fileGlob 过滤条件。`));
      }, timeoutMs);
      timeoutId.unref?.();

      this.executeTextSearch(pattern, fileGlob, isRegex, maxResults)
        .then((result) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  private async executeTextSearch(
    pattern: string,
    fileGlob?: string,
    isRegex: boolean = true,
    maxResults: number = 100,
  ): Promise<TextSearchResult[]> {
    this.markActivity();

    return executeTextSearchStrategy({
      basePath: this.basePath,
      fileGlob,
      gitGrepSearch: (searchPattern, glob, limit, regexMode) =>
        this.gitGrepSearch(searchPattern, glob, limit, regexMode),
      isCommandAvailable: (command) => isCommandAvailableCached(this.state, command),
      isGitRepository: () => isGitRepository(this.state, this.basePath),
      isRegex,
      jsTextSearch: (searchPattern, glob, regexMode, limit) => this.jsTextSearch(searchPattern, glob, regexMode, limit),
      maxResults,
      pattern,
      statCache: this.state.fileStatCache,
      systemGrepSearch: (searchPattern, glob, limit, command) =>
        this.systemGrepSearch(searchPattern, glob, limit, command),
    });
  }

  // ─── git grep ────────────────────────────────────────────────

  private async gitGrepSearch(
    pattern: string,
    fileGlob?: string,
    maxResults: number = 100,
    isRegex: boolean = true,
  ): Promise<TextSearchResult[]> {
    return this.grepEngine.gitGrepSearch(pattern, fileGlob, maxResults, isRegex);
  }

  // ─── system grep / ripgrep ───────────────────────────────────

  private async systemGrepSearch(
    pattern: string,
    fileGlob?: string,
    maxResults: number = 100,
    grepCommand: "rg" | "grep" = "grep",
  ): Promise<TextSearchResult[]> {
    return this.grepEngine.systemGrepSearch(pattern, fileGlob, maxResults, grepCommand);
  }

  // ─── JS 回退搜索 ────────────────────────────────────────────

  private async jsTextSearch(
    pattern: string,
    fileGlob?: string,
    isRegex: boolean = true,
    maxResults: number = 100,
  ): Promise<TextSearchResult[]> {
    await loadExclusionPatternsIfNeeded(this.state, this.basePath);
    return jsTextSearchFallback({
      basePath: this.basePath,
      customExcludes: this.state.customExcludes,
      fileGlob,
      isRegex,
      maxResults,
      onActivity: () => this.markActivity(),
      pattern,
      regexCache: this.state.regexCache,
      searchInLargeFile: (fileInfo, searchRegex, results, resultLimit, isAborted) =>
        this.searchInLargeFile(fileInfo, searchRegex, results, resultLimit, isAborted),
    });
  }

  private async searchInLargeFile(
    fileInfo: { fullPath: string; relativePath: string },
    searchRegex: RegExp,
    results: TextSearchResult[],
    maxResults: number,
    isAborted: () => boolean,
  ): Promise<void> {
    return this.grepEngine.searchInLargeFile(fileInfo, searchRegex, results, maxResults, isAborted);
  }

  // ─── 语义搜索 ────────────────────────────────────────────────

  /**
   * 带语言上下文的语义搜索(交叉引用搜索)。
   */
  async semanticSearch(
    query: string,
    searchType: "definition" | "usage" | "implementation" | "all" = "all",
    language?: string,
    symbolType?: CodeSymbol["type"],
    maxResults: number = 50,
  ): Promise<SemanticSearchResult> {
    this.markActivity();
    const startTime = Date.now();

    const symbolResults = await this.searchSymbols(query, symbolType, language, maxResults);

    const references: CodeReference[] = [];
    if (searchType === "usage" || searchType === "all") {
      const topSymbols = symbolResults.symbols.slice(0, 5);
      for (const symbol of topSymbols) {
        const symbolRefs = await this.findReferences(symbol.name, maxResults);
        references.push(...symbolRefs);
      }
    }

    let filteredSymbols = symbolResults.symbols;
    if (searchType === "definition") {
      filteredSymbols = symbolResults.symbols.filter(
        (s) => s.type === "function" || s.type === "class" || s.type === "interface",
      );
    } else if (searchType === "usage") {
      filteredSymbols = [];
    } else if (searchType === "implementation") {
      filteredSymbols = symbolResults.symbols.filter(
        (s) => s.type === "function" || s.type === "method" || s.type === "class",
      );
    }

    const searchTime = Date.now() - startTime;

    return {
      query,
      references,
      searchTime,
      symbols: filteredSymbols,
      totalResults: filteredSymbols.length + references.length,
    };
  }
}
