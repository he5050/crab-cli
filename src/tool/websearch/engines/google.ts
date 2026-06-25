/**
 * Google Custom Search 搜索引擎 — 使用 Google Programmable Search Engine API。
 *
 * 职责:
 *   - 调用 Google Custom Search API
 *   - 需要 GOOGLE_API_KEY 和 GOOGLE_CX 环境变量
 *   - 认证失败(401/403)返回错误而非降级
 */

import { createLogger } from "@/core/logging/logger";
import type { GoogleResponse, GoogleResult, SearchResult } from "../apiTypes";
import { formatResults, truncateIfNeeded, REQUEST_TIMEOUT } from "../utils";

const log = createLogger("tool:websearch");

/**
 * 尝试使用 Google Custom Search API 搜索。
 * @returns 搜索结果或 null（未配置 API Key/CX 时）
 */
export async function tryGoogle(query: string, maxResults: number): Promise<Record<string, unknown> | null> {
  const apiKey = process.env.GOOGLE_API_KEY;
  const cx = process.env.GOOGLE_CX;
  if (!apiKey || !cx) {
    return null;
  }

  log.info(`Google 搜索: ${query}`);

  try {
    const response = await fetch(
      `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}&num=${maxResults}`,
      { signal: AbortSignal.timeout(REQUEST_TIMEOUT) },
    );

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        log.error(`Google 认证失败 (${response.status})，请检查 API Key`);
        return {
          engine: "google",
          error: `Google API 认证失败 (${response.status})，请检查 GOOGLE_API_KEY 和 GOOGLE_CX`,
          query,
          results: [],
          total: 0,
        };
      }
      return null;
    }

    const data = (await response.json()) as GoogleResponse;
    const results: SearchResult[] = (data.items ?? []).map((r: GoogleResult) => ({
      snippet: r.snippet ?? "",
      title: r.title ?? "",
      url: r.link ?? "",
    }));

    return {
      content: truncateIfNeeded(formatResults(results)),
      engine: "google",
      query,
      results,
      total: results.length,
    };
  } catch {
    return null;
  }
}
