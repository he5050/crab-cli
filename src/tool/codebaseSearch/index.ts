/**
 * 代码库搜索工具 — 基于符号和语义的代码搜索。
 *
 * 职责:
 *   - 暴露 codebase-search 工具定义和参数 schema
 *   - 统一缓存、进度 metadata、业务 telemetry
 *   - 调度本地/远程搜索策略和 Agent Review 后处理
 *
 * 具体搜索策略放在 searchStrategies.ts；Agent Review 过滤和补搜放在
 * agentReview.ts，避免入口文件继续承载所有模式实现。
 */
import { z } from "zod";
import { CODEBASE_SEARCH_CACHE_TTL_MS, MAX_CODEBASE_CACHE_SIZE } from "@/config";
import { createLogger } from "@/core/logging/logger";
import { recordSearchBusinessTelemetry } from "@/monitor/telemetry/telemetry";
import { type ToolContext, defineTool } from "@/tool/types";
import { maybeApplyAgentReview } from "./agentReview";
import { createCodebaseSearchError, toCodebaseSearchFailure } from "./errors";
import { emitSearchMetadata } from "./searchProgress";
import { runCodebaseSearch } from "./searchStrategies";

const log = createLogger("tool:codebase-search");

/** 缓存条目 */
interface CacheEntry {
  results: Record<string, unknown>;
  timestamp: number;
}

/** 搜索缓存(最多 30 条，TTL 30 秒) */
const searchCache = new Map<string, CacheEntry>();
const CACHE_TTL = CODEBASE_SEARCH_CACHE_TTL_MS;

