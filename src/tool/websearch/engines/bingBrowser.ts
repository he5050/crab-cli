/**
 * Bing 浏览器搜索引擎 — 使用 Puppeteer Page 执行搜索
 *
 * 职责:
 *   - 通过 Puppeteer 浏览器自动化执行 Bing 搜索
 *   - 解析 Bing 搜索结果的 DOM 结构
 *   - 提取标题、URL、摘要和显示 URL
 *
 * 模块功能:
 *   - bingBrowserEngine.search:使用 Puppeteer 执行 Bing 搜索
 *   - cleanText:清理 HTML 标签和实体
 *
 * 使用场景:
 *   - 需要完整浏览器环境执行 JavaScript 渲染页面的搜索
 *   - Bing 页面需要动态加载内容的场景
 *   - 无 HTTP fetch 环境时的备选方案
 *
 * 边界:
 * 1. 依赖 BrowserManager 提供的 Puppeteer 实例
 * 2. 使用 lite.duckduckgo.com 端点(lite 端点，纯 HTML)
 * 3. Bing DOM 结构:有机结果在 li.b_algo 中，链接在 .b_tpcn a.tilk 或 h2 > a 中
 * 4. 使用 domcontentloaded 而非 networkidle2 避免超时
 *
 * 流程:
 * 1. 获取 BrowserManager 实例并创建新页面
 * 2. 导航到 Bing 搜索页面并等待 DOM 加载
 * 3. 通过 page.evaluate 提取搜索结果
 * 4. 清理 HTML 标签并返回格式化结果
 */

import type { SearchEngine, SearchResult } from "./types";
import { BrowserManager } from "../browser";
import { createLogger } from "@/core/logging/logger";
import { stripHtmlTags } from "@/tool/shared";

const log = createLogger("tool:websearch:bing-browser");

/** bingBrowserEngine */
export const bingBrowserEngine: SearchEngine = {
  id: "bing",
  name: "Bing (Browser)",

  async search(query: string, maxResults: number): Promise<SearchResult[]> {
    const manager = BrowserManager.getInstance();
    if (!manager.isAvailable()) {
      return [];
    }

    let page: any = null;

    try {
      page = await manager.newPage();

      const encodedQuery = encodeURIComponent(query);
      const count = Math.max(maxResults, 10);
      const searchUrl = `https://www.bing.com/search?q=${encodedQuery}` + `&count=${count}&setlang=en&cc=us`;

      try {
        await page.goto(searchUrl, {
          timeout: 30_000,
          waitUntil: "domcontentloaded",
        });
      } catch {
        // 导航超时 — 尝试提取已加载的内容
      }

      // 等待结果容器
      try {
        await page.waitForSelector("#b_results li.b_algo", { timeout: 10_000 });
      } catch {
        try {
          await page.waitForSelector("#b_results", { timeout: 3000 });
        } catch {
          // 等不到也不报错，提取会返回空
        }
      }

      // @ts-ignore — page.evaluate 在浏览器环境中执行，有 DOM API
      const results = await page.evaluate((maxLimit: number) => {
        interface Partial {
          title?: string;
          url?: string;
          snippet?: string;
          displayUrl?: string;
        }

        const out: Partial[] = [];
        const items = [...document.querySelectorAll("#b_results > li.b_algo")];

        const isHttpUrl = (u: string): boolean => /^https?:\/\//i.test(u);

        for (const item of items) {
          if (out.length >= maxLimit) {
            break;
          }

          // 跳过广告
          if (item.classList.contains("b_ad") || item.querySelector(".b_adlabel, .b_ad_text")) {
            continue;
          }

          // 提取链接和标题
          const tilkEl = item.querySelector(".b_tpcn a.tilk") as HTMLAnchorElement | null;
          const headingEl = item.querySelector("h2 a") as HTMLAnchorElement | null;

          const linkEl = tilkEl ?? headingEl;
          if (!linkEl) {
            continue;
          }

          const url = linkEl.getAttribute("href") || "";
          if (!url || !isHttpUrl(url)) {
            continue;
          }

          let title = headingEl?.textContent?.trim() || "";
          if (!title) {
            title = tilkEl?.getAttribute("aria-label")?.trim() || tilkEl?.textContent?.trim() || "";
          }
          if (!title) {
            continue;
          }

          // 摘要
          let snippet = "";
          const snippetCandidates = [
            ".b_caption p.b_lineclamp2",
            ".b_caption p",
            ".b_richcard .b_caption",
            ".b_snippet",
            ".b_caption",
            ".b_paractl",
          ];
          for (const sel of snippetCandidates) {
            const el = item.querySelector(sel);
            const txt = el?.textContent?.trim();
            if (txt) {
              snippet = txt;
              break;
            }
          }

          // 显示 URL
          const citeEl = item.querySelector(".b_attribution cite") || item.querySelector("cite");
          const displayUrl = citeEl?.textContent?.trim() || "";

          out.push({ displayUrl, snippet, title, url });
        }

        return out;
      }, maxResults);

      return results.map((r: any) => ({
        snippet: stripHtmlTags(r.snippet || ""),
        source: "bing",
        title: stripHtmlTags(r.title || ""),
        url: r.url || "",
      }));
    } catch (error) {
      log.warn("Bing 浏览器搜索失败", { payload: { error: String(error) } });
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
