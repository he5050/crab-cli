/**
 * Tavily 搜索引擎 — 适合 AI 场景的搜索 API。
 *
 * 职责:
 *   - 调用 Tavily Search API
 *   - 支持 searchDepth / includeDomains / excludeDomains
 *   - 认证失败(401/403)返回错误而非降级
 */

import { createLogger } from "@/core/logging/logger";
import type { TavilyResponse, TavilyResult, SearchResult } from "../apiTypes";
import { loadTavilyConfig } from "../config";
import { formatResults, truncateIfNeeded, REQUEST_TIMEOUT } from "../utils";

const log = createLogger("tool:websearch");

/**
 * 尝试使用 Tavily API 搜索。
 * @returns 搜索结果或 null（未配置 API Key 时）
 */
export async function tryTavily(
  query: string,
  maxResults: number,
  searchDepth?: "basic" | "advanced",
  includeDomains?: string[],
  excludeDomains?: string[],
): Promise<Record<string, unknown> | null> {
  const config = await loadTavilyConfig();
  const { apiKey } = config;
  if (!apiKey) {
    return null;
  }

  log.info(`Tavily 搜索: ${query}`);

  try {
    const body: Record<string, unknown> = {
      include_answer: true,
      max_results: maxResults,
      query,
      search_depth: searchDepth ?? "basic",
    };
    if (includeDomains?.length) {
      body.include_domains = includeDomains;
    }
    if (excludeDomains?.length) {
      body.exclude_domains = excludeDomains;
    }

    const baseURL = config.baseURL || "https://api.tavily.com";
    const response = await fetch(`${baseURL}/search`, {
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });

    if (!response.ok) {
      // 401/403 = 认证失败，不应继续降级
      if (response.status === 401 || response.status === 403) {
        log.error(`Tavily 认证失败 (${response.status})，请检查 API Key`);
        return {
          engine: "tavily",
          error: `Tavily API 认证失败 (${response.status})，请检查 TAVILY_API_KEY`,
          query,
          results: [],
          total: 0,
        };
      }
      log.warn(`Tavily API 错误: ${response.status}`);
      return null;
    }

    const data = (await response.json()) as TavilyResponse;
    const results: SearchResult[] = (data.results ?? []).map((r: TavilyResult) => ({
      content: r.raw_content ?? undefined,
      snippet: r.content ?? r.snippet ?? "",
      title: r.title ?? "",
      url: r.url ?? "",
    }));

    const answer = data.answer;
    let output = "";
    if (answer) {
      output += `## 摘要\n${answer}\n\n`;
    }
    output += formatResults(results);

    return {
      results,
      total: results.length,
      query,
      engine: "tavily",
      ...(answer && { answer }),
      content: truncateIfNeeded(output),
    };
  } catch (error) {
    log.warn(`Tavily 搜索失败: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
