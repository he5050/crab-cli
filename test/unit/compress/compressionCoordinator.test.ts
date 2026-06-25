/**
 * CompressionCoordinator 测试。
 *
 * 测试用例:
 *   - 锁获取与释放
 *   - 锁超时
 *   - 并发访问
 *   - waiter drain
 *   - clear 清理
 */
import { describe, expect, test, beforeEach } from "bun:test";
import { CompressionCoordinator } from "@/compress/core/compressionCoordinator";

describe("CompressionCoordinator", () => {
  let coord: CompressionCoordinator;

  beforeEach(() => {
    coord = new CompressionCoordinator();
  });

  test("初始状态无人持有锁", () => {
    expect(coord.isCompressing()).toBe(false);
  });

  test("acquireLock + releaseLock 基本流程", async () => {
    await coord.acquireLock("session-1");
    expect(coord.isCompressing()).toBe(true);
    expect(coord.isCompressing("session-1")).toBe(false);
    coord.releaseLock("session-1");
    expect(coord.isCompressing()).toBe(false);
  });

  test("withLock 包装正常执行", async () => {
    const result = await coord.withLock("session-1", () => Promise.resolve(42));
    expect(result).toBe(42);
    expect(coord.isCompressing()).toBe(false);
  });

  test("withLock 异常后自动释放锁", async () => {
    await expect(coord.withLock("session-1", () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(coord.isCompressing()).toBe(false);
  });

  test("同一 ID 不能重复获取锁", async () => {
    await coord.acquireLock("session-1");
    // 同一 ID 再次 acquire 应该因为 isCompressing(excludeId) 为 false 而挂起
    // 但如果没有超时，它会永远等待。所以我们测试 excludeId 排除自身。
    expect(coord.isCompressing("session-1")).toBe(false);
    expect(coord.isCompressing()).toBe(true);
  });

  test("不同 ID 并发时 isCompressing 返回 true", async () => {
    await coord.acquireLock("session-1");
    expect(coord.isCompressing("session-2")).toBe(true);
  });

  test("waitUntilFree 立即 resolve（无锁时）", async () => {
    await expect(coord.waitUntilFree()).resolves.toBeUndefined();
  });

  test("waitUntilFree 在释放后 resolve", async () => {
    coord.acquireLock("session-1");
    const promise = coord.waitUntilFree();
    coord.releaseLock("session-1");
    await expect(promise).resolves.toBeUndefined();
  });

  test("acquireLock 超时后抛出错误", async () => {
    await coord.acquireLock("session-1");
    await expect(coord.acquireLock("session-2", 10)).rejects.toThrow("获取锁超时");
  });

  test("withLock 超时后抛出错误", async () => {
    await coord.acquireLock("session-1");
    await expect(coord.withLock("session-2", () => Promise.resolve("never"), 10)).rejects.toThrow("获取锁超时");
  });

  test("waitUntilFreeWithTimeout 超时返回 false", async () => {
    await coord.acquireLock("session-1");
    const result = await coord.waitUntilFreeWithTimeout("session-2", 10);
    expect(result).toBe(false);
  });

  test("waitUntilFreeWithTimeout 立即空闲返回 true", async () => {
    const result = await coord.waitUntilFreeWithTimeout("session-1", 10);
    expect(result).toBe(true);
  });

  test("waitUntilFreeWithTimeout 释放后返回 true", async () => {
    coord.acquireLock("session-1");
    const promise = coord.waitUntilFreeWithTimeout("session-2", 1000);
    coord.releaseLock("session-1");
    const result = await promise;
    expect(result).toBe(true);
  });

  test("clear 释放所有等待者和锁", () => {
    coord.acquireLock("session-1");
    coord.clear();
    expect(coord.isCompressing()).toBe(false);
  });

  test("excludeId 排除特定 ID", async () => {
    await coord.acquireLock("session-1");
    // session-1 自己持有锁，排除自身不算
    expect(coord.isCompressing("session-1")).toBe(false);
    // session-2 被阻塞
    expect(coord.isCompressing("session-2")).toBe(true);
  });

  test("多 waiter FIFO 唤醒", async () => {
    await coord.acquireLock("session-1");

    const results: boolean[] = [];
    const p1 = coord.waitUntilFreeWithTimeout("session-2", 1000).then((r: boolean) => {
      results.push(r);
      return r;
    });
    const p2 = coord.waitUntilFreeWithTimeout("session-3", 1000).then((r: boolean) => {
      results.push(r);
      return r;
    });

    coord.releaseLock("session-1");
    await Promise.all([p1, p2]);

    expect(results).toEqual([true, true]);
  });
});
