/**
 * 网页搜索工具 — 支持 Tavily / Brave / Google Custom Search / DuckDuckGo(免费兜底) / 浏览器引擎(最终兜底)。
 *
 * 职责:
 *   - 执行网页搜索
 *   - 多引擎回退策略
 *   - 搜索结果缓存
 *   - 结果截断处理
 *
 * 模块功能:
 *   - webSearchTool: 网页搜索工具定义
 *   - 多引擎搜索支持
 *   - 浏览器引擎兜底
 *
 * 使用场景:
 *   - AI 需要搜索网络信息
 *   - 获取最新文档
 *   - 查询技术资料
 *
 * 边界:
 *   1. 权限:websearch
 *   2. 优先使用 Tavily(最适合 AI 场景)
 *   3. 回退链:Tavily → Brave → Google → DuckDuckGo → 浏览器引擎
 *   4. 搜索结果缓存 30 秒
 *   5. 超长结果自动截断
 *
 * 流程:
 *   1. 接收搜索查询
 *   2. 按优先级尝试各引擎
 *   3. 获取搜索结果
 *   4. 缓存结果
 *   5. 截断处理(如需要)
 *   6. 返回结果
 */
import { z } from "zod";
import { defineTool } from "@/tool/types";
import { createLogger } from "@/core/logging/logger";
import { BrowserManager } from "./browser";
import { bingBrowserEngine, duckduckgoBrowserEngine, ensureSearchEnginesLoaded, listSearchEngines } from "./engines";
import type { SearchEngine as RegisteredSearchEngine } from "./engines/types";

// 拆分出的子模块
import { getCachedResult, setCachedResult } from "./cache";
import { DEFAULT_MAX_RESULTS } from "./utils";
import { formatResults, truncateIfNeeded, withRetry } from "./utils";
import { tryTavily } from "./engines/tavily";
import { tryBrave } from "./engines/brave";
import { tryGoogle } from "./engines/google";
import { tryDuckDuckGo } from "./engines/duckduckgoHttp";

const log = createLogger("tool:websearch");

