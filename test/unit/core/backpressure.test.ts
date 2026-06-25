/**
 * 背压(TokenBucket / RequestQueue / BackpressureMonitor)测试。
 *
 * 测试用例:
 *   - TokenBucket 消耗与补充
 *   - RequestQueue 排队
 *   - BackpressureMonitor 状态监控
 *   - tryAcquireExecutionPermit / getBackpressureStatus
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  BackpressureMonitor,
  RequestQueue,
  TokenBucket,
  getBackpressureStatus,
  tryAcquireExecutionPermit,
} from "@/core/concurrency/backpressure";

describe("TokenBucket", () => {
  let bucket: TokenBucket;

  beforeEach(() => {
    bucket = new TokenBucket(10, 5);
  });

  test("初始状态有满桶令牌", () => {
    expect(bucket.getTokens()).toBe(10);
    const status = bucket.getStatus();
    expect(status.tokens).toBe(10);
    expect(status.capacity).toBe(10);
    expect(status.utilization).toBe(0);
  });

  test("tryAcquire 消耗令牌", () => {
    expect(bucket.tryAcquire()).toBe(true);
    expect(bucket.getTokens()).toBeCloseTo(9, 0);
  });

  test("令牌耗尽后 tryAcquire 返回 false", () => {
    const b = new TokenBucket(3, 10);
    expect(b.tryAcquire()).toBe(true);
    expect(b.tryAcquire()).toBe(true);
    expect(b.tryAcquire()).toBe(true);
    expect(b.tryAcquire()).toBe(false);
  });

  test("acquire 在令牌可用时快速返回", async () => {
    const b = new TokenBucket(1, 10);
    await b.acquire();
    expect(b.getTokens()).toBe(0);
  });

  test("令牌随时间补充", async () => {
    const b = new TokenBucket(5, 100);
    for (let i = 0; i < 5; i++) {
      b.tryAcquire();
    }
    expect(b.tryAcquire()).toBe(false);
    await new Promise((r) => setTimeout(r, 50));
    expect(b.tryAcquire()).toBe(true);
  });

  test("getStatus 返回正确利用率", () => {
    const b = new TokenBucket(10, 5);
    b.tryAcquire();
    b.tryAcquire();
    b.tryAcquire();
    const status = b.getStatus();
    expect(status.utilization).toBeGreaterThan(0);
    expect(status.utilization).toBeLessThanOrEqual(100);
  });
});

describe("RequestQueue", () => {
  let queue: RequestQueue;

  beforeEach(() => {
    queue = new RequestQueue(2);
  });

  test("入队请求并执行", async () => {
    const result = await queue.enqueue<string>({
      execute: async () => "done",
      id: "test-1",
      type: "test",
    });
    expect(result).toBe("done");
  });

  test("并发控制限制最大活跃数", async () => {
    const q = new RequestQueue(1);
    const results: string[] = [];
    const p1 = q.enqueue({
      execute: async () => {
        await new Promise((r) => setTimeout(r, 100));
        results.push("1");
        return "1";
      },
      id: "slow-1",
      type: "test",
    });
    const p2 = q.enqueue({
      execute: async () => {
        results.push("2");
        return "2";
      },
      id: "fast-2",
      type: "test",
    });
    await Promise.all([p1, p2]);
    expect(results).toEqual(["1", "2"]);
  });

  test("清空队列拒绝等待中的请求", async () => {
    const q = new RequestQueue(1);
    const p1 = q.enqueue({
      execute: async () => {
        await new Promise((r) => setTimeout(r, 200));
        return "ok";
      },
      id: "blocking",
      type: "test",
    });
    q.clear();
    await expect(p1).resolves.toBe("ok");
  });

  test("getStatus 返回状态", () => {
    const status = queue.getStatus();
    expect(status).toHaveProperty("queueLength");
    expect(status).toHaveProperty("activeCount");
    expect(status).toHaveProperty("maxConcurrent");
    expect(status).toHaveProperty("utilization");
    expect(status).toHaveProperty("backlog");
  });
});

describe("BackpressureMonitor", () => {
  let monitor: BackpressureMonitor;

  beforeEach(() => {
    monitor = new BackpressureMonitor();
  });

  test("初始压力为 none", () => {
    const status = monitor.getStatus();
    expect(status.pressureLevel).toBe("none");
    expect(status.isBackpressured).toBe(false);
  });

  test("高使用率时压力上升", async () => {
    for (let i = 0; i < 50; i++) {
      monitor.tryAcquire();
    }
    const status = monitor.getStatus();
    expect(status.tokenBucketUtilization).toBeGreaterThan(0);
  });

  test("submit 请求到队列", async () => {
    const result = await monitor.submit<string>({
      execute: async () => "ok",
      id: "monitor-test",
      type: "test",
    });
    expect(result).toBe("ok");
  });

  test("获取底层组件", () => {
    expect(monitor.getBucket()).toBeInstanceOf(TokenBucket);
    expect(monitor.getQueue()).toBeInstanceOf(RequestQueue);
  });
});
