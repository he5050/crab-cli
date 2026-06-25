/**
 * LifecycleHookManager 单元测试
 *
 * 测试覆盖:
 *   - 钩子注册与注销
 *   - once 一次性钩子
 *   - priority 优先级排序
 *   - emit 事件触发
 *   - 异步钩子处理
 *   - 错误隔离
 *   - 递归调用保护
 */

import { beforeEach, describe, expect, it, vi } from "bun:test";
import {
  type LifecycleEvent,
  type LifecycleHook,
  LifecycleHookManager,
  createLifecycleHooks,
  lifecycleHooks,
} from "@/agent/session/hookManager";

describe("LifecycleHookManager", () => {
  let manager: LifecycleHookManager;

  beforeEach(() => {
    manager = new LifecycleHookManager();
    lifecycleHooks.clear();
  });

  describe("注册钩子", () => {
    it("should register hook for event", () => {
      const hook = vi.fn();
      manager.on("beforeStart", hook);
      expect(manager.getHookCount("beforeStart")).toBe(1);
    });

    it("should register multiple hooks for same event", () => {
      const hook1 = vi.fn();
      const hook2 = vi.fn();
      manager.on("beforeStart", hook1);
      manager.on("beforeStart", hook2);
      expect(manager.getHookCount("beforeStart")).toBe(2);
    });

    it("should return unsubscribe function", () => {
      const hook = vi.fn();
      const unsubscribe = manager.on("beforeStart", hook);
      expect(manager.getHookCount("beforeStart")).toBe(1);
      unsubscribe();
      expect(manager.getHookCount("beforeStart")).toBe(0);
    });

    it("should accept priority option", () => {
      const hook = vi.fn();
      manager.on("beforeStart", hook, { priority: 10 });
      expect(manager.getHookCount("beforeStart")).toBe(1);
    });
  });

  describe("一次性钩子", () => {
    it("should call once hook only once", async () => {
      const hook = vi.fn();
      manager.once("beforeStart", hook);
      expect(manager.getHookCount("beforeStart")).toBe(1);

      await manager.emit("beforeStart", {});
      expect(hook).toHaveBeenCalledTimes(1);
      expect(manager.getHookCount("beforeStart")).toBe(0);

      await manager.emit("beforeStart", {});
      expect(hook).toHaveBeenCalledTimes(1);
    });

    it("should return unsubscribe for once hook", () => {
      const hook = vi.fn();
      const unsubscribe = manager.once("beforeStart", hook);
      unsubscribe();
      expect(manager.getHookCount("beforeStart")).toBe(0);
    });
  });

  describe("注销钩子", () => {
    it("should remove hook by reference", () => {
      const hook = vi.fn();
      manager.on("beforeStart", hook);
      expect(manager.getHookCount("beforeStart")).toBe(1);
      manager.off("beforeStart", hook);
      expect(manager.getHookCount("beforeStart")).toBe(0);
    });

    it("should not error when removing non-existent hook", () => {
      const hook = vi.fn();
      expect(() => manager.off("beforeStart", hook)).not.toThrow();
    });

    it("should not error when removing from empty event", () => {
      expect(() => manager.off("nonexistent" as LifecycleEvent, vi.fn())).not.toThrow();
    });
  });

  describe("优先级排序", () => {
    it("should execute hooks in priority order (higher first)", async () => {
      const order: string[] = [];
      manager.on(
        "beforeStart",
        () => {
          order.push("low");
        },
        { priority: 1 },
      );
      manager.on(
        "beforeStart",
        () => {
          order.push("high");
        },
        { priority: 10 },
      );
      manager.on(
        "beforeStart",
        () => {
          order.push("mid");
        },
        { priority: 5 },
      );

      await manager.emit("beforeStart", {});
      expect(order).toEqual(["high", "mid", "low"]);
    });

    it("should default to priority 0", async () => {
      const order: string[] = [];
      manager.on("beforeStart", () => {
        order.push("default");
      });
      manager.on(
        "beforeStart",
        () => {
          order.push("priority");
        },
        { priority: 1 },
      );

      await manager.emit("beforeStart", {});
      expect(order).toEqual(["priority", "default"]);
    });
  });

  describe("emit 事件触发", () => {
    it("should call all hooks for event", async () => {
      const hook1 = vi.fn();
      const hook2 = vi.fn();
      manager.on("beforeStart", hook1);
      manager.on("beforeStart", hook2);

      await manager.emit("beforeStart", { agentName: "test" });
      expect(hook1).toHaveBeenCalled();
      expect(hook2).toHaveBeenCalled();
    });

    it("should pass context to hooks", async () => {
      const hook = vi.fn();
      manager.on("beforeStart", hook);

      await manager.emit("beforeStart", { agentName: "my-agent", sessionId: "sess-1" });
      expect(hook).toHaveBeenCalledWith(
        expect.objectContaining({
          agentName: "my-agent",
          event: "beforeStart",
          sessionId: "sess-1",
        }),
      );
    });

    it("should include timestamp in context", async () => {
      const hook = vi.fn();
      const before = Date.now();
      await manager.emit("beforeStart", {});
      const after = Date.now();
      expect(hook).not.toHaveBeenCalled(); // No hooks registered

      manager.on("beforeStart", hook);
      await manager.emit("beforeStart", {});
      const callTimestamp = hook.mock.calls[0]?.[0]?.timestamp;
      expect(callTimestamp).toBeGreaterThanOrEqual(before);
      expect(callTimestamp).toBeLessThanOrEqual(after + 100);
    });

    it("should not error when emitting with no hooks", async () => {
      await expect(manager.emit("beforeStart", {})).resolves.toBeUndefined();
    });

    it("should support all event types", async () => {
      const events: LifecycleEvent[] = [
        "beforeStart",
        "afterStart",
        "beforeStep",
        "afterStep",
        "onToolCall",
        "onToolResult",
        "onError",
        "onComplete",
        "onCancelled",
      ];

      for (const event of events) {
        const hook = vi.fn();
        manager.on(event, hook);
        await manager.emit(event, {});
        expect(hook).toHaveBeenCalled();
      }
    });
  });

  describe("异步钩子", () => {
    it("should await async hooks", async () => {
      const order: string[] = [];
      manager.on("beforeStart", async () => {
        await new Promise((r) => setTimeout(r, 50));
        order.push("async");
      });
      manager.on("beforeStart", () => {
        order.push("sync");
      });

      await manager.emit("beforeStart", {});
      expect(order).toContain("async");
      expect(order).toContain("sync");
    });

    it("should handle async hook errors gracefully", async () => {
      const hook = vi.fn().mockRejectedValue(new Error("async error"));
      manager.on("beforeStart", hook);

      await expect(manager.emit("beforeStart", {})).resolves.toBeUndefined();
      // Give time for async error to be caught
      await new Promise((r) => setTimeout(r, 10));
    });
  });

  describe("错误隔离", () => {
    it("should continue executing hooks after error", async () => {
      const order: string[] = [];
      manager.on("beforeStart", () => {
        order.push("first");
        throw new Error("hook error");
      });
      manager.on("beforeStart", () => {
        order.push("second");
      });

      await manager.emit("beforeStart", {});
      expect(order).toContain("first");
      expect(order).toContain("second");
    });

    it("should mark error in context for onError event", async () => {
      const hook = vi.fn();
      manager.on("onError", hook);
      const testError = new Error("test");
      await manager.emit("onError", { error: testError });
      expect(hook).toHaveBeenCalledWith(expect.objectContaining({ error: testError }));
    });
  });

  describe("递归调用保护", () => {
    it("should not recursively trigger same event", async () => {
      const callCount = { inner: 0, outer: 0 };

      manager.on("beforeStart", async () => {
        callCount.outer++;
        if (callCount.outer === 1) {
          await manager.emit("beforeStart", {});
        }
      });
      manager.on("beforeStart", () => {
        callCount.inner++;
      });

      await manager.emit("beforeStart", {});
      // The inner emit should be skipped due to re-entrant protection
      expect(callCount.outer).toBe(1);
      expect(callCount.inner).toBe(1);
    });
  });

  describe("工具函数", () => {
    it("should return total hook count when no event specified", () => {
      manager.on("beforeStart", vi.fn());
      manager.on("afterStart", vi.fn());
      manager.on("onComplete", vi.fn());
      expect(manager.getHookCount()).toBe(3);
    });

    it("should return 0 for event with no hooks", () => {
      expect(manager.getHookCount("beforeStart")).toBe(0);
    });

    it("should clear all hooks", () => {
      manager.on("beforeStart", vi.fn());
      manager.on("afterStart", vi.fn());
      manager.clear();
      expect(manager.getHookCount()).toBe(0);
    });

    it("should return debug info", () => {
      manager.on("beforeStart", vi.fn());
      manager.on("beforeStart", vi.fn());
      manager.on("afterStart", vi.fn());
      const debug = manager.debug();
      expect(debug.beforeStart).toBe(2);
      expect(debug.afterStart).toBe(1);
    });
  });
});