/** 网页搜索工具：搜索互联网获取最新信息 */
export const webSearchTool = defineTool({
  description:
    "搜索互联网获取信息。支持自然语言查询。" +
    "返回标题、URL、摘要。适合获取最新信息、查找文档、验证事实。" +
    "优先使用 Tavily API，回退到 Brave Search → Google Custom Search → DuckDuckGo(免费兜底)→ 浏览器引擎(Puppeteer)。",
  execute: async ({ query, maxResults, searchDepth, includeDomains, excludeDomains, engine }) => {
    const limit = maxResults ?? DEFAULT_MAX_RESULTS;

    // 检查缓存
    const cacheKey = `${query}:${limit}:${searchDepth ?? "basic"}:${(includeDomains ?? []).join(",")}:${(excludeDomains ?? []).join(",")}:${engine ?? "auto"}`;
    const cached = getCachedResult(cacheKey);
    if (cached) {
      log.debug(`缓存命中: ${query}`);
      return { ...cached, fromCache: true };
    }

    try {
      if (engine) {
        const requestedEngineResult = await tryRegisteredEngines(query, limit, engine);
        if (requestedEngineResult) {
          setCachedResult(cacheKey, requestedEngineResult);
          return requestedEngineResult;
        }
      }

      // 1. 尝试 Tavily(带重试)
      const tavilyResult = await withRetry(
        () => tryTavily(query, limit, searchDepth, includeDomains, excludeDomains),
        "tavily",
      );
      if (tavilyResult) {
        setCachedResult(cacheKey, tavilyResult);
        return tavilyResult;
      }

      // 2. 尝试 Brave Search(带重试)
      const braveResult = await withRetry(() => tryBrave(query, limit), "brave");
      if (braveResult) {
        setCachedResult(cacheKey, braveResult);
        return braveResult;
      }

      // 3. 回退:Google Custom Search(带重试)
      const googleResult = await withRetry(() => tryGoogle(query, limit), "google");
      if (googleResult) {
        setCachedResult(cacheKey, googleResult);
        return googleResult;
      }

      // 4. 回退:DuckDuckGo HTTP fetch(带重试)
      const ddgResult = await withRetry(() => tryDuckDuckGo(query, limit), "duckduckgo");
      if (ddgResult) {
        setCachedResult(cacheKey, ddgResult);
        return ddgResult;
      }

      // 5. 最终兜底:浏览器引擎(Puppeteer)
      log.info(`所有 API 引擎失败，尝试浏览器引擎: ${query}`);
      const browserResult = await tryBrowserEngines(query, limit);
      if (browserResult) {
        setCachedResult(cacheKey, browserResult);
        return browserResult;
      }

      // 6. 插件/注册表兜底
      const registeredResult = await tryRegisteredEngines(query, limit);
      if (registeredResult) {
        setCachedResult(cacheKey, registeredResult);
        return registeredResult;
      }

      // 7. 全部不可用
      return {
        error: "搜索服务暂时不可用。请稍后重试，或配置 TAVILY_API_KEY 获得更稳定的搜索体验。",
        query,
        results: [],
        total: 0,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error(`搜索失败: ${query}`, { error: msg });
      return { error: msg, query, results: [], total: 0 };
    }
  },
  name: "websearch",
  parameters: z.object({
    /** 指定插件/注册表搜索引擎 */
    engine: z.string().optional().describe("指定搜索引擎 ID(支持插件搜索引擎)"),
    /** 排除域名过滤 */
    excludeDomains: z.array(z.string()).optional().describe("排除这些域名"),
    /** 包含域名过滤 */
    includeDomains: z.array(z.string()).optional().describe("只搜索这些域名"),
    /** 最大结果数 */
    maxResults: z.number().optional().describe("最大返回结果数，默认 10"),
    /** 搜索查询 */
    query: z.string().describe("搜索查询(支持自然语言)"),
    /** 搜索深度:basic 或 advanced(Tavily 专用) */
    searchDepth: z.enum(["basic", "advanced"]).optional().describe("搜索深度:basic(快速)或 advanced(深度，仅 Tavily)"),
  }),
  permission: "websearch",
  builtin: true,
});

// ── 注册表引擎 ──────────────────────────────────────────────────

async function tryRegisteredEngines(
  query: string,
  maxResults: number,
  preferredEngineId?: string,
): Promise<Record<string, unknown> | null> {
  await ensureSearchEnginesLoaded();
  const engines = orderRegisteredEngines(listSearchEngines(), preferredEngineId);

  for (const engine of engines) {
    try {
      log.info(`注册表搜索引擎搜索: ${engine.id}, query=${query}`);
      const results = await engine.search(query, maxResults);
      if (results.length === 0) {
        continue;
      }
      const normalizedResults = results.slice(0, maxResults).map((r) => ({
        content: r.content,
        snippet: r.snippet ?? r.content ?? "",
        title: r.title,
        url: r.url,
      }));
      return {
        content: truncateIfNeeded(formatResults(normalizedResults)),
        engine: engine.id,
        note: preferredEngineId ? `使用指定搜索引擎: ${engine.name}` : `使用注册表搜索引擎兜底: ${engine.name}`,
        query,
        results: normalizedResults,
        total: normalizedResults.length,
      };
    } catch (error) {
      log.warn(`注册表搜索引擎失败: ${engine.id}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return null;
}

function orderRegisteredEngines(
  engines: RegisteredSearchEngine[],
  preferredEngineId?: string,
): RegisteredSearchEngine[] {
  const filtered = engines.filter((engine) => engine.enable !== false);
  if (!preferredEngineId) {
    return filtered;
  }
  return [
    ...filtered.filter((engine) => engine.id === preferredEngineId),
    ...filtered.filter((engine) => engine.id !== preferredEngineId),
  ];
}

// ── 浏览器引擎兜底 ────────────────────────────────────────────────

/**
 * 尝试使用浏览器引擎搜索(Puppeteer)。
 * 按优先级:Bing → DuckDuckGo
 */
async function tryBrowserEngines(query: string, maxResults: number): Promise<Record<string, unknown> | null> {
  const browserManager = BrowserManager.getInstance();

  if (!browserManager.isAvailable()) {
    log.debug("Puppeteer 不可用，跳过浏览器引擎");
    return null;
  }

  // 1. 尝试 Bing 浏览器引擎
  try {
    log.info(`Bing 浏览器引擎搜索: ${query}`);
    const results = await bingBrowserEngine.search(query, maxResults);
    if (results.length > 0) {
      log.info(`Bing 浏览器引擎成功: ${results.length} 条结果`);
      return {
        content: truncateIfNeeded(formatResults(results)),
        engine: "bing-browser",
        note: "使用 Bing 浏览器引擎搜索(Puppeteer)",
        query,
        results,
        total: results.length,
      };
    }
  } catch (error) {
    log.warn(`Bing 浏览器引擎失败: ${error instanceof Error ? error.message : String(error)}`);
  }

  // 2. 尝试 DuckDuckGo 浏览器引擎
  try {
    log.info(`DuckDuckGo 浏览器引擎搜索: ${query}`);
    const results = await duckduckgoBrowserEngine.search(query, maxResults);
    if (results.length > 0) {
      log.info(`DuckDuckGo 浏览器引擎成功: ${results.length} 条结果`);
      return {
        content: truncateIfNeeded(formatResults(results)),
        engine: "duckduckgo-browser",
        note: "使用 DuckDuckGo 浏览器引擎搜索(Puppeteer)",
        query,
        results,
        total: results.length,
      };
    }
  } catch (error) {
    log.warn(`DuckDuckGo 浏览器引擎失败: ${error instanceof Error ? error.message : String(error)}`);
  }

  return null;
}
