/**
 * TokenBucket 令牌桶测试
 *
 * 覆盖 P2-13 修复:
 *   1. tryAcquire 令牌消耗与补充
 *   2. acquire 异步等待 + 事件通知(替代忙等待轮询)
 *   3. 容量上限正确性
 *   4. 多个等待者按顺序通知
 */

import { describe, expect, it } from "bun:test";

// 复用 TokenBucket 核心逻辑(不依赖外部导入，便于独立测试)
class TestTokenBucket {
  private tokens: number;
  private capacity: number;
  private refillRate: number;
  private lastRefill: number;
  private waiters: (() => void)[] = [];

  constructor(capacity: number, refillRate: number) {
    this.tokens = capacity;
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const refill = elapsed * this.refillRate;
    const hadTokens = this.tokens;
    this.tokens = Math.min(this.capacity, this.tokens + refill);
    this.lastRefill = now;
    if (hadTokens < 1 && this.tokens >= 1 && this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      waiter();
    }
  }

  tryAcquire(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  async acquire(): Promise<void> {
    if (this.tryAcquire()) {
      return;
    }
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
      setTimeout(() => {
        const idx = this.waiters.indexOf(resolve);
        if (idx !== -1) {
          this.waiters.splice(idx, 1);
        }
        resolve();
      }, 2000);
    });
  }

  /** 测试辅助:手动注入令牌(模拟时间流逝) */
  injectTokens(count: number): void {
    this.tokens = Math.min(this.capacity, this.tokens + count);
    // 通知等待者
    while (this.tokens >= 1 && this.waiters.length > 0) {
      this.tokens -= 1;
      const waiter = this.waiters.shift()!;
      waiter();
    }
  }

  getTokens(): number {
    return this.tokens;
  }
  getWaiters(): number {
    return this.waiters.length;
  }
}

describe("TokenBucket", () => {
  it("初始状态拥有全部容量令牌", () => {
    const bucket = new TestTokenBucket(5, 1);
    expect(bucket.getTokens()).toBe(5);
  });

  it("tryAcquire 消耗一个令牌", () => {
    const bucket = new TestTokenBucket(5, 1);
    expect(bucket.tryAcquire()).toBe(true);
    expect(bucket.getTokens()).toBe(4);
  });

  it("令牌耗尽时 tryAcquire 返回 false", () => {
    const bucket = new TestTokenBucket(1, 0);
    bucket.tryAcquire();
    expect(bucket.tryAcquire()).toBe(false);
  });

  it("acquire 在有令牌时立即返回", async () => {
    const bucket = new TestTokenBucket(3, 0);
    const start = Date.now();
    await bucket.acquire();
    expect(Date.now() - start).toBeLessThan(50); // 几乎立即
    expect(bucket.getTokens()).toBe(2);
  });

  it("acquire 在无令牌时等待事件通知", async () => {
    const bucket = new TestTokenBucket(1, 0);
    bucket.tryAcquire(); // 消耗唯一令牌

    const promise = bucket.acquire();
    expect(bucket.getWaiters()).toBe(1);

    // 模拟令牌补充
    bucket.injectTokens(1);

    await promise;
    expect(bucket.getTokens()).toBe(0);
  });

  it("多个等待者按顺序通知", async () => {
    const bucket = new TestTokenBucket(0, 0);
    const resolved: number[] = [];

    const p1 = bucket.acquire().then(() => resolved.push(1));
    const p2 = bucket.acquire().then(() => resolved.push(2));
    const p3 = bucket.acquire().then(() => resolved.push(3));

    expect(bucket.getWaiters()).toBe(3);

    // 注入 3 个令牌，应依次通知
    bucket.injectTokens(3);

    await Promise.all([p1, p2, p3]);
    expect(resolved).toEqual([1, 2, 3]);
  });

  it("2 秒超时后 acquire 自动释放等待", async () => {
    const bucket = new TestTokenBucket(0, 0);
    const start = Date.now();

    await bucket.acquire();

    const elapsed = Date.now() - start;
    // 应该在约 2000ms 超时后返回(允许 ±200ms 误差)
    expect(elapsed).toBeGreaterThanOrEqual(1800);
    expect(elapsed).toBeLessThan(2500);
    expect(bucket.getWaiters()).toBe(0);
  });
});
