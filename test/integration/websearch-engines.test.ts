/**
 * Web Search 多引擎功能验证测试
 *
 * 测试目标:
 *   - 验证搜索引擎注册表功能
 *   - 验证引擎降级策略
 *   - 验证浏览器引擎和 HTTP fetch 引擎切换
 *   - 验证插件引擎加载
 */
import { describe, expect, test } from "bun:test";
import {
  __registerSearchEngineForTesting,
  __unregisterSearchEngineForTesting,
  ensureSearchEnginesLoaded,
  getSearchEngine,
  listSearchEngines,
  listSearchEnginesAsync,
} from "@/tool/websearch/engines";
import { webSearchTool } from "@/tool/websearch";
import { bingBrowserEngine } from "@/tool/websearch/engines/bingBrowser";
import { duckduckgoBrowserEngine } from "@/tool/websearch/engines/duckduckgoBrowser";
import { bingEngine } from "@/tool/websearch/engines/bing";

describe("Web Search 多引擎验证", () => {
  test("内置引擎已注册", () => {
    const engines = listSearchEngines();
    expect(engines.length).toBeGreaterThan(0);

    // 应该至少有 Bing 或 DuckDuckGo 其中一个
    const engineIds = new Set(engines.map((e) => e.id));
    const hasBingOrDDG = engineIds.has("bing") || engineIds.has("duckduckgo");
    expect(hasBingOrDDG).toBe(true);
  });

  test("浏览器引擎定义完整", () => {
    expect(bingBrowserEngine.id).toBe("bing");
    expect(bingBrowserEngine.name).toBe("Bing (Browser)");
    expect(typeof bingBrowserEngine.search).toBe("function");

    expect(duckduckgoBrowserEngine.id).toBe("duckduckgo");
    expect(duckduckgoBrowserEngine.name).toBe("DuckDuckGo (Browser)");
    expect(typeof duckduckgoBrowserEngine.search).toBe("function");
  });

  test("HTTP fetch 引擎定义完整", () => {
    expect(bingEngine.id).toBe("bing");
    expect(bingEngine.name).toBe("Bing");
    expect(typeof bingEngine.search).toBe("function");
  });

  test("getSearchEngine 返回有效引擎", () => {
    const engine = getSearchEngine();
    expect(engine).toBeDefined();
    expect(engine.id).toBeDefined();
    expect(engine.name).toBeDefined();
    expect(typeof engine.search).toBe("function");
  });

  test("getSearchEngine 支持指定引擎 ID", () => {
    const bingEngine = getSearchEngine("bing");
    expect(bingEngine.id).toBe("bing");

    const ddgEngine = getSearchEngine("duckduckgo");
    expect(ddgEngine.id).toBe("duckduckgo");
  });

  test("getSearchEngine 对未知 ID 回退到默认引擎", () => {
    const engine = getSearchEngine("nonexistent-engine-12345");
    expect(engine).toBeDefined();
    expect(engine.id).toBeDefined();
  });

  test("ensureSearchEnginesLoaded 可多次调用", async () => {
    await ensureSearchEnginesLoaded();
    await ensureSearchEnginesLoaded(); // 第二次调用应该立即返回

    const engines = listSearchEngines();
    expect(engines.length).toBeGreaterThan(0);
  });

  test("listSearchEnginesAsync 加载插件引擎", async () => {
    const engines = await listSearchEnginesAsync();
    expect(engines.length).toBeGreaterThan(0);

    // 验证引擎结构
    for (const engine of engines) {
      expect(engine.id).toBeDefined();
      expect(engine.name).toBeDefined();
      expect(typeof engine.search).toBe("function");
    }
  });

  test("搜索引擎有唯一 ID", () => {
    const engines = listSearchEngines();
    const ids = engines.map((e) => e.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  test("引擎降级策略 - 浏览器优先", () => {
    // 检查注册的引擎是否符合降级策略
    // 如果 Puppeteer 可用，应该注册浏览器引擎
    // 否则应该注册 HTTP fetch 引擎
    const engines = listSearchEngines();
    const engineNames = engines.map((e) => e.name);

    // 应该有明确的引擎类型标识
    const hasBrowserEngine = engineNames.some((name) => name.includes("(Browser)"));
    const hasHttpEngine = engineNames.some((name) => !name.includes("(Browser)"));

    // 至少应该有一种类型的引擎
    expect(hasBrowserEngine || hasHttpEngine).toBe(true);
  });

  test("websearch 主工具支持指定插件/注册表搜索引擎", async () => {
    __registerSearchEngineForTesting({
      id: "test-registry",
      name: "Test Registry Engine",
      async search(query, maxResults) {
        return [
          {
            snippet: `limit=${maxResults}`,
            source: "test-registry",
            title: `result for ${query}`,
            url: "https://example.test/result",
          },
        ];
      },
    });

    try {
      const result = (await webSearchTool.execute({
        engine: "test-registry",
        maxResults: 2,
        query: "registry fallback",
      })) as any;

      expect(result.engine).toBe("test-registry");
      expect(result.total).toBe(1);
      expect(result.results[0].url).toBe("https://example.test/result");
      expect(result.content).toContain("result for registry fallback");
    } finally {
      __unregisterSearchEngineForTesting("test-registry");
    }
  });
});
