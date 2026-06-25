/**
 * cache 模块单元测试
 *
 * 测试目标:
 * - TTL 过期机制
 * - LRU 淘汰策略
 * - 过期项清理
 * - 缓存统计
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { Cache } from "@/api/utils/cache";

describe("Cache 基本功能", () => {
  let cache: Cache<number>;

  beforeEach(() => {
    cache = new Cache<number>({ capacity: 3 });
  });

  it("应该能够设置和获取值", () => {
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
  });

  it("应该在键不存在时返回 undefined", () => {
    expect(cache.get("nonexistent")).toBeUndefined();
  });

  it("应该更新已存在的键的值", () => {
    cache.set("a", 1);
    cache.set("a", 2);
    expect(cache.get("a")).toBe(2);
  });

  it("应该正确报告大小", () => {
    expect(cache.size()).toBe(0);
    cache.set("a", 1);
    expect(cache.size()).toBe(1);
    cache.set("b", 2);
    expect(cache.size()).toBe(2);
  });
});

describe("LRU 淘汰策略", () => {
  let cache: Cache<number>;

  beforeEach(() => {
    cache = new Cache<number>({ capacity: 3 });
  });

  it("应该在达到最大容量时淘汰最久未使用的项", () => {
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    // 访问 "a" 使其成为最近使用的
    cache.get("a");

    // 添加新项，应该淘汰 "b"（最久未使用）
    cache.set("d", 4);

    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
    expect(cache.get("d")).toBe(4);
  });

  it("应该在更新值时刷新访问顺序", () => {
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    // 更新 "a" 的值（set 操作会刷新访问计数）
    cache.set("a", 10);

    // 添加新项，应该淘汰 "b"
    cache.set("d", 4);

    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(10);
  });
});

describe("TTL 过期机制", () => {
  let cache: Cache<number>;

  beforeEach(() => {
    cache = new Cache<number>({ capacity: 10, defaultTtlMs: 100 });
  });

  it("应该在 TTL 内返回值", () => {
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
  });

  it("应该在 TTL 过期后返回 undefined", async () => {
    cache.set("a", 1);

    // 等待超过 TTL
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(cache.get("a")).toBeUndefined();
  });

  it("应该在设置新值时重置 TTL", async () => {
    cache.set("a", 1);

    // 等待 60ms
    await new Promise((resolve) => setTimeout(resolve, 60));

    // 重新设置值，重置 TTL
    cache.set("a", 2);

    // 再等待 60ms（总共 120ms，但 TTL 已重置）
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(cache.get("a")).toBe(2);
  });

  it("不同的键应该有独立的 TTL", async () => {
    cache.set("a", 1);

    // 等待 50ms
    await new Promise((resolve) => setTimeout(resolve, 50));

    cache.set("b", 2);

    // 再等待 60ms（a 已过期，b 还未过期）
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
  });

  it("应该支持 set 时指定独立 TTL", async () => {
    cache.set("a", 1, 50); // 50ms TTL
    cache.set("b", 2, 200); // 200ms TTL

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
  });
});

describe("过期项清理", () => {
  let cache: Cache<number>;

  beforeEach(() => {
    cache = new Cache<number>({ capacity: 10, defaultTtlMs: 50 });
  });

  it("应该在调用 size() 时清理过期项", async () => {
    cache.set("a", 1);
    cache.set("b", 2);

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(cache.size()).toBe(0);
  });

  it("应该在调用 keys() 时清理过期项", async () => {
    cache.set("a", 1);
    cache.set("b", 2);

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(cache.keys()).toEqual([]);
  });

  it("应该在调用 values() 时清理过期项", async () => {
    cache.set("a", 1);
    cache.set("b", 2);

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(cache.values()).toEqual([]);
  });

  it("应该在调用 entries() 时清理过期项", async () => {
    cache.set("a", 1);
    cache.set("b", 2);

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(cache.entries()).toEqual([]);
  });
});

describe("批量操作", () => {
  it("应该支持 setMany", () => {
    const cache = new Cache<number>({ capacity: 10 });
    cache.setMany([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
  });

  it("应该支持 getMany", () => {
    const cache = new Cache<number>({ capacity: 10 });
    cache.set("a", 1);
    cache.set("b", 2);
    const results = cache.getMany(["a", "b", "c"]);
    expect(results[0]).toEqual({ key: "a", value: 1 });
    expect(results[1]).toEqual({ key: "b", value: 2 });
    expect(results[2]).toBeUndefined();
  });

  it("应该支持 deleteMany", () => {
    const cache = new Cache<number>({ capacity: 10 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    const count = cache.deleteMany(["a", "c"]);
    expect(count).toBe(2);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
  });

  it("应该支持 getOrSet", () => {
    const cache = new Cache<number>({ capacity: 10 });
    const value = cache.getOrSet("a", () => 42);
    expect(value).toBe(42);
    expect(cache.get("a")).toBe(42);

    // 第二次调用应该返回缓存值
    const value2 = cache.getOrSet("a", () => 99);
    expect(value2).toBe(42);
  });
});

describe("缓存统计", () => {
  it("应该正确记录命中率", () => {
    const cache = new Cache<number>({ capacity: 10 });
    cache.set("a", 1);
    cache.set("b", 2);

    cache.get("a"); // hit
    cache.get("a"); // hit
    cache.get("c"); // miss

    const stats = cache.getStats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBeCloseTo(0.667, 1);
    expect(stats.size).toBe(2);
    expect(stats.capacity).toBe(10);
  });

  it("应该正确记录淘汰次数", () => {
    const cache = new Cache<number>({ capacity: 2 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3); // 淘汰一个

    const stats = cache.getStats();
    expect(stats.evictions).toBe(1);
  });
});

describe("边界条件", () => {
  it("应该处理空字符串键", () => {
    const cache = new Cache<number>({ capacity: 10 });
    cache.set("", 1);
    expect(cache.get("")).toBe(1);
  });

  it("应该处理 null 值（undefined 返回）", () => {
    const cache = new Cache<number | null>({ capacity: 10 });
    // Cache 的 get 返回 T | undefined，null 值会被正确存储
    cache.set("a", null);
    expect(cache.get("a")).toBeNull();
  });

  it("应该支持 dispose 清理定时器", () => {
    const cache = new Cache<number>({ capacity: 10 });
    cache.dispose();
    // dispose 后定时器已清除，不影响基本操作
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
  });
});
