/**
 * Rerank API — 搜索结果重排序。
 *
 * 职责:
 *   - 对候选文档进行相关性重排序
 *   - 通过 @ai-sdk RerankingModelV3 调用 Provider 的 Rerank 端点
 *   - 支持 OpenAI 兼容接口
 *
 * 模块功能:
 *   - rerank: 对文档进行重排序（通过 @ai-sdk rerank()）
 *   - RerankRequest: Rerank 请求接口
 *   - RerankResultItem: Rerank 结果项接口
 *   - RerankResult: Rerank 结果接口
 *
 * 使用场景:
 *   - 搜索结果重排序
 *   - 文档相关性排序
 *   - 提升搜索质量
 *
 * 边界:
 *   1. 仅提供 Rerank 调用，不涉及文档检索
 *   2. 通过 RerankingModelV3 接口调用 Provider 的 /rerank 端点
 *   3. 支持 OpenAI 兼容接口的 /rerank 端点
 *   4. 需要 Provider 配置 baseURL
 *
 * 流程:
 *   1. 构建 Rerank 请求
 *   2. 创建 RerankingModelV3 实例
 *   3. 调用 @ai-sdk rerank() 函数
 *   4. 映射结果并返回
 */
import { rerank as aiRerank } from "ai";
import type { RerankingModelV3 } from "@ai-sdk/provider";
import type { AppConfigSchema, SingleProviderConfig } from "@/schema/config";
import { createLogger } from "@/core/logging/logger";
import { createInternalError } from "@/core/errors/appError";
import { estimateTextTokens as estimateTokens } from "../utils/tokenEstimator";
import { toApiAppError } from "../core/errorHandler";
import { fetchWithTimeout } from "../utils/fetchTimeout";

const log = createLogger("rerank");

/** Rerank 请求 */
export interface RerankRequest {
  /** 查询文本 */
  query: string;
  /** 候选文档 */
  documents: string[];
  /** 返回数量上限 */
  topN?: number;
  /** 使用的模型 */
  model?: string;
  /** 指定使用的 Provider ID（默认使用 defaultProvider.provider） */
  providerId?: string;
}

/** Rerank 结果项 */
export interface RerankResultItem {
  /** 文档索引 */
  index: number;
  /** 相关性分数 */
  relevanceScore: number;
  /** 文档文本 */
  document: string;
}

/** Rerank 结果 */
export interface RerankResult {
  /** 重排序结果 */
  results: RerankResultItem[];
  /** 使用的模型 */
  model: string;
}

export interface FitDocumentsOptions {
  /** 查询文本 */
  query: string;
  /** 最大上下文 Token */
  maxContextTokens: number;
  /** 单文档最大占比 */
  maxDocumentRatio: number;
}

export interface FittedDocument {
  /** 发送给 rerank API 的文档 */
  document: string;
  /** 原始文档索引 */
  originalIndex: number;
  /** 文档是否被截断 */
  truncated: boolean;
}

export interface FitDocumentsResult {
  /** 裁剪后的文档 */
  documents: string[];
  /** 裁剪后文档对应的原始索引 */
  originalIndices: number[];
  /** 被截断的文档数量 */
  truncatedCount: number;
  /** 被丢弃的文档数量 */
  droppedCount: number;
  /** 预留给文档的 token 预算 */
  budgetTokens: number;
}

function resolveRerankContextTokens(config: AppConfigSchema): number {
  const rerankConfig = config.rerank;
  // 兼容旧配置格式 codebase.reranking.contextLength，通过运行时检查读取
  const rawConfig = config as unknown as Record<string, unknown>;
  const rawCodebase = rawConfig.codebase as Record<string, unknown> | undefined;
  const rawReranking = rawCodebase?.reranking as Record<string, unknown> | undefined;
  const compatContextLength = typeof rawReranking?.contextLength === "number" ? rawReranking.contextLength : undefined;

  return rerankConfig?.maxContextTokens ?? compatContextLength ?? config.maxContextTokens ?? 200_000;
}

