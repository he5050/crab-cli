/**
 * createDeferredSync 单元测试
 *
 * 验证延迟同步工厂的核心行为:
 *   - schedule() 延迟到下一宏任务
 *   - disposed 守卫阻止执行
 *   - pendingSync 去重防止重复调度
 */
import { describe, expect, it } from "bun:test";
import { createDeferredSync } from "@/ui/utils/deferredSync";

describe("createDeferredSync", () => {
  it("schedule 应在下一宏任务调用 syncFn", async () => {
    let callCount = 0;
    const { schedule } = createDeferredSync(() => {
      callCount++;
    });

    schedule();
    expect(callCount).toBe(0); // 同步时未调用

    // 等待宏任务
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(callCount).toBe(1);
  });

  it("多次 schedule 应只执行一次（去重）", async () => {
    let callCount = 0;
    const { schedule } = createDeferredSync(() => {
      callCount++;
    });

    schedule();
    schedule();
    schedule();

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(callCount).toBe(1);
  });

  it("disposed 后 schedule 不应执行 syncFn", async () => {
    let callCount = 0;
    const { disposed, schedule } = createDeferredSync(() => {
      callCount++;
    });

    disposed.current = true;
    schedule();

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(callCount).toBe(0);
  });

  it("disposed 在 setTimeout 回调中应阻止执行", async () => {
    let callCount = 0;
    const { disposed, schedule } = createDeferredSync(() => {
      callCount++;
    });

    schedule();
    // 在宏任务之前设置 disposed
    disposed.current = true;

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(callCount).toBe(0);
  });

  it("连续多次 schedule（前一轮完成后再次调度）应正常执行", async () => {
    let callCount = 0;
    const { schedule } = createDeferredSync(() => {
      callCount++;
    });

    // 第一轮
    schedule();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(callCount).toBe(1);

    // 第二轮（上一轮已完成，pendingSync 已清空）
    schedule();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(callCount).toBe(2);
  });
});
