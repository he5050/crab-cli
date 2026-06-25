/**
 * G-13 流式空闲超时守卫测试。
 *
 * 测试用例:
 *   - L3-T10: LLM 流空闲超时后自动中断连接
 *   - L3-T11: 正常流响应不触发超时中断
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createIdleTimeoutGuard } from "@/conversation/stream/idleTimeoutGuard";

describe("G-13 流式空闲超时守卫", () => {
  let guard: ReturnType<typeof createIdleTimeoutGuard>;
  let timeoutCalled: boolean;

  beforeEach(() => {
    timeoutCalled = false;
  });

  afterEach(() => {
    guard?.destroy();
  });

  it("L3-T10: 超时后自动中断", async () => {
    guard = createIdleTimeoutGuard(50, () => {
      timeoutCalled = true;
    });

    // 50ms 后应触发
    await new Promise((r) => setTimeout(r, 100));
    expect(timeoutCalled).toBe(true);
  });

  it("L3-T10: destroy 后不触发超时", async () => {
    guard = createIdleTimeoutGuard(50, () => {
      timeoutCalled = true;
    });
    guard.destroy();

    await new Promise((r) => setTimeout(r, 100));
    expect(timeoutCalled).toBe(false);
  });

  it("L3-T11: touch 重置计时器后不触发超时", async () => {
    guard = createIdleTimeoutGuard(100, () => {
      timeoutCalled = true;
    });

    // 持续 touch 防止超时
    const interval = setInterval(() => guard?.touch(), 30);
    await new Promise((r) => setTimeout(r, 200));
    clearInterval(interval);

    expect(timeoutCalled).toBe(false);
    guard.destroy();
  });
});