/** 代码库综合搜索工具 — 符号/引用/文本/语义/路径搜索 */
export const codebaseSearchTool = defineTool({
  description:
    "在代码库中搜索符号定义、引用、文本和语义相似代码。" +
    "支持六种模式:symbols(符号定义)、references(引用查找)、text(文本搜索)、semantic(语义向量搜索)、hybrid(混合搜索)、ace(增强符号搜索，使用 ctags)、path(路径模糊搜索)。" +
    "语义搜索使用 AI embedding 实现自然语言查代码。ACE 模式使用 ctags 进行精确符号解析。自动排除 node_modules/.git/dist 等。" +
    "支持 SSH 远程搜索(当 path 以 ssh:// 开头时自动启用)。",
  execute: async (
    {
      query,
      mode,
      path: searchPath,
      include,
      exclude,
      maxResults,
      rerank,
      rerankTopN,
      agentReview,
      agentReviewMaxResults,
      agentReviewThreshold,
      agentReviewRetry,
      agentReviewMinResults,
    },
    context?: ToolContext,
  ) => {
    const startedAt = Date.now();
    const cwd = searchPath ?? process.cwd();
    const searchMode = mode ?? "text";
    const limit = maxResults ?? 50;
    const useRerank = rerank ?? searchMode === "hybrid";
    const topN = rerankTopN ?? 20;

    // 检查缓存(rerank 结果不缓存)
    const cacheKey = `${query}:${searchMode}:${cwd}:${include ?? ""}:${limit}:${useRerank}`;
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL && !useRerank) {
      log.debug(`缓存命中: ${query}`);
      emitSearchMetadata(context, "代码库搜索缓存命中", {
        mode: searchMode,
        path: cwd,
        query,
        total: cached.results.total,
      });
      recordSearchBusinessTelemetry({
        agentReviewEnabled: false,
        cached: true,
        durationMs: Date.now() - startedAt,
        exitReason: "cache_hit",
        mode: searchMode,
        status: "success",
        total: typeof cached.results.total === "number" ? cached.results.total : undefined,
      });
      return { ...cached.results, fromCache: true };
    }

    try {
      emitSearchMetadata(context, "代码库搜索中", { limit, mode: searchMode, path: cwd, query });
      const result = await runCodebaseSearch({
        cwd,
        exclude,
        include,
        limit,
        mode: searchMode,
        query,
        rerankTopN: topN,
        useRerank,
      });
      emitSearchMetadata(context, "代码库搜索完成", {
        mode: searchMode,
        path: cwd,
        query,
        total: result.total,
      });

      // 缓存结果(rerank 结果不缓存)
      if (!useRerank) {
        if (searchCache.size >= MAX_CODEBASE_CACHE_SIZE) {
          const oldest = [...searchCache.entries()].toSorted((a, b) => a[1].timestamp - b[1].timestamp)[0];
          if (oldest) {
            searchCache.delete(oldest[0]);
          }
        }
        searchCache.set(cacheKey, { results: result, timestamp: Date.now() });
      }

      const finalResult = await maybeApplyAgentReview(result, {
        context,
        cwd,
        exclude,
        explicitEnabled: agentReview,
        include,
        limit,
        maxResults: agentReviewMaxResults,
        minResults: agentReviewMinResults,
        mode: searchMode,
        query,
        relevanceThreshold: agentReviewThreshold,
        rerankTopN: topN,
        retryEnabled: agentReviewRetry,
        useRerank,
      });
      const agentReviewMeta = finalResult.agentReview;
      const agentReviewEnabled =
        typeof agentReviewMeta === "object" && agentReviewMeta !== null && "enabled" in agentReviewMeta
          ? Boolean((agentReviewMeta as Record<string, unknown>).enabled)
          : false;
      recordSearchBusinessTelemetry({
        agentReviewEnabled,
        cached: false,
        durationMs: Date.now() - startedAt,
        exitReason: "success",
        mode: searchMode,
        status: "success",
        total: typeof finalResult.total === "number" ? finalResult.total : undefined,
      });
      return finalResult;
    } catch (error) {
      const appError = createCodebaseSearchError(error, {
        include,
        mode: searchMode,
        operation: "execute",
        path: cwd,
        query,
      });
      const failure = toCodebaseSearchFailure(appError);
      log.error(`搜索失败: ${query}`, { error: failure.error, errorCode: failure.errorCode });
      recordSearchBusinessTelemetry({
        agentReviewEnabled: agentReview === true,
        cached: false,
        durationMs: Date.now() - startedAt,
        error: failure.error,
        exitReason: "exception",
        mode: searchMode,
        status: "error",
        total: 0,
      });
      return { mode: searchMode, query, results: [], total: 0, ...failure };
    }
  },
  name: "codebase-search",
  parameters: z.object({
    /** 是否使用 Agent Review 二次过滤搜索结果 */
    agentReview: z
      .boolean()
      .optional()
      .describe("是否使用 codebase-review agent 二次过滤搜索结果，默认读取 settings.codebase.enableAgentReview"),
    /** Agent Review 最大返回结果数 */
    agentReviewMaxResults: z.number().optional().describe("Agent Review 返回的最大结果数，默认 10"),
    /** Agent Review 最少期望结果数，低于该数量会触发一次补搜 */
    agentReviewMinResults: z.number().min(1).optional().describe("Agent Review 最少期望结果数，默认 1"),
    /** Agent Review 结果不足时是否自动改写查询并补搜一次 */
    agentReviewRetry: z.boolean().optional().describe("Agent Review 结果不足时是否自动改写查询并补搜一次，默认 true"),
    /** Agent Review 相关性阈值 */
    agentReviewThreshold: z.number().min(0).max(1).optional().describe("Agent Review 相关性阈值，默认 0.5"),
    /** 排除的目录或文件模式 */
    exclude: z.array(z.string()).optional().describe("排除的目录或文件模式(默认排除 node_modules/.git/dist 等)"),
    /** 文件类型过滤 */
    include: z.string().optional().describe("文件类型过滤，如 *.ts"),
    /** 最大结果数 */
    maxResults: z.number().optional().describe("最大返回结果数，默认 50"),
    /** 搜索模式 */
    mode: z
      .enum(["symbols", "references", "text", "semantic", "hybrid", "ace", "path"])
      .optional()
      .describe("搜索模式:symbols/references/text/semantic/hybrid/ace/path，默认 text"),
    /** 搜索路径 */
    path: z.string().optional().describe("搜索路径(文件或目录，ssh:// 开头启用远程搜索)"),
    /** 搜索查询 */
    query: z.string().describe("搜索查询(符号名、文本、路径片段等)"),
    /** 是否使用 Rerank 重排序(hybrid 模式默认启用) */
    rerank: z.boolean().optional().describe("是否使用 Rerank API 重排序结果(hybrid 模式默认启用)"),
    /** Rerank 返回数量 */
    rerankTopN: z.number().optional().describe("Rerank 返回的最大结果数，默认 20"),
  }),
  permission: "fs.read",
  builtin: true,
});
