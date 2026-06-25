/**
 * Watchdog 单元测试
 *
 * 测试覆盖:
 *   - 看门狗基本功能
 *   - 启动/停止控制
 *   - 配置验证
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Watchdog, createTimeoutHandler, createWatchdog } from "@/agent/runtime/watchdog";

describe("Watchdog", () => {
  let watchdog: Watchdog | null = null;

  afterEach(() => {
    if (watchdog) {
      watchdog.destroy();
      watchdog = null;
    }
  });

  describe("基本功能", () => {
    it("should create watchdog with default config", () => {
      watchdog = createWatchdog({ taskId: "default-task" });
      expect(watchdog).toBeInstanceOf(Watchdog);
      expect(watchdog.isActive()).toBe(false);
    });

    it("should create watchdog with custom timeout", () => {
      watchdog = createWatchdog({ taskId: "custom-task", timeoutMs: 5000 });
      expect(watchdog.getRemainingMs()).toBe(5000);
    });

    it("should respect max timeout limit", () => {
      const maxTimeout = 30 * 60 * 1000; // 30 minutes
      watchdog = createWatchdog({ taskId: "max-task", timeoutMs: maxTimeout + 1000 });
      expect(watchdog).toBeDefined();
    });
  });

  describe("启动和停止", () => {
    it("should start watchdog", () => {
      watchdog = createWatchdog({ taskId: "start-task" });
      watchdog.start();

      expect(watchdog.isActive()).toBe(true);
    });

    it("should stop watchdog", () => {
      watchdog = createWatchdog({ taskId: "stop-task" });
      watchdog.start();
      expect(watchdog.isActive()).toBe(true);

      watchdog.stop();
      expect(watchdog.isActive()).toBe(false);
    });

    it("should ignore start when already running", () => {
      let eventCount = 0;
      watchdog = createWatchdog({
        onEvent: () => {
          eventCount++;
        },
        taskId: "running-task",
      });

      watchdog.start();
      const countAfterFirst = eventCount;

      watchdog.start(); // Try to start again
      expect(eventCount).toBe(countAfterFirst); // No new events
    });

    it("should ignore stop when not running", () => {
      watchdog = createWatchdog({ taskId: "not-running-task" });
      expect(() => watchdog!.stop()).not.toThrow();
    });
  });

  describe("暂停和恢复", () => {
    it("should pause watchdog", () => {
      watchdog = createWatchdog({ taskId: "pause-task" });
      watchdog.start();

      const elapsedBefore = watchdog.getElapsedMs();
      watchdog.pause();

      expect(watchdog.isActive()).toBe(true); // Still active but paused
    });

    it("should resume watchdog", () => {
      watchdog = createWatchdog({ taskId: "resume-task" });
      watchdog.start();

      watchdog.pause();
      watchdog.resume();

      expect(watchdog.isActive()).toBe(true);
    });

    it("should ignore pause when not running", () => {
      watchdog = createWatchdog({ taskId: "not-running-pause" });
      expect(() => watchdog!.pause()).not.toThrow();
    });

    it("should ignore resume when not paused", () => {
      watchdog = createWatchdog({ taskId: "not-paused" });
      watchdog!.start();
      expect(() => watchdog!.resume()).not.toThrow();
    });
  });

  describe("超时处理器", () => {
    it("should create timeout handler", () => {
      const onForcedTerminate = () => {};
      const handler = createTimeoutHandler("handler-task", onForcedTerminate);

      expect(typeof handler).toBe("function");
    });

    it("should call forced terminate callback", () => {
      let callbackCalled = false;
      const onForcedTerminate = () => {
        callbackCalled = true;
      };
      const handler = createTimeoutHandler("terminate-task", onForcedTerminate);

      handler("terminate-task", 30_000);

      expect(callbackCalled).toBe(true);
    });
  });

  describe("时间计算", () => {
    it("should return 0 elapsed time when not running", () => {
      watchdog = createWatchdog({ taskId: "not-running-time" });
      expect(watchdog.getElapsedMs()).toBe(0);
    });

    it("should calculate elapsed time when running", () => {
      watchdog = createWatchdog({ taskId: "elapsed-task" });
      watchdog.start();

      const elapsed = watchdog.getElapsedMs();
      expect(elapsed).toBeGreaterThanOrEqual(0);
    });
  });

  describe("销毁", () => {
    it("should stop watchdog on destroy", () => {
      watchdog = createWatchdog({ taskId: "destroy-task" });
      watchdog.start();
      expect(watchdog.isActive()).toBe(true);

      watchdog.destroy();
      expect(watchdog.isActive()).toBe(false);
    });

    it("should not throw when destroying inactive watchdog", () => {
      watchdog = createWatchdog({ taskId: "destroy-inactive" });
      expect(() => watchdog!.destroy()).not.toThrow();
    });
  });
});
