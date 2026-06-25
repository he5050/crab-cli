/**
 * HybridSearch 模块
 *
 * 职责:
 *   - 提供统一的搜索接口，整合 LSP 精确搜索和向量语义搜索
 *   - 合并和排序来自不同来源的搜索结果
 *   - 支持纯精确搜索、纯语义搜索、混合搜索三种策略
 *   - 去重处理同一位置的多个匹配结果
 *
 * 模块功能:
 *   - HybridSearchService 类:混合搜索服务核心类
 *   - search: 执行混合搜索，支持三种策略
 *   - exactSearch: LSP 符号搜索 + Regex 文本搜索
 *   - semanticSearch: 基于 Embedding 的向量语义搜索
 *   - deduplicateResults: 去重同一文件+行号的结果
 *
 * 使用场景:
 *   - 代码库综合搜索(精确 + 语义)
 *   - 快速符号定位(LSP 精确搜索)
 *   - 语义相似代码查找(向量搜索)
 *   - 模糊查询和概念搜索
 *
 * 边界:
 *   1. 需要 LSP 服务支持精确搜索
 *   2. 需要 Embedding API 支持语义搜索
 *   3. 需要预先索引的向量数据库
 *   4. 精确匹配结果优先于语义匹配
 *   5. 搜索结果按分数排序并截断
 *
 * 流程:
 *   1. 根据策略选择搜索方式(exact/semantic/hybrid)
 *   2. 执行 LSP 符号搜索(如可用)
 *   3. 如 LSP 结果不足，执行 Regex 文本搜索
 *   4. 执行向量语义搜索(生成查询向量并搜索)
 *   5. 合并结果，去重同一位置
 *   6. 按优先级排序(精确优先)并返回
 */
import { createLogger } from "@/core/logging/logger";
import { lspManager } from "@/lsp/index";
import { type SearchResult, VectorDb } from "@/tool/codebaseSearch/indexer/vectorDb";
import { exec } from "@/bus";
import { join, relative } from "node:path";
import { existsSync, readFileSync } from "node:fs";

const log = createLogger("search:hybrid");

/** 混合搜索结果项 */
export interface HybridSearchResult {
  /** 文件路径 */
  file: string;
  /** 行号 */
  line: number;
  /** 结束行(语义搜索时可能有范围) */
  endLine?: number;
  /** 匹配文本 */
  text: string;
  /** 相似度分数(0-1) */
  score: number;
  /** 结果来源 */
  source: "lsp" | "vector" | "regex";
  /** 匹配类型 */
  type: "definition" | "reference" | "semantic" | "text";
}

/** 混合搜索选项 */
export interface HybridSearchOptions {
  /** 搜索策略(默认 hybrid) */
  strategy?: "exact" | "semantic" | "hybrid";
  /** 最大结果数 */
  maxResults?: number;
  /** 语义搜索最低相似度 */
  minSemanticScore?: number;
  /** 文件路径过滤 */
  filePathFilter?: string;
  /** 语言过滤 */
  languageFilter?: string;
  /** 应用配置(用于 Embedding API) */
  appConfig?: unknown;
}

/**
 * 混合搜索服务。
 *
 * 使用方式:
 *   const service = new HybridSearchService(rootDir);
 *   const results = await service.search("hello", { strategy: "hybrid" });
 */
/** HybridSearchService */
export class HybridSearchService {
  private rootDir: string;
  private vectorDb: VectorDb | null = null;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  /**
   * 执行混合搜索。
   */
  async search(query: string, options: HybridSearchOptions = {}): Promise<HybridSearchResult[]> {
    const strategy = options.strategy ?? "hybrid";
    const maxResults = options.maxResults ?? 20;

    const results: HybridSearchResult[] = [];

    // 精确搜索
    if (strategy === "exact" || strategy === "hybrid") {
      const exactResults = await this.exactSearch(query, maxResults);
      results.push(...exactResults);
    }

    // 语义搜索
    if (strategy === "semantic" || strategy === "hybrid") {
      const semanticResults = await this.semanticSearch(
        query,
        maxResults,
        options.minSemanticScore ?? 0.3,
        options.filePathFilter,
        options.languageFilter,
        options.appConfig as any,
      );
      results.push(...semanticResults);
    }

    // 去重(同一文件+行号只保留最高分)
    const deduped = this.deduplicateResults(results);

    // 排序:精确匹配优先，然后按分数排序
    deduped.sort((a, b) => {
      // 精确匹配(LSP/regex)优先
      if (a.source !== "vector" && b.source === "vector") {
        return -1;
      }
      if (a.source === "vector" && b.source !== "vector") {
        return 1;
      }
      return b.score - a.score;
    });

    return deduped.slice(0, maxResults);
  }