function resolveRerankDocumentRatio(config: AppConfigSchema): number {
  return config.rerank?.maxDocumentRatio ?? 0.3;
}

function truncateToTokenBudget(text: string, maxTokens: number): string {
  if (maxTokens <= 0 || !text) {
    return "";
  }
  if (estimateTokens(text) <= maxTokens) {
    return text;
  }

  let low = 0;
  let high = text.length;
  let best = "";

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = text.slice(0, mid);
    const tokens = estimateTokens(candidate);

    if (tokens <= maxTokens) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best;
}

export function fitDocumentsToContext(documents: string[], options: FitDocumentsOptions): FitDocumentsResult {
  const contextBudget = Math.max(0, Math.floor(options.maxContextTokens * 0.95) - estimateTokens(options.query));
  const maxSingleDocumentTokens = Math.max(1, Math.floor(options.maxContextTokens * options.maxDocumentRatio));

  const fittedDocuments: string[] = [];
  const originalIndices: number[] = [];
  let remainingTokens = contextBudget;
  let truncatedCount = 0;

  for (let i = 0; i < documents.length; i += 1) {
    if (remainingTokens <= 0) {
      break;
    }

    const document = documents[i] ?? "";
    const documentTokens = estimateTokens(document);
    const effectiveTokens = Math.min(documentTokens, maxSingleDocumentTokens);

    if (effectiveTokens > remainingTokens) {
      break;
    }

    if (documentTokens <= maxSingleDocumentTokens) {
      fittedDocuments.push(document);
      originalIndices.push(i);
      remainingTokens -= documentTokens;
      continue;
    }

    const fittedDocument = truncateToTokenBudget(document, maxSingleDocumentTokens);
    if (!fittedDocument) {
      break;
    }

    fittedDocuments.push(fittedDocument);
    originalIndices.push(i);
    remainingTokens -= estimateTokens(fittedDocument);
    truncatedCount += 1;
  }

  return {
    budgetTokens: contextBudget,
    documents: fittedDocuments,
    droppedCount: Math.max(0, documents.length - fittedDocuments.length),
    originalIndices,
    truncatedCount,
  };
}

/**
 * 创建 @ai-sdk RerankingModelV3 实例。
 * 将 fetch 调用封装在 doRerank 方法中，供 @ai-sdk rerank() 调用。
 */
function createRerankingModel(providerId: string, modelId: string, pConfig: SingleProviderConfig): RerankingModelV3 {
  const baseUrl = (pConfig.baseURL ?? "").replace(/\/$/, "");
  if (!baseUrl) {
    throw createInternalError("INTERNAL_ERROR", `Rerank 需要 Provider ${providerId} 配置 baseURL`);
  }
  return {
    specificationVersion: "v3",
    provider: providerId,
    modelId,
    doRerank: async ({ documents, query, topN, abortSignal }) => {
      const res = await fetchWithTimeout(`${baseUrl}/rerank`, {
        abortSignal,
        body: JSON.stringify({
          documents: documents.values,
          model: modelId,
          query,
          top_n: topN,
        }),
        headers: {
          "Content-Type": "application/json",
          ...(pConfig.apiKey ? { Authorization: `Bearer ${pConfig.apiKey}` } : {}),
        },
        method: "POST",
        timeoutMs: 60_000,
      });

      if (!res.ok) {
        const body = await res.text();
        log.error(`Rerank API 失败: ${res.status} ${body.slice(0, 200)}`);
        const err = new Error(`Rerank API failed`) as Error & Record<string, unknown>;
        err.status = res.status;
        err.body = body.slice(0, 500);
        err.providerId = providerId;
        err.url = `${baseUrl}/rerank`;
        throw err;
      }

      const data = (await res.json()) as {
        results?: Array<{ index?: number; relevance_score?: number; score?: number }>;
        data?: Array<{ index?: number; relevance_score?: number; score?: number }>;
        model?: string;
      };

      // 构造符合 RerankingModelV3.doRerank 返回类型的结果对象。
      // 注意: @ai-sdk 的 providerMetadata 类型为 SharedV3ProviderMetadata（Record<string, JSONObject>），
      // 而 responseModel 为 string，类型不兼容。此处对整个返回值做最小范围断言，
      // 待 @ai-sdk 修复 providerMetadata 类型后可移除此断言。
      const responseModel = data.model && data.model !== modelId ? data.model : undefined;
      const result = {
        ranking: (data.results ?? data.data ?? []).map((item, i) => ({
          index: item.index ?? i,
          relevanceScore: item.relevance_score ?? item.score ?? 0,
        })),
        ...(responseModel ? { providerMetadata: { responseModel } } : {}),
        response: { headers: undefined, body: undefined },
      };
      return result as Awaited<ReturnType<NonNullable<RerankingModelV3["doRerank"]>>>;
    },
  };
}

