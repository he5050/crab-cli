/**
 * DuckDuckGo 浏览器搜索引擎 — 使用 Puppeteer Page 执行搜索
 *
 * 职责:
 *   - 通过 Puppeteer 浏览器自动化执行 DuckDuckGo 搜索
 *   - 解析 DuckDuckGo lite 端点的 HTML 表格结构
 *   - 提取搜索结果的标题、URL 和摘要
 *
 * 模块功能:
 *   - duckduckgoBrowserEngine.search:使用 Puppeteer 执行 DuckDuckGo 搜索
 *   - cleanText:清理 HTML 标签和实体
 *
 * 使用场景:
 *   - 需要完整浏览器环境执行 JavaScript 渲染页面的搜索
 *   - DuckDuckGo 搜索结果需要动态加载的场景
 *   - 需要绕过某些地区限制时
 *
 * 边界:
 * 1. 使用 lite.duckduckgo.com/lite 端点(纯 HTML 表格，无重 JS 依赖)
 * 2. DOM 结构:结果在 <table> 的 <tr> 行中，标题链接 a.result-link，摘要 td.result-snippet
 * 3. 自动解码 DuckDuckGo 重定向包装中的实际 URL
 * 4. 使用 networkidle2 等待网络空闲
 *
 * 流程:
 * 1. 获取 BrowserManager 实例并创建新页面
 * 2. 导航到 DuckDuckGo lite 搜索页面
 * 3. 通过 page.evaluate 提取搜索结果
 * 4. 解码重定向 URL 并清理 HTML 标签
 * 5. 返回格式化结果
 */

import type { SearchEngine, SearchResult } from "./types";
import { BrowserManager } from "../browser";
import { createLogger } from "@/core/logging/logger";
import { stripHtmlTags } from "@/tool/shared";

const log = createLogger("tool:websearch:duckduckgo-browser");

/** duckduckgoBrowserEngine */
export const duckduckgoBrowserEngine: SearchEngine = {
  id: "duckduckgo",
  name: "DuckDuckGo (Browser)",

  async search(query: string, maxResults: number): Promise<SearchResult[]> {
    const manager = BrowserManager.getInstance();
    if (!manager.isAvailable()) {
      return [];
    }

    let page: any = null;

    try {
      page = await manager.newPage();

      const encodedQuery = encodeURIComponent(query);
      const searchUrl = `https://lite.duckduckgo.com/lite?q=${encodedQuery}`;

      await page.goto(searchUrl, {
        timeout: 30_000,
        waitUntil: "networkidle2",
      });

      // @ts-ignore — page.evaluate 在浏览器环境中执行，有 DOM API
      const results = await page.evaluate((maxLimit: number) => {
        interface Partial {
          title?: string;
          url?: string;
          snippet?: string;
          displayUrl?: string;
        }
        const searchResults: Partial[] = [];
        const rows = [...document.querySelectorAll("table tr")];

        let currentResult: Partial = {};
        let resultCount = 0;

        for (const row of rows) {
          if (resultCount >= maxLimit) {
            break;
          }

          // 标题行包含结果链接
          const linkElement = row.querySelector("a.result-link");
          if (linkElement) {
            if (currentResult.title && currentResult.url) {
              searchResults.push(currentResult);
              resultCount++;
              if (resultCount >= maxLimit) {
                break;
              }
            }

            const title = linkElement.textContent?.trim() || "";
            const href = linkElement.getAttribute("href") || "";

            // 解码 DuckDuckGo 重定向包装中的实际 URL
            let actualUrl = href;
            if (href.includes("uddg=")) {
              const match = href.match(/uddg=([^&]+)/);
              if (match && match[1]) {
                actualUrl = decodeURIComponent(match[1]);
              }
            }

            currentResult = {
              displayUrl: "",
              snippet: "",
              title,
              url: actualUrl,
            };
            continue;
          }

          const snippetElement = row.querySelector("td.result-snippet");
          if (snippetElement && currentResult.title) {
            currentResult.snippet = snippetElement.textContent?.trim() || "";
            continue;
          }

          const displayUrlElement = row.querySelector("span.link-text");
          if (displayUrlElement && currentResult.title) {
            currentResult.displayUrl = displayUrlElement.textContent?.trim() || "";
          }
        }

        if (currentResult.title && currentResult.url && resultCount < maxLimit) {
          searchResults.push(currentResult);
        }

        return searchResults;
      }, maxResults);

      return results.map((r: any) => ({
        snippet: stripHtmlTags(r.snippet || ""),
        source: "duckduckgo",
        title: stripHtmlTags(r.title || ""),
        url: r.url || "",
      }));
    } catch (error) {
      log.warn("DuckDuckGo 浏览器搜索失败", { payload: { error: String(error) } });
      return [];
    } finally {
      if (page) {
        try {
          await page.close();
        } catch {
          // Ignore
        }
      }
    }
  },
};
