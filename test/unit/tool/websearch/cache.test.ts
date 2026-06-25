/**
 * websearch/cache 单元测试
 *
 * 测试范围:
 *   - getCachedResult: 缓存读取（含 TTL 过期）
 *   - setCachedResult: 缓存写入 + LRU 淘汰
 *
 * 策略: mock config 为小容量，使用唯一 key 隔离测试。
 */
import { describe, expect, it, mock } from "bun:test";

mock.module("@/core/logging/logger", () => ({
  createLogger: () => ({ debug: () => {}, error: () => {}, info: () => {}, warn: () => {} }),
}));
mock.module("@/config", () => ({
  ...require("@/config/constants"),
  WEB_SEARCH_CACHE_MAX_SIZE: 3,
  WEB_SEARCH_CACHE_TTL_MS: 100,
}));

import { getCachedResult, setCachedResult } from "@/tool/websearch/cache";

describe("websearch cache", () => {
  it("写入后应能读取", () => {
    const key = `test-${Date.now()}-a`;
    setCachedResult(key, { results: ["item1"] });
    const result = getCachedResult(key);
    expect(result).toEqual({ results: ["item1"] });
  });

  it("未写入的 key 应返回 null", () => {
    const result = getCachedResult("nonexistent-key-xyz");
    expect(result).toBeNull();
  });

  it("覆盖写入应更新值", () => {
    const key = `test-${Date.now()}-b`;
    setCachedResult(key, { v: 1 });
    setCachedResult(key, { v: 2 });
    expect(getCachedResult(key)).toEqual({ v: 2 });
  });

  it("LRU 淘汰：超过 max 时最旧条目被移除", () => {
    const base = `lru-${Date.now()}`;
    // max = 3，写入 4 个条目
    setCachedResult(`${base}-1`, { n: 1 });
    setCachedResult(`${base}-2`, { n: 2 });
    setCachedResult(`${base}-3`, { n: 3 });
    setCachedResult(`${base}-4`, { n: 4 });

    // 第 1 个应被淘汰
    expect(getCachedResult(`${base}-1`)).toBeNull();
    // 第 4 个应存在
    expect(getCachedResult(`${base}-4`)).toEqual({ n: 4 });
    // 第 2、3 应存在
    expect(getCachedResult(`${base}-2`)).toEqual({ n: 2 });
    expect(getCachedResult(`${base}-3`)).toEqual({ n: 3 });
  });

  it("重新写入已存在的 key 应刷新 LRU 顺序", () => {
    const base = `lru-refresh-${Date.now()}`;
    setCachedResult(`${base}-1`, { n: 1 });
    setCachedResult(`${base}-2`, { n: 2 });
    setCachedResult(`${base}-3`, { n: 3 });

    // 重新写入 key-1，使其成为最新
    setCachedResult(`${base}-1`, { n: 1 });

    // 写入第 4 个，应淘汰 key-2（最旧）
    setCachedResult(`${base}-4`, { n: 4 });

    expect(getCachedResult(`${base}-1`)).toEqual({ n: 1 }); // 刷新后仍存在
    expect(getCachedResult(`${base}-2`)).toBeNull(); // 被淘汰
    expect(getCachedResult(`${base}-3`)).toEqual({ n: 3 });
    expect(getCachedResult(`${base}-4`)).toEqual({ n: 4 });
  });
});
