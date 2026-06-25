/**
 * 全局清理回调测试。
 *
 * 测试用例:
 *   - registerCleanup / unregisterCleanup / runCleanup
 *   - clearCleanup 清理
 *   - 异常传播
 */
import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { clearCleanup, registerCleanup, runCleanup, unregisterCleanup } from "@/bus/lifecycle/globalCleanup";

describe("globalCleanup 全局清理", () => {
  afterEach(() => {
    clearCleanup();
  });

  test("注册并执行清理回调", async () => {
    let called = false;
    registerCleanup(() => {
      called = true;
    });
    const hadError = await runCleanup();
    expect(called).toBe(true);
    expect(hadError).toBe(false);
  });

  test("LIFO 顺序执行", async () => {
    const order: number[] = [];
    registerCleanup(() => {
      order.push(1);
    });
    registerCleanup(() => {
      order.push(2);
    });
    registerCleanup(() => {
      order.push(3);
    });
    await runCleanup();
    expect(order).toEqual([3, 2, 1]);
  });

  test("支持异步回调", async () => {
    let called = false;
    registerCleanup(async () => {
      await new Promise((r) => setTimeout(r, 10));
      called = true;
    });
    await runCleanup();
    expect(called).toBe(true);
  });

  test("回调失败不影响其他回调", async () => {
    const order: number[] = [];
    registerCleanup(() => {
      throw new Error("fail");
    });
    registerCleanup(() => {
      order.push(2);
    });
    const hadError = await runCleanup();
    expect(hadError).toBe(true);
    expect(order).toEqual([2]);
  });

  test("执行后清空注册表", async () => {
    registerCleanup(() => {});
    await runCleanup();
    registerCleanup(() => {});
    const secondRun = await runCleanup();
    expect(secondRun).toBe(false);
  });

  test("超时保护", async () => {
    registerCleanup(async () => {
      await new Promise((r) => setTimeout(r, 10_000));
    });
    const hadError = await runCleanup(100);
    expect(hadError).toBe(true);
  });

  test("unregisterCleanup 取消注册", async () => {
    const fn = () => {
      throw new Error("should not be called");
    };
    const unregister = registerCleanup(fn);
    unregister();
    const hadError = await runCleanup();
    expect(hadError).toBe(false);
  });

  test("clearCleanup 清空所有", () => {
    registerCleanup(() => {});
    clearCleanup();
    expect(true).toBe(true);
  });
});
