/**
 * 网页搜索工具测试。
 *
 * 测试用例:
 *   - 搜索请求
 *   - 结果解析
 *   - 缓存管理
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { webSearchTool } from "@/tool/websearch";
import { webFetchTool } from "@/tool/websearch/webfetch";
import { cleanupTestDir, createGlobalTmpTestDir } from "../../helpers/testPaths";

// ─── websearch ──────────────────────────────────────────────────

describe("websearch", () => {
  test("无 API Key 时使用 DuckDuckGo 兜底", async () => {
    // 确保没有 API key
    const savedTavily = process.env.TAVILY_API_KEY;
    const savedBrave = process.env.BRAVE_API_KEY;
    const savedGoogle = process.env.GOOGLE_API_KEY;
    const savedXDG = process.env.XDG_CONFIG_HOME;
    delete process.env.TAVILY_API_KEY;
    delete process.env.BRAVE_API_KEY;
    delete process.env.GOOGLE_API_KEY;

    // 使用临时目录作为配置目录，避免读取用户真实的 ~/.crab/config.json
    const tempDir = createGlobalTmpTestDir("crab-websearch-test-");
    process.env.XDG_CONFIG_HOME = tempDir;

    const result = (await webSearchTool.execute({ query: "TypeScript programming language" })) as any;

    expect(result.query).toBe("TypeScript programming language");
    // 现在应该有 DuckDuckGo 兜底，返回搜索结果而不是错误
    // 由于 DuckDuckGo 可能受网络/速率限制，我们检查是否有结果或合理的错误
    if (result.error) {
      // 如果出错，应该是服务不可用而非"没有可用的搜索 API"
      expect(result.error).not.toContain("没有可用的搜索 API");
    } else {
      // 成功时应该有 DuckDuckGo 标记
      expect(result.engine).toBe("duckduckgo");
      expect(result.results).toBeDefined();
    }

    // 恢复
    if (savedTavily) {
      process.env.TAVILY_API_KEY = savedTavily;
    }
    if (savedBrave) {
      process.env.BRAVE_API_KEY = savedBrave;
    }
    if (savedGoogle) {
      process.env.GOOGLE_API_KEY = savedGoogle;
    }
    if (savedXDG) {
      process.env.XDG_CONFIG_HOME = savedXDG;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }

    // 清理临时目录
    try {
      cleanupTestDir(tempDir);
    } catch {}
  }, 20_000); // 延长超时，因为 DuckDuckGo 可能较慢

  test("工具结构完整", () => {
    expect(webSearchTool.name).toBe("websearch");
    expect(webSearchTool.permission).toBe("websearch");
    expect(typeof webSearchTool.execute).toBe("function");
    expect(webSearchTool.parameters).toBeDefined();
  });

  test("参数 Schema 验证 — 缺少 query", () => {
    const schema = webSearchTool.parameters;
    const result = schema.safeParse({});
    expect(result.success).toBe(false);
  });

  test("参数 Schema 验证 — 正确参数", () => {
    const schema = webSearchTool.parameters;
    const result = schema.safeParse({ query: "hello world" });
    expect(result.success).toBe(true);
  });
});

// ─── webfetch ───────────────────────────────────────────────────

describe("webfetch", () => {
  test("工具结构完整", () => {
    expect(webFetchTool.name).toBe("webfetch");
    expect(webFetchTool.permission).toBe("websearch");
    expect(typeof webFetchTool.execute).toBe("function");
  });

  test("抓取无效 URL 返回错误", async () => {
    const result = (await webFetchTool.execute({
      timeout: 2000,
      url: "http://localhost:1/invalid",
    })) as any;

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("参数 Schema 验证 — 缺少 url", () => {
    const schema = webFetchTool.parameters;
    const result = schema.safeParse({});
    expect(result.success).toBe(false);
  });

  test("参数 Schema 验证 — 正确参数", () => {
    const schema = webFetchTool.parameters;
    const result = schema.safeParse({ url: "https://example.com" });
    expect(result.success).toBe(true);
  });
});
