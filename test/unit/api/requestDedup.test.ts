/**
 * P3-7: requestDedup 缓存过期与去重行为测试
 *
 * 测试目标:
 * - 相同 key 并发请求共享结果
 * - 缓存结果在 TTL 内直接返回
 * - 缓存结果在 TTL 过期后重新执行
 * - 不同 key 独立执行
 * - 工厂错误正确传播
 * - cleanupResultCache 清除过期缓存
 */
import { describe, expect, beforeEach, afterEach, test } from "bun:test";
import {
  withRequestDedup,
  clearRequestDedup,
  getRequestDedupStats,
  cleanupResultCache,
} from "@/api/utils/requestDedup";

describe("requestDedup 并发与缓存", () => {
  beforeEach(() => {
    clearRequestDedup();
  });

  afterEach(() => {
    clearRequestDedup();
  });

  test("相同 key 并发请求共享结果", async () => {
    let callCount = 0;

    const promise1 = withRequestDedup("key-a", async () => {
      callCount++;
      await new Promise((r) => setTimeout(r, 50));
      return "result";
    });

    const promise2 = withRequestDedup("key-a", async () => {
      callCount++;
      await new Promise((r) => setTimeout(r, 50));
      return "other";
    });

    const [r1, r2] = await Promise.all([promise1, promise2]);
    expect(r1).toBe(r2);
    expect(r1).toBe("result");
    expect(callCount).toBe(1);
  });

  test("缓存结果在 TTL 内直接返回", async () => {
    let callCount = 0;

    await withRequestDedup(
      "key-b",
      async () => {
        callCount++;
        return "cached";
      },
      { ttlMs: 500 },
    );

    // Within TTL — should return cached, factory not called again
    const result = await withRequestDedup(
      "key-b",
      async () => {
        callCount++;
        return "new";
      },
      { ttlMs: 500 },
    );

    expect(result).toBe("cached");
    expect(callCount).toBe(1);
  });

  test("缓存结果在 TTL 过期后重新执行", async () => {
    let callCount = 0;

    await withRequestDedup(
      "key-c",
      async () => {
        callCount++;
        return "first";
      },
      { ttlMs: 50 },
    );

    // Wait for TTL to expire
    await new Promise((r) => setTimeout(r, 100));

    const result = await withRequestDedup(
      "key-c",
      async () => {
        callCount++;
        return "second";
      },
      { ttlMs: 50 },
    );

    expect(result).toBe("second");
    expect(callCount).toBe(2);
  });

  test("不同 key 独立执行", async () => {
    let callCount = 0;

    const [r1, r2] = await Promise.all([
      withRequestDedup("key-x", async () => {
        callCount++;
        return "x";
      }),
      withRequestDedup("key-y", async () => {
        callCount++;
        return "y";
      }),
    ]);

    expect(r1).toBe("x");
    expect(r2).toBe("y");
    expect(callCount).toBe(2);
  });

  test("工厂错误正确传播", async () => {
    await expect(
      withRequestDedup("key-err", async () => {
        throw new Error("factory failed");
      }),
    ).rejects.toThrow("factory failed");
  });

  test("错误传播给所有等待的并发调用", async () => {
    const p1 = withRequestDedup("key-err2", async () => {
      await new Promise((r) => setTimeout(r, 30));
      throw new Error("shared error");
    });

    const p2 = withRequestDedup("key-err2", async () => "should not run");

    await expect(p1).rejects.toThrow("shared error");
    await expect(p2).rejects.toThrow("shared error");
  });

  test("cleanupResultCache 清除过期缓存", async () => {
    await withRequestDedup("key-exp", async () => "result", { ttlMs: 50 });

    // Wait for TTL to expire
    await new Promise((r) => setTimeout(r, 100));

    cleanupResultCache();

    const stats = getRequestDedupStats();
    expect(stats.cachedCount).toBe(0);
  });
});
