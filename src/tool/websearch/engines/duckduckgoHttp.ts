/**
 * DuckDuckGo HTTP 搜索引擎 — 免费兜底，无需 API Key。
 *
 * 职责:
 *   - 通过 DuckDuckGo HTML 版搜索获取结果
 *   - 解析 HTML 提取标题、URL、摘要
 *   - HTML 标签去除和实体解码
 */

import { createLogger } from "@/core/logging/logger";
import type { SearchResult } from "../apiTypes";
import { stripHtmlTags } from "@/tool/shared";
import { formatResults, truncateIfNeeded, REQUEST_TIMEOUT } from "../utils";

const log = createLogger("tool:websearch");

/**
 * 尝试使用 DuckDuckGo HTML 搜索。
 * @returns 搜索结果或 null（解析无结果或请求失败时）
 */
export async function tryDuckDuckGo(query: string, maxResults: number): Promise<Record<string, unknown> | null> {
  log.info(`DuckDuckGo 搜索: ${query}`);

  try {
    // DuckDuckGo HTML 版搜索(无 API Key 需求)
    // 使用 kl=wt-wt 禁用安全搜索，df= 获取更广泛结果
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=wt-wt`;

    const response = await fetch(searchUrl, {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });

    if (!response.ok) {
      log.warn(`DuckDuckGo 请求失败: ${response.status}`);
      return null;
    }

    const html = await response.text();
    const results = parseDuckDuckGoHtml(html, maxResults);

    if (results.length === 0) {
      log.warn("DuckDuckGo 未解析到结果");
      return null;
    }

    log.info(`DuckDuckGo 搜索完成: ${results.length} 条结果`);

    return {
      content: truncateIfNeeded(formatResults(results)),
      engine: "duckduckgo",
      note: "使用 DuckDuckGo 免费搜索(可能存在速率限制)",
      query,
      results,
      total: results.length,
    };
  } catch (error) {
    log.warn(`DuckDuckGo 搜索失败: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** 解析 DuckDuckGo HTML 结果 */
function parseDuckDuckGoHtml(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];

  // 匹配 DuckDuckGo HTML 结果项
  // 每个结果包含在 .result 或 .web-result 类中
  const resultRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;

  const titles: string[] = [];
  const urls: string[] = [];
  const snippets: string[] = [];

  // 提取标题和 URL
  let match;
  while ((match = resultRegex.exec(html)) !== null && urls.length < maxResults) {
    const url = decodeHtmlEntities(match[1] ?? "");
    const title = stripHtmlTags(match[2] ?? "").trim();

    // 跳过 DuckDuckGo 内部链接
    if (url.startsWith("http") && !url.includes("duckduckgo.com")) {
      urls.push(url);
      titles.push(title);
    }
  }

  // 提取摘要
  while ((match = snippetRegex.exec(html)) !== null && snippets.length < maxResults) {
    const snippet = stripHtmlTags(match[1] ?? "").trim();
    snippets.push(snippet);
  }

  // 组合结果
  for (let i = 0; i < Math.min(urls.length, titles.length, maxResults); i++) {
    results.push({
      snippet: snippets[i] ?? "",
      title: titles[i] || "无标题",
      url: urls[i] ?? "",
    });
  }

  return results;
}

/** 解码 HTML 实体（stripHtmlTags 已处理基本标签，此处处理 URL 中的实体） */
function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    "&#39;": "'",
    "&amp;": "&",
    "&gt;": ">",
    "&lt;": "<",
    "&nbsp;": " ",
    "&quot;": '"',
  };
  return text.replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (match) => entities[match] || match);
}
