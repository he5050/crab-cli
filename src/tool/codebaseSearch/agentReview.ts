import { createLogger } from "@/core/logging/logger";
import type { ToolContext } from "@/tool/types";
import { getCodebaseSearchErrorMessage } from "./errors";
import { emitSearchMetadata } from "./searchProgress";
import { runCodebaseSearch } from "./searchStrategies";
import {
  type ToolFacingReviewedResultItem,
  type ToolFacingSearchResultItem,
  reviewToolCodebaseSearchResults,
  rewriteToolCodebaseSearchQuery,
} from "@/agent";

const log = createLogger("tool:codebase-search");

interface AgentReviewOptions {
  query: string;
  cwd: string;
  mode: string;
  include?: string;
  exclude?: string[];
  limit: number;
  useRerank: boolean;
  rerankTopN: number;
  context?: ToolContext;
  explicitEnabled?: boolean;
  maxResults?: number;
  relevanceThreshold?: number;
  retryEnabled?: boolean;
  minResults?: number;
}

type ReviewableSearchItem = ToolFacingSearchResultItem & {
  originalIndex: number;
};

/** 在搜索结果上可选地执行 Agent 审查（相关性评分、过滤、重试） */
export async function maybeApplyAgentReview(
  result: Record<string, unknown>,
  options: AgentReviewOptions,
): Promise<Record<string, unknown>> {
  if (options.mode === "path") {
    return result;
  }

  const rawResults = Array.isArray(result.results)
    ? result.results.filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    : [];
  if (rawResults.length === 0) {
    return result;
  }

  const enabled = options.explicitEnabled ?? (await readAgentReviewSetting(options.cwd));
  if (!enabled) {
    return result;
  }

  const reviewItems = toReviewItems(rawResults);
  if (reviewItems.length === 0) {
    return result;
  }

  try {
    emitSearchMetadata(options.context, "Agent Review 审查搜索结果", {
      mode: options.mode,
      query: options.query,
      total: reviewItems.length,
    });
    const { config } = await import("@config");
    const appConfig = await config();
    const reviewMaxResults = options.maxResults ?? 10;
    const relevanceThreshold = options.relevanceThreshold ?? 0.5;
    const review = await reviewToolCodebaseSearchResults(appConfig, options.query, reviewItems, {
      maxResults: reviewMaxResults,
      relevanceThreshold,
    });

    if (!review.success) {
      return {
        ...result,
        agentReview: {
          enabled: true,
          error: review.error,
          fallback: true,
          filteredCount: 0,
          originalCount: rawResults.length,
          success: false,
        },
      };
    }

    let reviewedResults = applyReviewedResults(rawResults, review.results);
    const minResults = options.minResults ?? 1;
    const shouldRetry =
      (options.retryEnabled ?? true) && options.mode !== "path" && reviewedResults.length < minResults;
    let retryMeta: Record<string, unknown> | undefined;

    if (review.success && shouldRetry) {
      emitSearchMetadata(options.context, "搜索结果不足，改写查询重试", {
        minResults,
        mode: options.mode,
        query: options.query,
        reviewedCount: reviewedResults.length,
      });
      retryMeta = await retryAgentReviewedSearch({
        appConfig,
        context: options.context,
        cwd: options.cwd,
        exclude: options.exclude,
        include: options.include,
        limit: options.limit,
        mode: options.mode,
        originalQuery: options.query,
        relevanceThreshold,
        rerankTopN: options.rerankTopN,
        reviewMaxResults,
        reviewSearchResults: reviewToolCodebaseSearchResults,
        rewriteCodebaseSearchQuery: rewriteToolCodebaseSearchQuery,
        useRerank: options.useRerank,
      });

      if (Array.isArray(retryMeta.results)) {
        reviewedResults = retryMeta.results.filter(
          (r): r is Record<string, unknown> => typeof r === "object" && r !== null,
        );
      }
      delete retryMeta.results;
    }

    emitSearchMetadata(options.context, "Agent Review 完成", {
      query: options.query,
      retried: retryMeta?.attempted === true,
      reviewedCount: reviewedResults.length,
    });

    return {
      ...result,
      agentReview: {
        enabled: true,
        fallback: false,
        filteredCount: review.filteredCount,
        originalCount: review.originalCount,
        reviewedCount: reviewedResults.length,
        success: true,
        ...(retryMeta ? { retry: retryMeta } : {}),
      },
      results: reviewedResults,
      total: reviewedResults.length,
    };
  } catch (error) {
    const msg = getCodebaseSearchErrorMessage(error);
    log.warn(`Agent Review 失败，回退原始搜索结果: ${msg}`);
    return {
      ...result,
      agentReview: {
        enabled: true,
        error: msg,
        fallback: true,
        filteredCount: 0,
        originalCount: rawResults.length,
        success: false,
      },
    };
  }
}

