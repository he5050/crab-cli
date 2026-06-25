/**
 * circuitBreaker 模块单元测试
 *
 * 测试目标:
 * - 状态转换逻辑（CLOSED → OPEN → HALF_OPEN → CLOSED）
 * - 失败阈值触发熔断
 * - 恢复超时后进入半开状态
 * - 半开状态下成功则关闭，失败则重新打开
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
  CircuitBreaker,
  getCircuitBreaker,
  clearCircuitBreakers,
  withCircuitBreaker,
} from "@/api/resilience/circuitBreaker";

describe("CircuitBreaker 状态转换", () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      threshold: 3,
      timeoutMs: 1000,
      halfOpenMaxAttempts: 1,
    });
  });

  it("初始状态应该是 CLOSED", () => {
    expect(breaker.getState()).toBe("CLOSED");
  });

  it("在失败次数达到阈值时应该切换到 OPEN 状态", () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getState()).toBe("OPEN");
  });

  it("在 OPEN 状态下 isOpen() 应返回 true", () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(true);
  });

  it("在 recoveryTimeout 后应该切换到 HALF_OPEN 状态", async () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getState()).toBe("OPEN");

    // 等待恢复超时
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(breaker.getState()).toBe("HALF_OPEN");
  });

  it("在 HALF_OPEN 状态下成功应该切换到 CLOSED", async () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();

    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(breaker.getState()).toBe("HALF_OPEN");

    breaker.recordSuccess();
    expect(breaker.getState()).toBe("CLOSED");
  });

  it("在 HALF_OPEN 状态下失败应该重新切换到 OPEN", async () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();

    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(breaker.getState()).toBe("HALF_OPEN");

    breaker.recordFailure();
    expect(breaker.getState()).toBe("OPEN");
  });
});

describe("CircuitBreaker 统计信息", () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      threshold: 3,
      timeoutMs: 1000,
      halfOpenMaxAttempts: 1,
    });
  });

  it("应该正确记录失败次数", () => {
    breaker.recordFailure();
    breaker.recordFailure();
    const stats = breaker.getStats();
    expect(stats.failureCount).toBe(2);
  });

  it("应该在状态重置时清零统计", () => {
    breaker.recordFailure();
    breaker.reset();
    const stats = breaker.getStats();
    expect(stats.failureCount).toBe(0);
    expect(stats.state).toBe("CLOSED");
  });

  it("应该记录最后失败时间", () => {
    const beforeTime = Date.now();
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    const afterTime = Date.now();

    const stats = breaker.getStats();
    expect(stats.lastFailureTime).toBeGreaterThanOrEqual(beforeTime);
    expect(stats.lastFailureTime).toBeLessThanOrEqual(afterTime);
  });

  it("应该在 OPEN 状态下计算剩余等待时间", () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();

    const stats = breaker.getStats();
    expect(stats.timeUntilRetryMs).toBeGreaterThan(0);
    expect(stats.timeUntilRetryMs).toBeLessThanOrEqual(1000);
  });
});

describe("CircuitBreaker 配置验证", () => {
  it("应该接受默认配置", () => {
    const breaker = new CircuitBreaker();
    expect(breaker.getState()).toBe("CLOSED");
  });

  it("应该接受自定义配置", () => {
    const breaker = new CircuitBreaker({
      threshold: 5,
      timeoutMs: 5000,
      halfOpenMaxAttempts: 3,
    });
    expect(breaker.getState()).toBe("CLOSED");
  });
});

describe("getCircuitBreaker 单例模式", () => {
  beforeEach(() => {
    clearCircuitBreakers();
  });

  it("应该为相同的 key 返回相同的实例", () => {
    const breaker1 = getCircuitBreaker("test-key");
    const breaker2 = getCircuitBreaker("test-key");
    expect(breaker1).toBe(breaker2);
  });

  it("应该为不同的 key 返回不同的实例", () => {
    const breaker1 = getCircuitBreaker("key-1");
    const breaker2 = getCircuitBreaker("key-2");
    expect(breaker1).not.toBe(breaker2);
  });

  it("应该支持 providerId + modelId 组合键", () => {
    const breaker1 = getCircuitBreaker("openai", "gpt-4");
    const breaker2 = getCircuitBreaker("openai", "gpt-4");
    const breaker3 = getCircuitBreaker("openai", "gpt-3.5");
    expect(breaker1).toBe(breaker2);
    expect(breaker1).not.toBe(breaker3);
  });
});

describe("withCircuitBreaker 包装器", () => {
  it("应该在成功时记录成功并返回所有事件", async () => {
    const breaker = new CircuitBreaker({
      threshold: 3,
      timeoutMs: 1000,
      halfOpenMaxAttempts: 1,
    });

    async function* genFactory() {
      yield "event1";
      yield "event2";
    }

    const results: string[] = [];
    for await (const item of withCircuitBreaker(breaker, genFactory)) {
      results.push(item as string);
    }

    expect(results).toEqual(["event1", "event2"]);
    expect(breaker.getStats().failureCount).toBe(0);
  });

  it("应该在失败时记录失败并抛出错误", async () => {
    const breaker = new CircuitBreaker({
      threshold: 3,
      timeoutMs: 1000,
      halfOpenMaxAttempts: 1,
    });

    try {
      for await (const _ of withCircuitBreaker(breaker, async function* () {
        yield "event1";
        throw new Error("Test error");
      })) {
        // consume
      }
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as Error).message).toBe("Test error");
    }

    expect(breaker.getStats().failureCount).toBe(1);
  });

  it("应该在熔断时快速失败", async () => {
    const breaker = new CircuitBreaker({
      threshold: 2,
      timeoutMs: 1000,
      halfOpenMaxAttempts: 1,
    });

    // 触发熔断
    breaker.recordFailure();
    breaker.recordFailure();

    expect(breaker.isOpen()).toBe(true);

    try {
      for await (const _ of withCircuitBreaker(breaker, async function* () {
        yield 1;
      })) {
        // consume
      }
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("Circuit breaker is OPEN");
    }
  });
});

describe("边界条件", () => {
  it("应该处理连续成功后重置失败计数", () => {
    const breaker = new CircuitBreaker({ threshold: 3 });
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getStats().failureCount).toBe(2);

    breaker.recordSuccess();
    expect(breaker.getStats().failureCount).toBe(0);
  });

  it("应该处理 halfOpenMaxAttempts > 1", async () => {
    const breaker = new CircuitBreaker({
      threshold: 1,
      timeoutMs: 100,
      halfOpenMaxAttempts: 2,
    });

    breaker.recordFailure(); // → OPEN
    await new Promise((resolve) => setTimeout(resolve, 150));

    // 必须先调用 getState() 或 isOpen() 触发 OPEN → HALF_OPEN 转换
    expect(breaker.getState()).toBe("HALF_OPEN");

    breaker.recordSuccess(); // 第1次成功 → successCount=1
    expect(breaker.getState()).toBe("HALF_OPEN"); // 还需要1次成功

    breaker.recordSuccess(); // 第2次成功 → successCount=2 >= 2 → CLOSED
    expect(breaker.getState()).toBe("CLOSED"); // 现在关闭了
  });
});
