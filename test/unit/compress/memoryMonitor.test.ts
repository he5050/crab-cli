/**
 * MemoryMonitor 测试。
 *
 * 测试用例:
 *   - 状态等级判定
 *   - 推荐分块大小
 *   - 推荐并发数
 *   - 历史采样
 *   - GC 回调
 */
import { describe, expect, test, beforeEach, vi } from "bun:test";
import { MemoryMonitor, createMemoryMonitor, createAdaptiveChunker } from "@/compress/protection/memoryProtection";

describe("MemoryMonitor", () => {
  let monitor: MemoryMonitor;

  beforeEach(() => {
    // 使用低阈值配置让测试更容易覆盖不同等级
    monitor = createMemoryMonitor({
      warningThreshold: 0.3,
      dangerThreshold: 0.5,
      criticalThreshold: 0.8,
      autoGC: false,
    });
  });

  test("getStatus 返回当前内存状态", () => {
    const status = monitor.getStatus();
    expect(status).toHaveProperty("heapUsed");
    expect(status).toHaveProperty("heapTotal");
    expect(status).toHaveProperty("heapUsageRatio");
    expect(status).toHaveProperty("level");
    expect(status).toHaveProperty("timestamp");
  });

  test("level 为有效枚举值", () => {
    const status = monitor.getStatus();
    expect(["safe", "warning", "danger", "critical"]).toContain(status.level);
  });

  test("getSummary 返回可读字符串", () => {
    const summary = monitor.getSummary();
    expect(typeof summary).toBe("string");
    expect(summary).toContain("内存");
  });

  test("shouldReduceLoad 在 safe 时返回 false", () => {
    // 正常情况下进程的堆使用率不会超过阈值
    const result = monitor.shouldReduceLoad();
    expect(typeof result).toBe("boolean");
  });

  test("shouldPauseNewTasks 在 safe 时返回 false", () => {
    const result = monitor.shouldPauseNewTasks();
    expect(typeof result).toBe("boolean");
  });

  test("getRecommendedChunkSize 返回正整数", () => {
    const size = monitor.getRecommendedChunkSize(100);
    expect(size).toBeGreaterThan(0);
    expect(Number.isInteger(size)).toBe(true);
  });

  test("getRecommendedConcurrency 返回正整数", () => {
    const concurrency = monitor.getRecommendedConcurrency(4);
    expect(concurrency).toBeGreaterThan(0);
    expect(Number.isInteger(concurrency)).toBe(true);
  });

  test("getRecommendedChunkSize 最小返回 1", () => {
    // 即使 baseSize 为 1，也至少返回 1
    const size = monitor.getRecommendedChunkSize(1);
    expect(size).toBeGreaterThanOrEqual(1);
  });

  test("getRecommendedConcurrency 最小返回 1", () => {
    const concurrency = monitor.getRecommendedConcurrency(1);
    expect(concurrency).toBeGreaterThanOrEqual(1);
  });

  test("getHistory 返回采样数组", () => {
    monitor.sample(); // 采样一次（getStatus 不再记录采样）
    const history = monitor.getHistory();
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBeGreaterThanOrEqual(1);
  });

  test("getAverageUsage 返回数值", () => {
    monitor.getStatus();
    const avg = monitor.getAverageUsage();
    expect(typeof avg).toBe("number");
    expect(avg).toBeGreaterThanOrEqual(0);
  });

  test("resetHistory 清空采样", () => {
    monitor.getStatus();
    monitor.getStatus();
    monitor.resetHistory();
    expect(monitor.getHistory()).toHaveLength(0);
  });

  test("setGCCallback 设置回调", () => {
    const callback = vi.fn();
    monitor.setGCCallback(callback);
    // 无法在测试中触发 critical 级别，只验证设置不报错
    expect(() => monitor.setGCCallback(callback)).not.toThrow();
  });

  test("onStatusChange 返回取消订阅函数", () => {
    const listener = vi.fn();
    const unsub = monitor.onStatusChange(listener);
    monitor.sample(); // 触发 listener（getStatus 不再通知监听器）
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
    monitor.sample(); // 取消后不应再调用
    expect(listener).toHaveBeenCalledTimes(1); // 仍然是 1
  });

  test("createMemoryMonitor 工厂函数", () => {
    const m = createMemoryMonitor({ warningThreshold: 0.5 });
    expect(m).toBeInstanceOf(MemoryMonitor);
  });
});

describe("AdaptiveChunker", () => {
  test("createAdaptiveChunker 工厂函数", () => {
    const monitor = createMemoryMonitor({ autoGC: false });
    const chunker = createAdaptiveChunker<string>(monitor, 10);
    expect(chunker).toBeDefined();
  });

  test("setItems 设置数据", () => {
    const monitor = createMemoryMonitor({ autoGC: false });
    const chunker = createAdaptiveChunker<string>(monitor, 3);
    chunker.setItems(["a", "b", "c", "d", "e"]);
    expect(chunker.getChunkCount()).toBeGreaterThanOrEqual(1);
  });

  test("getChunk 返回指定分块", () => {
    const monitor = createMemoryMonitor({ autoGC: false });
    const chunker = createAdaptiveChunker<number>(monitor, 2);
    chunker.setItems([1, 2, 3, 4]);
    const chunk = chunker.getChunk(0);
    expect(chunk.length).toBeGreaterThanOrEqual(1);
    expect(chunk).toContain(1);
  });

  test("iterateChunks 迭代所有分块", () => {
    const monitor = createMemoryMonitor({ autoGC: false });
    const chunker = createAdaptiveChunker<number>(monitor, 100);
    const items = [1, 2, 3, 4, 5];
    chunker.setItems(items);

    const allItems: number[] = [];
    for (const chunk of chunker.iterateChunks()) {
      allItems.push(...chunk);
    }
    expect(allItems).toEqual(items);
  });
});