function applyReviewedResults(
  rawResults: Record<string, unknown>[],
  reviewedItems: ToolFacingReviewedResultItem[],
): Record<string, unknown>[] {
  return reviewedItems.map((item) => {
    const reviewedItem = item as ToolFacingReviewedResultItem & { originalIndex: number };
    const original = rawResults[reviewedItem.originalIndex] ?? {};
    return {
      ...original,
      agentReviewRecommended: reviewedItem.isRecommended,
      relevanceReason: reviewedItem.relevanceReason,
      relevanceScore: reviewedItem.relevanceScore,
    };
  });
}

interface RetryAgentReviewedSearchOptions {
  appConfig: import("@/schema/config").AppConfigSchema;
  originalQuery: string;
  mode: string;
  cwd: string;
  include?: string;
  exclude?: string[];
  limit: number;
  useRerank: boolean;
  rerankTopN: number;
  reviewMaxResults: number;
  relevanceThreshold: number;
  context?: ToolContext;
  rewriteCodebaseSearchQuery: typeof rewriteToolCodebaseSearchQuery;
  reviewSearchResults: typeof reviewToolCodebaseSearchResults;
}

async function retryAgentReviewedSearch(options: RetryAgentReviewedSearchOptions): Promise<Record<string, unknown>> {
  try {
    const retryQuery = await options.rewriteCodebaseSearchQuery(options.appConfig, options.originalQuery, {
      cwd: options.cwd,
      include: options.include,
      mode: options.mode,
    });
    if (!retryQuery || retryQuery.trim() === "" || retryQuery.trim() === options.originalQuery.trim()) {
      return {
        attempted: true,
        query: retryQuery,
        reason: "rewrite-empty-or-same",
        skipped: true,
        success: false,
      };
    }

    const retryLimit = Math.max(options.limit * 2, options.reviewMaxResults * 3, 30);
    emitSearchMetadata(options.context, "代码库补充搜索中", {
      limit: retryLimit,
      mode: options.mode,
      originalQuery: options.originalQuery,
      query: retryQuery,
    });
    const retryResult = await runCodebaseSearch({
      cwd: options.cwd,
      exclude: options.exclude,
      include: options.include,
      limit: retryLimit,
      mode: options.mode,
      query: retryQuery,
      rerankTopN: Math.max(options.rerankTopN, options.reviewMaxResults),
      useRerank: options.useRerank,
    });
    const retryRawResults = Array.isArray(retryResult.results)
      ? retryResult.results.filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
      : [];
    const retryReviewItems = toReviewItems(retryRawResults);
    if (retryReviewItems.length === 0) {
      return {
        attempted: true,
        originalResultCount: retryRawResults.length,
        query: retryQuery,
        reason: "no-reviewable-results",
        reviewedCount: 0,
        success: false,
      };
    }

    const retryReview = await options.reviewSearchResults(options.appConfig, options.originalQuery, retryReviewItems, {
      maxResults: options.reviewMaxResults,
      relevanceThreshold: options.relevanceThreshold,
    });
    if (!retryReview.success) {
      return {
        attempted: true,
        error: retryReview.error,
        originalResultCount: retryRawResults.length,
        query: retryQuery,
        reviewedCount: 0,
        success: false,
      };
    }

    return {
      attempted: true,
      filteredCount: retryReview.filteredCount,
      originalResultCount: retryRawResults.length,
      query: retryQuery,
      results: applyReviewedResults(retryRawResults, retryReview.results),
      reviewedCount: retryReview.results.length,
      success: true,
    };
  } catch (error) {
    const msg = getCodebaseSearchErrorMessage(error);
    return {
      attempted: true,
      error: msg,
      success: false,
    };
  }
}

async function readAgentReviewSetting(cwd: string): Promise<boolean> {
  try {
    const { readMergedSettings } = await import("@config");
    return readMergedSettings(cwd).codebase?.enableAgentReview === true;
  } catch (error) {
    log.debug("读取 Agent Review 设置失败，默认关闭", {
      cwd,
      error: getCodebaseSearchErrorMessage(error),
    });
    return false;
  }
}

function toReviewItems(results: Record<string, unknown>[]): ReviewableSearchItem[] {
  const items: ReviewableSearchItem[] = [];

  results.forEach((item, index) => {
    const filePath = asString(item.filePath) ?? asString(item.file) ?? asString(item.path);
    if (!filePath) {
      return;
    }

    const content =
      asString(item.content) ??
      asString(item.text) ??
      asString(item.signature) ??
      asString(item.name) ??
      JSON.stringify(item);

    items.push({
      content,
      filePath,
      lineRange:
        typeof item.line === "number"
          ? { end: typeof item.endLine === "number" ? item.endLine : item.line, start: item.line }
          : undefined,
      matchType: normalizeMatchType(asString(item.type) ?? asString(item.source)),
      originalIndex: index,
      score: typeof item.score === "number" ? item.score : undefined,
    });
  });

  return items;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeMatchType(value?: string): ReviewableSearchItem["matchType"] {
  if (value === "semantic" || value === "text" || value === "symbol" || value === "reference") {
    return value;
  }
  if (value === "ace-symbol" || value === "ace-grep") {
    return "symbol";
  }
  if (value === "exact") {
    return "text";
  }
  return undefined;
}
