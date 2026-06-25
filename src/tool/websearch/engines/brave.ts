/**
 * Brave Search 搜索引擎 — 使用 Brave Web Search API。
 *
 * 职责:
 *   - 调用 Brave Search API
 *   - 认证失败(401/403)返回错误而非降级
 */

import { createLogger } from "@/core/logging/logger";
import type { BraveResponse, BraveResult, SearchResult } from "../apiTypes";
import { formatResults, truncateIfNeeded, REQUEST_TIMEOUT } from "../utils";

const log = createLogger("tool:websearch");

/**
 * 尝试使用 Brave Search API 搜索。
 * @returns 搜索结果或 null（未配置 API Key 时）
 */
export async function tryBrave(query: string, maxResults: number): Promise<Record<string, unknown> | null> {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) {
    return null;
  }

  log.info(`Brave 搜索: ${query}`);

  try {
    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`,
      {
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": apiKey,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      },
    );

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        log.error(`Brave 认证失败 (${response.status})，请检查 API Key`);
        return {
          engine: "brave",
          error: `Brave API 认证失败 (${response.status})，请检查 BRAVE_API_KEY`,
          query,
          results: [],
          total: 0,
        };
      }
      return null;
    }

    const data = (await response.json()) as BraveResponse;
    const results: SearchResult[] = (data.web?.results ?? []).map((r: BraveResult) => ({
      snippet: r.description ?? "",
      title: r.title ?? "",
      url: r.url ?? "",
    }));

    return {
      content: truncateIfNeeded(formatResults(results)),
      engine: "brave",
      query,
      results,
      total: results.length,
    };
  } catch {
    return null;
  }
}
