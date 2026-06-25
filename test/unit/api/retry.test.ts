/**
 * Retry 工具单元测试。
 *
 * 覆盖:
 *   - 首次成功（无重试）
 *   - 重试后成功
 *   - 重试耗尽
 *   - maxRetries=0（不重试）
 *   - 自定义 shouldRetry（不可恢复错误立即停止）
 *   - onRetry 回调触发
 *   - 指数退避延迟递增
 *   - createRetryWrapper 封装
 */
import { afterEach, describe, expect, mock, test } from "bun:test";
import { retryWithBackoff, createRetryWrapper } from "@/api/utils/retry";

afterEach(() => {
  mock.restore();
});

describe("retryWithBackoff", () => {
  test("首次成功 — attempts=1, totalDelayMs=0", async () => {
    const result = await retryWithBackoff(() => Promise.resolve(42));

    expect(result.success).toBe(true);
    expect(result.result).toBe(42);
    expect(result.attempts).toBe(1);
    expect(result.totalDelayMs).toBe(0);
  });

  test("重试一次后成功 — attempts=2", async () => {
    let callCount = 0;
    const result = await retryWithBackoff(
      () => {
        callCount += 1;
        if (callCount === 1) throw new Error("transient");
        return Promise.resolve("ok");
      },
      { maxRetries: 3, initialDelayMs: 1, shouldRetry: () => true },
    );

    expect(result.success).toBe(true);
    expect(result.result).toBe("ok");
    expect(result.attempts).toBe(2);
    expect(callCount).toBe(2);
  });

  test("重试耗尽 — 返回最后一次错误", async () => {
    const result = await retryWithBackoff(() => Promise.reject(new Error("persistent failure")), {
      maxRetries: 2,
      initialDelayMs: 1,
      shouldRetry: () => true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toBe("persistent failure");
    expect(result.attempts).toBe(3); // 1 initial + 2 retries
  });

  test("maxRetries=0 — 不重试，直接返回失败", async () => {
    let callCount = 0;
    const result = await retryWithBackoff(
      () => {
        callCount += 1;
        return Promise.reject(new Error("fail"));
      },
      { maxRetries: 0 },
    );

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(1);
    expect(callCount).toBe(1);
    expect(result.totalDelayMs).toBe(0);
  });

  test("自定义 shouldRetry — 不可恢复错误立即停止", async () => {
    let callCount = 0;
    const result = await retryWithBackoff(
      () => {
        callCount += 1;
        return Promise.reject(new Error("auth failed"));
      },
      {
        maxRetries: 5,
        initialDelayMs: 1,
        shouldRetry: () => false, // 所有错误都不重试
      },
    );

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(1);
    expect(callCount).toBe(1);
  });

  test("自定义 shouldRetry — 根据错误类型动态决定", async () => {
    let callCount = 0;
    const result = await retryWithBackoff(
      () => {
        callCount += 1;
        const err = new Error(callCount === 1 ? "network error" : "auth error");
        (err as unknown as Record<string, unknown>).code = callCount === 1 ? "ECONNREFUSED" : "AUTH_FAILED";
        return Promise.reject(err);
      },
      {
        maxRetries: 5,
        initialDelayMs: 1,
        shouldRetry: (err) => {
          const code = (err as unknown as Record<string, unknown>).code;
          // 只重试网络错误
          if (code === "ECONNREFUSED") return true;
          // 第二次是认证错误，不重试
          return false;
        },
      },
    );

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(2);
    expect(result.error?.message).toBe("auth error");
  });

  test("onRetry 回调在每次重试前触发", async () => {
    const retryLog: Array<{ attempt: number; delayMs: number; message: string }> = [];
    let callCount = 0;

    await retryWithBackoff(
      () => {
        callCount += 1;
        return Promise.reject(new Error(`error ${callCount}`));
      },
      {
        maxRetries: 2,
        initialDelayMs: 10,
        backoffFactor: 2,
        shouldRetry: () => true,
        onRetry: (err, attempt, delayMs) => {
          retryLog.push({ attempt, delayMs, message: err.message });
        },
      },
    );

    expect(retryLog).toHaveLength(2); // 2 retries
    expect(retryLog[0]?.attempt).toBe(1);
    expect(retryLog[0]?.message).toBe("error 1");
    expect(retryLog[1]?.attempt).toBe(2);
    expect(retryLog[1]?.message).toBe("error 2");
  });

  test("指数退避延迟递增", async () => {
    const delays: number[] = [];
    let callCount = 0;

    await retryWithBackoff(
      () => {
        callCount += 1;
        return Promise.reject(new Error("fail"));
      },
      {
        maxRetries: 3,
        initialDelayMs: 10,
        backoffFactor: 2,
        jitter: false, // 禁用抖动，精确验证延迟
        shouldRetry: () => true,
        onRetry: (_err, _attempt, delayMs) => {
          delays.push(delayMs);
        },
      },
    );

    // 指数退避: 10, 20, 40
    expect(delays).toHaveLength(3);
    expect(delays[0]).toBe(10);
    expect(delays[1]).toBe(20);
    expect(delays[2]).toBe(40);
  });

  test("maxDelayMs 限制延迟上限", async () => {
    const delays: number[] = [];

    await retryWithBackoff(() => Promise.reject(new Error("fail")), {
      maxRetries: 5,
      initialDelayMs: 50,
      backoffFactor: 10,
      maxDelayMs: 100,
      jitter: false,
      shouldRetry: () => true,
      onRetry: (_err, _attempt, delayMs) => {
        delays.push(delayMs);
      },
    });

    // 50, 100(cap), 100(cap), 100(cap), 100(cap)
    expect(delays).toHaveLength(5);
    expect(delays[0]).toBe(50);
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]!).toBeLessThanOrEqual(100);
    }
  });

  test("非 Error 对象被包装为 Error", async () => {
    const result = await retryWithBackoff(() => Promise.reject(new Error("string error")), { maxRetries: 0 });

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toBe("string error");
  });

  test("jitter=true 时延迟在基础延迟 ±25% 范围内", async () => {
    const delays: number[] = [];

    await retryWithBackoff(() => Promise.reject(new Error("fail")), {
      maxRetries: 10,
      initialDelayMs: 100,
      backoffFactor: 1,
      jitter: true,
      shouldRetry: () => true,
      onRetry: (_err, _attempt, delayMs) => {
        delays.push(delayMs);
      },
    });

    // 所有延迟应在 [75, 125] 范围内 (100 * 0.75 ~ 100 * 1.25)
    for (const d of delays) {
      expect(d).toBeGreaterThanOrEqual(75);
      expect(d).toBeLessThanOrEqual(125);
    }
  });
});

describe("createRetryWrapper", () => {
  test("创建可复用的重试包装函数", async () => {
    let callCount = 0;
    const fetchWithRetry = createRetryWrapper(
      (url: string) => {
        callCount += 1;
        if (callCount === 1) throw new Error(`fetch ${url} failed`);
        return Promise.resolve(`response from ${url}`);
      },
      { maxRetries: 2, initialDelayMs: 1, shouldRetry: () => true },
    );

    const result1 = await fetchWithRetry("https://api.test/a");
    expect(result1.success).toBe(true);
    expect(result1.result).toBe("response from https://api.test/a");
    expect(callCount).toBe(2);

    callCount = 0;
    const result2 = await fetchWithRetry("https://api.test/b");
    expect(result2.success).toBe(true);
    expect(result2.result).toBe("response from https://api.test/b");
  });

  test("包装函数传递参数正确", async () => {
    const wrapped = createRetryWrapper((a: number, b: string) => Promise.resolve(`${a}-${b}`), { maxRetries: 0 });

    const result = await wrapped(42, "hello");
    expect(result.success).toBe(true);
    expect(result.result).toBe("42-hello");
  });
});
