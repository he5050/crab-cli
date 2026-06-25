/**
 * 核心 CacheManager 测试。
 *
 * 测试用例:
 *   - createCacheManager / getCacheManager
 *   - LRU/容量上限与淘汰
 *   - 统计与全局清理
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  type CacheConfig,
  cleanupAllCaches,
  createCacheManager,
  destroyCacheManager,
  getAllCacheStats,
  getCacheManager,
  getTotalCacheSize,
} from "@/core/concurrency/cacheManager";

describe("CacheManager", () => {
  const config: CacheConfig = { enableStats: true, maxSize: 3, name: "test-cache" };
  let manager: ReturnType<typeof createCacheManager<string>>;

  beforeEach(() => {
    manager = createCacheManager<string>(config);
  });

  afterEach(() => {
    destroyCacheManager("test-cache");
  });

  test("set/get 基本操作", () => {
    manager.set("a", "1");
    expect(manager.get("a")).toBe("1");
  });

  test("不存在的键返回 null", () => {
    expect(manager.get("nonexistent")).toBeNull();
  });

  test("TTL 过期后返回 null", async () => {
    manager.set("a", "1", 50);
    expect(manager.get("a")).toBe("1");
    await new Promise((r) => setTimeout(r, 60));
    expect(manager.get("a")).toBeNull();
  });

  test("LRU 淘汰最旧条目", async () => {
    manager.set("a", "1");
    manager.set("b", "2");
    manager.set("c", "3");
    await new Promise((r) => setTimeout(r, 5));
    manager.get("a");
    await new Promise((r) => setTimeout(r, 5));
    manager.get("b");
    manager.set("d", "4");
    expect(manager.get("c")).toBeNull();
  });

  test("has 检查键是否存在", () => {
    manager.set("a", "1");
    expect(manager.has("a")).toBe(true);
    expect(manager.has("b")).toBe(false);
  });

  test("delete 删除条目", () => {
    manager.set("a", "1");
    expect(manager.delete("a")).toBe(true);
    expect(manager.get("a")).toBeNull();
  });

  test("clear 清空所有", () => {
    manager.set("a", "1");
    manager.set("b", "2");
    manager.clear();
    expect(manager.size()).toBe(0);
    expect(manager.getStats().hits).toBe(0);
  });

  test("keys/values 返回内容", () => {
    manager.set("a", "1");
    manager.set("b", "2");
    expect(manager.keys()).toEqual(["a", "b"]);
    expect(manager.values()).toEqual(["1", "2"]);
  });

  test("命中率统计", () => {
    expect(manager.getStats().hitRate).toBe(0);
    manager.set("a", "1");
    manager.get("a");
    manager.get("b");
    const stats = manager.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBe(50);
  });

  test("resetStats 重置统计", () => {
    manager.set("a", "1");
    manager.get("a");
    manager.resetStats();
    const stats = manager.getStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
  });

  test("cleanup 清理过期条目", async () => {
    manager.set("a", "1", 10);
    manager.set("b", "2");
    manager.set("c", "3", 10);
    await new Promise((r) => setTimeout(r, 15));
    manager.cleanup();
    expect(manager.has("a")).toBe(false);
    expect(manager.has("b")).toBe(true);
    expect(manager.has("c")).toBe(false);
  });

  test("preload 预加载数据", async () => {
    const n = await manager.preload(async () => {
      const m = new Map<string, string>();
      m.set("x", "10");
      m.set("y", "20");
      return m;
    });
    expect(n).toBe(2);
    expect(manager.get("x")).toBe("10");
    expect(manager.get("y")).toBe("20");
  });

  test("缓存满时淘汰旧条目", () => {
    manager.set("a", "1");
    manager.set("b", "2");
    manager.set("c", "3");
    manager.set("d", "4");
    expect(manager.get("a")).toBeNull();
    expect(manager.get("d")).toBe("4");
  });
});

describe("CacheManager 工厂函数", () => {
  afterEach(() => {
    const names = getAllCacheStats().map((s) => s.name);
    for (const name of names) {
      destroyCacheManager(name);
    }
  });

  test("createCacheManager 注册管理器", () => {
    const m = createCacheManager({ maxSize: 10, name: "factory-test" });
    expect(getCacheManager("factory-test")).toBe(m);
  });

  test("getCacheManager 不存在的名称返回 null", () => {
    expect(getCacheManager("nonexistent")).toBeNull();
  });

  test("destroyCacheManager 销毁管理器", () => {
    createCacheManager({ maxSize: 10, name: "to-destroy" });
    destroyCacheManager("to-destroy");
    expect(getCacheManager("to-destroy")).toBeNull();
  });

  test("getAllCacheStats 收集所有统计", () => {
    createCacheManager({ maxSize: 5, name: "stats-1" });
    createCacheManager({ maxSize: 10, name: "stats-2" });
    const stats = getAllCacheStats();
    expect(stats.length).toBe(2);
    expect(stats.map((s) => s.name).toSorted()).toEqual(["stats-1", "stats-2"]);
  });

  test("cleanupAllCaches 清理所有", async () => {
    const m1 = createCacheManager<string>({ maxSize: 5, name: "clean-1" });
    const m2 = createCacheManager<string>({ maxSize: 5, name: "clean-2" });
    m1.set("a", "1", 10);
    m2.set("b", "2", 10);
    await new Promise((r) => setTimeout(r, 15));
    const cleaned = cleanupAllCaches();
    expect(cleaned).toBe(2);
  });

  test("getTotalCacheSize 返回总大小", () => {
    const m1 = createCacheManager<string>({ maxSize: 5, name: "size-1" });
    const m2 = createCacheManager<string>({ maxSize: 5, name: "size-2" });
    m1.set("a", "1");
    m2.set("b", "2");
    m2.set("c", "3");
    expect(getTotalCacheSize()).toBe(3);
  });
});
