/**
 * 搜索引擎注册表 — 管理内置和插件搜索引擎。
 *
 * 职责:
 *   - 管理内置搜索引擎
 *   - 加载插件搜索引擎
 *   - 搜索引擎选择
 *   - 降级策略管理
 *
 * 模块功能:
 *   - 内置引擎注册(Tavily、Bing、DuckDuckGo 等)
 *   - 插件引擎动态加载
 *   - 引擎可用性检查
 *   - 自动降级处理
 *
 * 使用场景:
 *   - 网页搜索
 *   - 多引擎切换
 *   - 自定义搜索引擎
 *   - 搜索失败降级
 *
 * 边界:
 *   1. 默认使用 Tavily
 *   2. 插件目录 ~/.crab/plugin/search_engines/
 *   3. 支持 .js/.mjs/.cjs 插件
 *   4. Puppeteer 不可用时降级到 HTTP fetch
 *   5. 动态加载插件引擎
 *
 * 流程:
 *   1. 注册内置引擎
 *   2. 加载插件引擎
 *   3. 根据配置选择引擎
 *   4. 执行搜索
 *   5. 失败时降级
 */

import { existsSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { getGlobalCrabDir } from "@/config";
import type { SearchEngine, SearchEngineId, SearchResult } from "./types";
import { bingEngine } from "./bing";
import { duckduckgoBrowserEngine } from "./duckduckgoBrowser";
import { bingBrowserEngine } from "./bingBrowser";
import { BrowserManager } from "../browser";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("tool:websearch:engines");

/** 默认搜索引擎 */
export const DEFAULT_SEARCH_ENGINE: SearchEngineId = "tavily";

/** 插件目录 */
export const SEARCH_ENGINES_DIR = join(getGlobalCrabDir(), "plugin", "search_engines");

/** 支持的插件文件扩展名 */
const SUPPORTED_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);

// ─── DuckDuckGo fetch 引擎(降级备用)─────────────────────────

const duckduckgoEngine: SearchEngine = {
  id: "duckduckgo",
  name: "DuckDuckGo",
  async search(query: string, maxResults: number): Promise<SearchResult[]> {
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        },
      });

      if (!response.ok) {
        return [];
      }

      const html = await response.text();
      const results: SearchResult[] = [];

      const resultRegex = /class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi;
      const snippetRegex = /class="result__snippet"[^>]*>(.*?)<\/a>/gi;

      let match;
      let snippetMatch;
      const urls: string[] = [];
      const titles: string[] = [];
      const snippets: string[] = [];

      while ((match = resultRegex.exec(html)) !== null) {
        urls.push(match[1]!);
        titles.push(match[2]!.replace(/<[^>]+>/g, "").trim());
      }

      while ((snippetMatch = snippetRegex.exec(html)) !== null) {
        snippets.push(snippetMatch[1]!.replace(/<[^>]+>/g, "").trim());
      }

      for (let i = 0; i < Math.min(urls.length, maxResults); i++) {
        results.push({
          snippet: snippets[i] || undefined,
          source: "duckduckgo",
          title: titles[i] || "",
          url: urls[i] || "",
        });
      }

      return results;
    } catch (error) {
      log.warn("DuckDuckGo 搜索失败", { payload: { error: String(error) } });
      return [];
    }
  },
};

// ─── 内置引擎选择(浏览器优先，fetch 降级)──────────────────────

function resolveBuiltinEngines(): SearchEngine[] {
  const browserManager = BrowserManager.getInstance();
  const browserAvailable = browserManager.isAvailable();

  if (browserAvailable) {
    log.info("Puppeteer 可用，注册浏览器搜索引擎");
    return [duckduckgoBrowserEngine, bingBrowserEngine];
  }

  log.info("Puppeteer 不可用，注册 HTTP fetch 搜索引擎");
  return [duckduckgoEngine, bingEngine];
}

/**
 * P2-5 修复: 延迟求值内置引擎列表。
 * 原实现 `const BUILT_IN_ENGINES = resolveBuiltinEngines()` 在模块加载时求值，
 * 此时 BrowserManager 可能尚未初始化，导致 Puppeteer 可用性检测不准确。
 * 改为首次访问时惰性求值。
 */
let _builtinEngines: SearchEngine[] | null = null;
function getBuiltinEngines(): SearchEngine[] {
  if (!_builtinEngines) {
    _builtinEngines = resolveBuiltinEngines();
  }
  return _builtinEngines;
}