  /**
   * 精确搜索(LSP + regex)。
   */
  private async exactSearch(query: string, limit: number): Promise<HybridSearchResult[]> {
    const results: HybridSearchResult[] = [];

    // 策略 1:LSP 符号搜索(如果 LSP 可用)
    try {
      const symbols = await lspManager.documentSymbols(query);
      if (symbols.length > 0) {
        for (const sym of symbols.slice(0, limit)) {
          results.push({
            file: sym.location.uri.replace(/^file:\/\//, ""),
            line: sym.location.range.start.line + 1,
            score: 1,
            source: "lsp",
            text: sym.name,
            type: "definition",
          });
        }
      }
    } catch {
      // LSP 不可用
    }

    // 策略 2:Regex 搜索
    if (results.length < limit) {
      const regexResults = await this.regexSearch(query, limit - results.length);
      results.push(...regexResults);
    }

    return results;
  }

  /**
   * Regex 文本搜索(回退方案)。
   */
  private async regexSearch(query: string, limit: number): Promise<HybridSearchResult[]> {
    const results: HybridSearchResult[] = [];

    try {
      const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
      const result = await exec(
        [
          "rg",
          "--line-number",
          "--no-heading",
          "--color=never",
          "--max-count",
          String(limit),
          "--glob",
          "!node_modules",
          "--glob",
          "!*.d.ts",
          "--",
          escapedQuery,
          this.rootDir,
        ],
        { timeout: 10_000 },
      );

      if (result.exitCode === 0 && result.stdout.trim()) {
        for (const line of result.stdout.split("\n")) {
          if (!line.trim()) {
            continue;
          }
          const match = line.match(/^(.+?)[:-](\d+)[:-](.*)$/);
          if (match) {
            results.push({
              file: match[1]!,
              line: parseInt(match[2]!, 10),
              score: 0.8,
              source: "regex",
              text: match[3]!.trim(),
              type: "text",
            });
          }
        }
      }
    } catch {
      // Rg not available
    }

    return results;
  }

  /**
   * 语义搜索(向量相似度)。
   */
  private async semanticSearch(
    query: string,
    limit: number,
    minScore: number,
    filePathFilter?: string,
    languageFilter?: string,
    appConfig?: any,
  ): Promise<HybridSearchResult[]> {
    try {
      // 动态导入 Embedding API
      const { embedText } = await import("@api");

      if (!appConfig) {
        log.debug("无 appConfig，跳过语义搜索");
        return [];
      }

      // 生成查询向量
      const { embedding } = await embedText(appConfig, query);

      // 打开向量数据库
      if (!this.vectorDb) {
        this.vectorDb = new VectorDb();
      }

      const stats = this.vectorDb.getStats();
      if (stats.totalChunks === 0) {
        log.debug("向量索引为空，跳过语义搜索");
        return [];
      }

      const searchResults = this.vectorDb.search(embedding, {
        filePathFilter,
        languageFilter,
        limit,
        minScore,
      });

      return searchResults.map((r: SearchResult) => ({
        endLine: r.chunk.endLine,
        file: r.chunk.filePath,
        line: r.chunk.startLine,
        score: r.score,
        source: "vector" as const,
        text: r.chunk.content.slice(0, 200),
        type: "semantic" as const,
      }));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.warn(`语义搜索失败: ${msg}`);
      return [];
    }
  }

  /**
   * 去重搜索结果(同一文件+行号只保留最高分)。
   */
  private deduplicateResults(results: HybridSearchResult[]): HybridSearchResult[] {
    const seen = new Map<string, HybridSearchResult>();

    for (const result of results) {
      const key = `${result.file}:${result.line}`;
      const existing = seen.get(key);
      if (!existing || result.score > existing.score) {
        seen.set(key, result);
      }
    }

    return [...seen.values()];
  }

  /**
   * 关闭资源。
   */
  dispose(): void {
    if (this.vectorDb) {
      this.vectorDb.close();
      this.vectorDb = null;
    }
  }
}
