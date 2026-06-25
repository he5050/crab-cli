import { describe, expect, it, beforeEach } from "bun:test";
import { ToolResultCache, getToolResultCache, resetToolResultCache } from "@/tool/result/toolCache";
import { clearAllCaches } from "@/api";

describe("ToolResultCache", () => {
  let cache: ToolResultCache;

  beforeEach(() => {
    clearAllCaches();
    cache = new ToolResultCache();
  });

  it("caches and retrieves tool results", () => {
    cache.set("glob", { pattern: "*.ts" }, ["a.ts", "b.ts"]);
    const result = cache.get("glob", { pattern: "*.ts" });
    expect(result as string[]).toEqual(["a.ts", "b.ts"]);
  });

  it("returns undefined for cache miss", () => {
    const result = cache.get("glob", { pattern: "*.missing" });
    expect(result).toBeUndefined();
  });

  it("does not cache write tools", () => {
    cache.set("fs_write", { path: "a.txt", content: "hello" }, { success: true });
    const result = cache.get("fs_write", { path: "a.txt", content: "hello" });
    expect(result).toBeUndefined();
  });

  it("does not cache bash tool", () => {
    cache.set("bash", { command: "ls" }, { output: "file.txt" });
    const result = cache.get("bash", { command: "ls" });
    expect(result).toBeUndefined();
  });

  it("builds consistent cache keys", () => {
    const key1 = cache.buildCacheKey("glob", { pattern: "*.ts" });
    const key2 = cache.buildCacheKey("glob", { pattern: "*.ts" });
    expect(key1).toBe(key2);
  });

  it("different params produce different keys", () => {
    const key1 = cache.buildCacheKey("glob", { pattern: "*.ts" });
    const key2 = cache.buildCacheKey("glob", { pattern: "*.js" });
    expect(key1).not.toBe(key2);
  });

  it("invalidate clears cache for specific tool", () => {
    cache.set("glob", { pattern: "*.ts" }, ["a.ts"]);
    cache.set("grep", { pattern: "foo" }, ["grep.ts"]);

    const deleted = cache.invalidate("glob");
    expect(deleted).toBe(1);

    expect(cache.get("glob", { pattern: "*.ts" })).toBeUndefined();
    expect(cache.get("grep", { pattern: "foo" }) as string[]).toEqual(["grep.ts"]);
  });

  it("invalidate clears sessionId-scoped entries for a tool", () => {
    // 写入带 sessionId 前缀的缓存
    cache.set("glob", { pattern: "*.ts" }, ["a.ts"], undefined, "session_abc");
    cache.set("glob", { pattern: "*.js" }, ["a.js"], undefined, "session_abc");
    cache.set("grep", { pattern: "foo" }, ["grep.ts"], undefined, "session_abc");

    // invalidate 应找到所有包含 :glob: 的 key
    const deleted = cache.invalidate("glob");
    expect(deleted).toBe(2);

    expect(cache.get("glob", { pattern: "*.ts" }, "session_abc")).toBeUndefined();
    expect(cache.get("glob", { pattern: "*.js" }, "session_abc")).toBeUndefined();
    expect(cache.get("grep", { pattern: "foo" }, "session_abc") as string[]).toEqual(["grep.ts"]);
  });

  it("invalidate without toolName clears all entries and returns count", () => {
    cache.set("glob", { pattern: "*.ts" }, ["a.ts"]);
    cache.set("grep", { pattern: "foo" }, ["grep.ts"]);
    cache.set("read", { path: "f.txt" }, "content");

    const count = cache.invalidate();
    expect(count).toBe(3);

    expect(cache.get("glob", { pattern: "*.ts" })).toBeUndefined();
    expect(cache.get("grep", { pattern: "foo" })).toBeUndefined();
  });

  it("excludeTools prevents caching", () => {
    const customCache = new ToolResultCache({ excludeTools: ["glob"] });
    customCache.set("glob", { pattern: "*.ts" }, ["a.ts"]);
    expect(customCache.get("glob", { pattern: "*.ts" })).toBeUndefined();
  });

  it("allowTools restricts caching to whitelist", () => {
    const customCache = new ToolResultCache({ allowTools: ["glob", "grep"] });
    customCache.set("glob", { pattern: "*.ts" }, ["a.ts"]);
    customCache.set("fs_read", { path: "a.ts" }, "content");

    expect(customCache.get("glob", { pattern: "*.ts" }) as string[]).toEqual(["a.ts"]);
    expect(customCache.get("fs_read", { path: "a.ts" })).toBeUndefined();
  });

  it("getStats returns cache statistics", () => {
    cache.set("glob", { pattern: "*.ts" }, ["a.ts"]);
    cache.get("glob", { pattern: "*.ts" });
    cache.get("glob", { pattern: "*.missing" });

    const stats = cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
  });

  it("sessionId isolation prevents cross-session cache hits", () => {
    cache.set("glob", { pattern: "*.ts" }, ["session_a_result"], undefined, "session_a");
    cache.set("glob", { pattern: "*.ts" }, ["session_b_result"], undefined, "session_b");

    expect(cache.get("glob", { pattern: "*.ts" }, "session_a") as string[]).toEqual(["session_a_result"]);
    expect(cache.get("glob", { pattern: "*.ts" }, "session_b") as string[]).toEqual(["session_b_result"]);
    // 无 sessionId 不命中有 sessionId 的缓存
    expect(cache.get("glob", { pattern: "*.ts" })).toBeUndefined();
  });
});

describe("global tool cache", () => {
  beforeEach(() => resetToolResultCache());

  it("getToolResultCache returns singleton", () => {
    const cache1 = getToolResultCache();
    const cache2 = getToolResultCache();
    expect(cache1).toBe(cache2);
  });

  it("resetToolResultCache clears the singleton", () => {
    const cache = getToolResultCache();
    cache.set("glob", { pattern: "*.ts" }, ["a.ts"]);
    expect(cache.get("glob", { pattern: "*.ts" }) as string[]).toEqual(["a.ts"]);

    resetToolResultCache();

    const newCache = getToolResultCache();
    expect(newCache.get("glob", { pattern: "*.ts" })).toBeUndefined();
  });
});