describe("便捷函数", () => {
  describe("createLifecycleHooks", () => {
    it("should create new independent instance", () => {
      const manager1 = createLifecycleHooks();
      const manager2 = createLifecycleHooks();
      const hook = vi.fn();
      manager1.on("beforeStart", hook);
      expect(manager1.getHookCount("beforeStart")).toBe(1);
      expect(manager2.getHookCount("beforeStart")).toBe(0);
    });
  });

  describe("全局 lifecycleHooks", () => {
    it("should export singleton instance", async () => {
      const { lifecycleHooks, onBeforeStart } = await import("@/agent/session/hookManager");
      const hook = vi.fn();
      onBeforeStart(hook);
      expect(lifecycleHooks.getHookCount("beforeStart")).toBe(1);
    });
  });

  describe("事件便捷函数", () => {
    it("should register onBeforeStart hook", async () => {
      const { onBeforeStart, lifecycleHooks } = await import("@/agent/session/hookManager");
      const hook = vi.fn();
      const beforeCount = lifecycleHooks.getHookCount("beforeStart");
      onBeforeStart(hook);
      expect(lifecycleHooks.getHookCount("beforeStart")).toBe(beforeCount + 1);
    });

    it("should register onAfterStart hook", async () => {
      const { onAfterStart, lifecycleHooks } = await import("@/agent/session/hookManager");
      const hook = vi.fn();
      onAfterStart(hook);
      expect(lifecycleHooks.getHookCount("afterStart")).toBe(1);
    });

    it("should register onToolCall hook", async () => {
      const { onToolCall, lifecycleHooks } = await import("@/agent/session/hookManager");
      const hook = vi.fn();
      onToolCall(hook);
      expect(lifecycleHooks.getHookCount("onToolCall")).toBe(1);
    });

    it("should register onComplete hook", async () => {
      const { onComplete, lifecycleHooks } = await import("@/agent/session/hookManager");
      const hook = vi.fn();
      onComplete(hook);
      expect(lifecycleHooks.getHookCount("onComplete")).toBe(1);
    });
  });
});
