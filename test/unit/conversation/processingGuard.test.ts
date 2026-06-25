/**
 * ProcessingGuard 处理锁测试
 *
 * 覆盖 P1-3 + P2-5 重构
 *   1. 互斥:双重 acquire 抛错
 *   2. 释放后可重新获取
 *   3. abortSignal 触发时自动释放
 *   4. 超时自动释放
 *   5. forceReset 紧急恢复
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { ProcessingGuard } from "@/conversation/guard/processingGuard";

describe("ProcessingGuard 处理锁 (P1-3/P2-5)", () => {
  let guard: ProcessingGuard;

  beforeEach(() => {
    guard = new ProcessingGuard({ name: "test-guard" });
  });

  afterEach(() => {
    guard.forceReset();
  });

  it("初始状态空闲", () => {
    expect(guard.isBusy()).toBe(false);
  });

  it("acquire 后状态为忙碌", () => {
    guard.acquire();
    expect(guard.isBusy()).toBe(true);
  });

  it("双重 acquire 抛出错误", () => {
    guard.acquire();
    expect(() => guard.acquire()).toThrow("已被持有");
  });

  it("release 后可重新 acquire", () => {
    guard.acquire();
    guard.release();
    expect(guard.isBusy()).toBe(false);
    expect(() => guard.acquire()).not.toThrow();
  });

  it("已中止的 abortSignal acquire 抛错", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => guard.acquire(controller.signal)).toThrow("中止信号已触发");
  });

  it("abortSignal 触发后自动 release", () => {
    const controller = new AbortController();
    guard.acquire(controller.signal);
    expect(guard.isBusy()).toBe(true);
    controller.abort();
    expect(guard.isBusy()).toBe(false);
  });

  it("abortSignal 释放后 isBusy=false", () => {
    const controller = new AbortController();
    guard.acquire(controller.signal);
    controller.abort();
    expect(guard.isBusy()).toBe(false);
  });

  it("forceReset 在异常路径也能恢复", () => {
    guard.acquire();
    // 模拟忘记 release
    guard.forceReset();
    expect(guard.isBusy()).toBe(false);
    expect(() => guard.acquire()).not.toThrow();
  });

  it("超时后自动 release(极短超时)", async () => {
    const shortGuard = new ProcessingGuard({ name: "short", timeoutMs: 50 });
    shortGuard.acquire();
    expect(shortGuard.isBusy()).toBe(true);
    await new Promise((r) => setTimeout(r, 80));
    expect(shortGuard.isBusy()).toBe(false);
  });

  it("release 已未持有的 guard 不抛错", () => {
    expect(() => guard.release()).not.toThrow();
  });

  it("不同 guard 实例独立工作", () => {
    const guard2 = new ProcessingGuard({ name: "other" });
    guard.acquire();
    expect(() => guard2.acquire()).not.toThrow();
    expect(guard.isBusy()).toBe(true);
    expect(guard2.isBusy()).toBe(true);
  });

  it("无 abortSignal 时仍能正常工作", () => {
    expect(() => guard.acquire()).not.toThrow();
    expect(guard.isBusy()).toBe(true);
    guard.release();
    expect(guard.isBusy()).toBe(false);
  });
});