// ─── 注册表 ──────────────────────────────────────────────────────

const ENGINES = new Map<string, SearchEngine>(
  getBuiltinEngines()
    .filter(isEngineEnabled)
    .map((e) => [e.id, e] as const),
);

let externalLoadPromise: Promise<void> | null = null;
let externalLoaded = false;

function isEngineEnabled(engine: SearchEngine): boolean {
  return engine.enable !== false;
}

interface SearchEngineModule {
  default?: unknown;
  searchEngine?: unknown;
  searchEngines?: unknown;
}

function isSearchEngine(candidate: unknown): candidate is SearchEngine {
  if (typeof candidate !== "object" || candidate === null) {
    return false;
  }
  const c = candidate as Partial<SearchEngine>;
  return typeof c.id === "string" && c.id.length > 0 && typeof c.name === "string" && typeof c.search === "function";
}

function collectFromModule(mod: SearchEngineModule): SearchEngine[] {
  const candidates: unknown[] = [];
  const pushOne = (val: unknown) => {
    if (Array.isArray(val)) {
      candidates.push(...val);
    } else if (val !== undefined && val !== null) {
      candidates.push(val);
    }
  };
  pushOne(mod.default);
  pushOne(mod.searchEngine);
  pushOne(mod.searchEngines);
  return candidates.filter(isSearchEngine);
}

/** 加载外部插件引擎 */
async function loadExternalEngines(): Promise<void> {
  if (!existsSync(SEARCH_ENGINES_DIR)) {
    return;
  }

  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(SEARCH_ENGINES_DIR, { withFileTypes: true });
  } catch (error) {
    log.warn("无法读取搜索插件目录", { payload: { error: String(error) } });
    return;
  }

  const files = entries
    .filter((e) => e.isFile() && SUPPORTED_EXTENSIONS.has(extname(e.name).toLowerCase()))
    .toSorted((a, b) => a.name.localeCompare(b.name));

  for (const file of files) {
    const modulePath = join(SEARCH_ENGINES_DIR, file.name);
    try {
      const moduleUrl = pathToFileURL(modulePath).href;
      const mod = (await import(moduleUrl)) as SearchEngineModule;
      const engines = collectFromModule(mod);
      if (engines.length === 0) {
        log.warn(`插件 "${file.name}" 未导出有效的 SearchEngine`);
        continue;
      }
      for (const engine of engines) {
        if (!isEngineEnabled(engine)) {
          ENGINES.delete(engine.id);
          continue;
        }
        ENGINES.set(engine.id, engine);
      }
    } catch (error) {
      log.warn(`加载搜索插件 "${file.name}" 失败`, {
        payload: { error: String(error) },
      });
    }
  }
}

/**
 * 确保外部搜索引擎插件已加载。
 * 安全多次调用，实际加载只运行一次。
 */
/** ensureSearchEnginesLoaded 的实现 */
export function ensureSearchEnginesLoaded(): Promise<void> {
  if (externalLoaded) {
    return Promise.resolve();
  }
  if (externalLoadPromise) {
    return externalLoadPromise;
  }
  externalLoadPromise = loadExternalEngines().then(() => {
    externalLoaded = true;
  });
  return externalLoadPromise;
}

/**
 * 按 ID 获取搜索引擎。
 * 未知 ID 回退到默认引擎。
 */
/** getSearchEngine 的实现 */
export function getSearchEngine(id?: string | null): SearchEngine {
  if (id && ENGINES.has(id)) {
    return ENGINES.get(id)!;
  }
  return ENGINES.get(DEFAULT_SEARCH_ENGINE) ?? duckduckgoEngine;
}

/** 列出所有已注册引擎(同步)。 */
export function listSearchEngines(): SearchEngine[] {
  return [...ENGINES.values()];
}

/** 异步列出所有引擎(含插件)。 */
export async function listSearchEnginesAsync(): Promise<SearchEngine[]> {
  await ensureSearchEnginesLoaded();
  return listSearchEngines();
}

export function __registerSearchEngineForTesting(engine: SearchEngine): void {
  ENGINES.set(engine.id, engine);
}

export function __unregisterSearchEngineForTesting(id: string): void {
  ENGINES.delete(id);
}

export type { SearchEngine, SearchEngineId, SearchResult } from "./types";
export { bingBrowserEngine } from "./bingBrowser";
export { duckduckgoBrowserEngine } from "./duckduckgoBrowser";
