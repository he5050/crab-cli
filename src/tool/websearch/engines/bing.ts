/**
 * Bing 搜索引擎 — HTTP fetch 实现，无浏览器依赖
 *
 * 职责:
 *   - 通过 HTTP fetch 执行 Bing 搜索
 *   - 使用正则表达式解析 Bing HTML 结构
 *   - 提取搜索结果的标题、URL 和摘要
 *
 * 模块功能:
 *   - bingEngine.search:使用 HTTP fetch 执行 Bing 搜索
 *   - cleanText:清理 HTML 标签和实体
 *
 * 使用场景:
 *   - 轻量级搜索，无需浏览器依赖
 *   - Serverless 或资源受限环境
 *   - 快速原型开发
 *
 * 边界:
 * 1. 使用 HTTP fetch 替代 Puppeteer，无浏览器依赖
 * 2. HTML 解析使用正则提取，与 DuckDuckGo 引擎一致
 * 3. Bing HTML 结构:有机结果在 <li class="b_algo"> 中，链接在 <h2><a> 中
 * 4. 自动跳过广告结果(b_ad, b_adlabel, b_ad_text)
 *
 * 流程:
 * 1. 构造 Bing 搜索 URL 并发送 HTTP 请求
 * 2. 获取响应 HTML 并使用正则提取结果块
 * 3. 从每个结果块提取标题、URL 和摘要
 * 4. 清理 HTML 实体并返回格式化结果
 */

import type { SearchEngine, SearchResult } from "./types";
import { createLogger } from "@/core/logging/logger";
import { stripHtmlTags } from "@/tool/shared";

const log = createLogger("tool:websearch:bing");

/** bingEngine */
export const bingEngine: SearchEngine = {
  id: "bing",
  name: "Bing",

  async search(query: string, maxResults: number): Promise<SearchResult[]> {
    try {
      const encodedQuery = encodeURIComponent(query);
      const count = Math.max(maxResults, 10);
      const url = `https://www.bing.com/search?q=${encodedQuery}&count=${count}&setlang=en&cc=us`;

      const response = await fetch(url, {
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        redirect: "follow",
      });

      if (!response.ok) {
        log.warn("Bing 搜索请求失败", {
          payload: { status: response.status },
        });
        return [];
      }

      const html = await response.text();
      const results: SearchResult[] = [];

      // 提取 <li class="b_algo"> 块
      const algoRegex = /<li\s+class="b_algo"[^>]*>([\s\S]*?)<\/li>/gi;
      let algoMatch: RegExpExecArray | null;

      while ((algoMatch = algoRegex.exec(html)) !== null) {
        if (results.length >= maxResults) {
          break;
        }

        const block = algoMatch[1]!;

        // 跳过广告
        if (block.includes('class="b_ad"') || block.includes("b_adlabel") || block.includes("b_ad_text")) {
          continue;
        }

        // 提取链接和标题(h2 > a)
        const linkRegex = /<h2[^>]*>\s*<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i;
        const linkMatch = linkRegex.exec(block);

        if (!linkMatch) {
          continue;
        }

        const resultUrl = linkMatch[1]!;
        const titleHtml = linkMatch[2]!;

        // 跳过非 HTTP 链接
        if (!/^https?:\/\//i.test(resultUrl)) {
          continue;
        }

        const title = stripHtmlTags(titleHtml);
        if (!title) {
          continue;
        }

        // 提取摘要:尝试多个选择器
        let snippet = "";
        const snippetPatterns = [
          /class="b_caption"[^>]*>\s*<p[^>]*>([\s\S]*?)<\/p>/i,
          /class="b_caption"[^>]*>([\s\S]*?)<\/div>/i,
          /class="b_snippet"[^>]*>([\s\S]*?)<\/div>/i,
          /class="b_lineclamp2?"[^>]*>([\s\S]*?)<\/p>/i,
        ];

        for (const pattern of snippetPatterns) {
          const snippetMatch = pattern.exec(block);
          if (snippetMatch) {
            snippet = stripHtmlTags(snippetMatch[1]!);
            if (snippet) {
              break;
            }
          }
        }

        results.push({
          snippet: snippet || undefined,
          source: "bing",
          title,
          url: resultUrl,
        });
      }

      return results;
    } catch (error) {
      log.warn("Bing 搜索失败", { payload: { error: String(error) } });
      return [];
    }
  },
};
