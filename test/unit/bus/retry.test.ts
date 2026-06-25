/**
 * 重试机制测试。
 *
 * 测试用例:
 *   - 成功不重试
 *   - 失败重试策略
 *   - 自定义重试条件
 */
import { describe, expect, test } from "bun:test";
import { retry } from "@/core/concurrency/retry";

describe("Retry — 重试逻辑", () => {
  test("成功不重试", async () => {
    let calls = 0;
    const result = await retry(async () => {
      calls++;
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  test("失败重试 N 次后抛错", async () => {
    let calls = 0;
    await expect(
      retry(
        async () => {
          calls++;
          throw new Error("fail");
        },
        { initialDelay: 10, maxRetries: 2 },
      ),
    ).rejects.toThrow("fail");
    expect(calls).toBe(3); // 1 初始 + 2 重试
  });

  test("retryable 返回 false 不重试", async () => {
    let calls = 0;
    await expect(
      retry(
        async () => {
          calls++;
          throw new Error("nope");
        },
        { initialDelay: 10, maxRetries: 3, retryable: (err) => false },
      ),
    ).rejects.toThrow("nope");
    expect(calls).toBe(1);
  });

  test("第 N 次成功后返回结果", async () => {
    let calls = 0;
    const result = await retry(
      async () => {
        calls++;
        if (calls < 3) {
          throw new Error("not yet");
        }
        return "finally";
      },
      { initialDelay: 10, maxRetries: 3 },
    );
    expect(result).toBe("finally");
    expect(calls).toBe(3);
  });
});
