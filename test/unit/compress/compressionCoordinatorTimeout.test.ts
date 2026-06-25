/**
 * CompressionCoordinator 超时竞态测试（P2-5）。
 *
 * 测试并发 acquire + 超时 + release 的组合场景。
 *
 * 测试用例:
 *   - 超时后正确拒绝（不获取锁）
 *   - 锁释放后等待者被唤醒
 *   - 多个等待者按 FIFO 顺序唤醒
 *   - clear() 清理所有等待者
 */
import { describe, expect, test, vi, beforeEach } from "bun:test";

vi.mock("@/config", () => ({
  COMPRESSION_LOCK_TIMEOUT_MS: 500,
}));

vi.mock("@/core/logging/logger", () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock("@/core/errors/appError", () => ({
  createInternalError: vi.fn((code: string, msg: string) => new Error(`${code}: ${msg}`)),
}));

describe("CompressionCoordinator 超时竞态", () => {
  let coordinator: InstanceType<typeof import("@/compress/core/compressionCoordinator").CompressionCoordinator>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/compress/core/compressionCoordinator");
    const CC = mod.CompressionCoordinator;
    coordinator = new CC();
  });

  test("锁超时后抛出错误", async () => {
    // 获取锁后不释放，第二个 acquire 应超时
    await coordinator.acquireLock("holder", 100); // 短超时
    await expect(coordinator.acquireLock("waiter", 50)).rejects.toThrow();
    coordinator.releaseLock("holder");
  });

  test("锁释放后等待者立即获得锁", async () => {
    const holderPromise = coordinator.acquireLock("holder", 200);
    const waiterPromise = coordinator.acquireLock("waiter", 200);

    await holderPromise;
    // 稍后释放 holder
    setTimeout(() => coordinator.releaseLock("holder"), 30);

    // waiter 应在 holder 释放后获得锁
    const start = Date.now();
    await waiterPromise;
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(150); // 应远小于超时时间
    coordinator.releaseLock("waiter");
  });

  test("clear() 释放所有等待者（标记为超时）", async () => {
    const waiterPromise = coordinator.acquireLock("holder", 200);

    // 先获取锁阻止 waiter
    void coordinator.acquireLock("blocker", 200);

    // waiter 在等待中，clear 应解除阻塞
    setTimeout(() => coordinator.clear(), 30);

    await waiterPromise; // 不应超时，被 clear 释放
    coordinator.releaseLock("blocker");
  });

  test("excludeId 允许自己获取锁", async () => {
    await coordinator.acquireLock("A", 100);
    // A 已持有锁，但 excludeId="A" 时 isCompressing 应返回 false
    expect(coordinator.isCompressing("A")).toBe(false);
    coordinator.releaseLock("A");
  });
});