/**
 * 对文档进行重排序。
 * 通过 @ai-sdk RerankingModelV3 接口调用 Provider 的 /rerank 端点。
 *
 * @param config - 应用配置
 * @param request - Rerank 请求
 * @returns Rerank 结果
 */
export async function rerank(config: AppConfigSchema, request: RerankRequest): Promise<RerankResult> {
  const providerId = request.providerId ?? config.defaultProvider.provider;
  const pConfig = config.providerConfig[providerId];

  if (!pConfig?.baseURL) {
    throw createInternalError("INTERNAL_ERROR", `Rerank 需要 Provider ${providerId} 配置 baseURL`);
  }

  // 边界条件：查询文本不能为空
  if (!request.query || request.query.trim().length === 0) {
    throw new Error("rerank: 查询文本不能为空");
  }

  // 边界条件：文档列表不能为空
  if (!request.documents || request.documents.length === 0) {
    throw new Error("rerank: 文档列表不能为空");
  }

  // 边界条件：文档数量上限（避免 API 拒绝）
  // 使用局部副本，避免突变调用方的原始数组
  const MAX_DOCUMENTS = 1000;
  const documents =
    request.documents.length > MAX_DOCUMENTS
      ? (() => {
          log.warn(`文档数量过多 (${request.documents.length})，截断至 ${MAX_DOCUMENTS}`, {
            eventType: "rerank.too-many-documents",
            count: request.documents.length,
            maxCount: MAX_DOCUMENTS,
          });
          return request.documents.slice(0, MAX_DOCUMENTS);
        })()
      : request.documents;

  const modelName = request.model ?? config.rerank?.defaultModel ?? "rerank-v3.5";
  const fitted = fitDocumentsToContext(documents, {
    maxContextTokens: resolveRerankContextTokens(config),
    maxDocumentRatio: resolveRerankDocumentRatio(config),
    query: request.query,
  });

  log.debug(
    `Rerank 调用: model=${modelName}, docs=${documents.length}, fitted=${fitted.documents.length}, truncated=${fitted.truncatedCount}, dropped=${fitted.droppedCount}`,
  );

  if (fitted.documents.length === 0) {
    return {
      model: modelName,
      results: [],
    };
  }

  const model = createRerankingModel(providerId, modelName, pConfig);

  try {
    const result = await aiRerank({
      model,
      documents: fitted.documents,
      query: request.query,
      topN: Math.min(request.topN ?? fitted.documents.length, fitted.documents.length),
      maxRetries: 0,
    });

    const pm = result.providerMetadata as Record<string, unknown> | undefined;
    const responseModel = pm?.responseModel as string | undefined;

    return {
      model: responseModel ?? modelName,
      results: result.ranking.map((r) => {
        const originalIndex = fitted.originalIndices[r.originalIndex] ?? r.originalIndex;
        return {
          document: r.document as string,
          index: originalIndex,
          relevanceScore: r.score,
        };
      }),
    };
  } catch (err) {
    const e = err as Record<string, unknown>;
    throw toApiAppError(err, {
      body: e.body,
      providerId,
      url: e.url,
    });
  }
}

/** @internal 仅用于测试 */
export const _compatForTesting = {
  truncateToTokenBudget,
  resolveRerankContextTokens,
  resolveRerankDocumentRatio,
};
