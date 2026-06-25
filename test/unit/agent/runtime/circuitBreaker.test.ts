/**
 * Circuit Breaker 单元测试
 *
 * 测试覆盖:
 *   - 熔断器基本功能
 *   - 错误记录和计数
 *   - 熔断触发机制
 *   - 自动重置功能
 *   - 手动控制功能
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  CircuitBreaker,
  type ErrorFingerprint,
  createCircuitBreaker,
  createDeadLoopHandler,
} from "@/agent/runtime/circuitBreaker";

describe("CircuitBreaker", () => {
  let circuitBreaker: CircuitBreaker;

  beforeEach(() => {
    circuitBreaker = createCircuitBreaker({
      resetTimeoutMs: 1000,
      taskId: "test-task",
      threshold: 3,
    });
  });

  afterEach(() => {
    if (circuitBreaker) {
      circuitBreaker.destroy();
    }
  });

  describe("基本功能", () => {
    it("should create circuit breaker with default config", () => {
      const cb = createCircuitBreaker({ taskId: "default-task" });
      expect(cb).toBeInstanceOf(CircuitBreaker);
      expect(cb.isCircuitOpen()).toBe(false);
      cb.destroy();
    });

    it("should return stats correctly", () => {
      const stats = circuitBreaker.getStats();
      expect(stats.taskId).toBe("test-task");
      expect(stats.isOpen).toBe(false);
      expect(stats.currentCount).toBe(0);
      expect(stats.threshold).toBe(3);
      expect(stats.lastError).toBeNull();
      expect(stats.openedAt).toBeNull();
    });

    it("should return empty error history initially", () => {
      const history = circuitBreaker.getErrorHistory();
      expect(history).toEqual([]);
    });
  });

  describe("错误记录", () => {
    it("should record failure and return false when below threshold", () => {
      const result = circuitBreaker.recordFailure("TypeError", "undefined variable");
      expect(result).toBe(false);
      expect(circuitBreaker.isCircuitOpen()).toBe(false);
    });

    it("should count same error type and context", () => {
      circuitBreaker.recordFailure("TypeError", "undefined variable");
      circuitBreaker.recordFailure("TypeError", "undefined variable");

      const history = circuitBreaker.getErrorHistory();
      expect(history).toHaveLength(1);
      expect(history[0]!.count).toBe(2);
    });

    it("should treat different contexts as different errors", () => {
      circuitBreaker.recordFailure("TypeError", "undefined variable x");
      circuitBreaker.recordFailure("TypeError", "undefined variable y");

      const history = circuitBreaker.getErrorHistory();
      expect(history).toHaveLength(2);
    });

    it("should trigger callback when error is recorded", () => {
      let callbackCalled = false;
      let callbackTaskId = "";
      const onErrorRecorded = (taskId: string) => {
        callbackCalled = true;
        callbackTaskId = taskId;
      };
      const cb = createCircuitBreaker({
        onErrorRecorded,
        taskId: "callback-task",
      });

      cb.recordFailure("Error", "test context");
      expect(callbackCalled).toBe(true);
      expect(callbackTaskId).toBe("callback-task");

      cb.destroy();
    });
  });

  describe("熔断触发", () => {
    it("should trigger circuit break when reaching threshold", () => {
      circuitBreaker.recordFailure("TypeError", "test");
      circuitBreaker.recordFailure("TypeError", "test");
      const result = circuitBreaker.recordFailure("TypeError", "test");

      expect(result).toBe(true);
      expect(circuitBreaker.isCircuitOpen()).toBe(true);
    });

    it("should trigger onCircuitOpen callback", () => {
      let callbackCalled = false;
      let callbackTaskId = "";
      const onCircuitOpen = (taskId: string) => {
        callbackCalled = true;
        callbackTaskId = taskId;
      };
      const cb = createCircuitBreaker({
        onCircuitOpen,
        taskId: "trigger-task",
        threshold: 2,
      });

      cb.recordFailure("Error", "test");
      cb.recordFailure("Error", "test");

      expect(callbackCalled).toBe(true);
      expect(callbackTaskId).toBe("trigger-task");

      cb.destroy();
    });

    it("should ignore new errors when circuit is open", () => {
      // Trigger circuit break
      circuitBreaker.recordFailure("Error", "test");
      circuitBreaker.recordFailure("Error", "test");
      circuitBreaker.recordFailure("Error", "test");

      expect(circuitBreaker.isCircuitOpen()).toBe(true);

      // Try to record another error
      const result = circuitBreaker.recordFailure("Error", "test");
      expect(result).toBe(false);
    });

    it("should update stats when circuit opens", () => {
      circuitBreaker.recordFailure("Error", "test");
      circuitBreaker.recordFailure("Error", "test");
      circuitBreaker.recordFailure("Error", "test");

      const stats = circuitBreaker.getStats();
      expect(stats.isOpen).toBe(true);
      expect(stats.currentCount).toBe(3);
      expect(stats.lastError).not.toBeNull();
      expect(stats.openedAt).not.toBeNull();
    });
  });

  describe("成功记录", () => {
    it("should decrease error count on success", () => {
      circuitBreaker.recordFailure("Error", "test");
      circuitBreaker.recordFailure("Error", "test");

      circuitBreaker.recordSuccess("Error", "test");

      const history = circuitBreaker.getErrorHistory();
      expect(history[0]!.count).toBe(1);
    });

    it("should remove error from history when count reaches zero", () => {
      circuitBreaker.recordFailure("Error", "test");
      circuitBreaker.recordSuccess("Error", "test");

      const history = circuitBreaker.getErrorHistory();
      expect(history).toHaveLength(0);
    });
  });

  describe("手动控制", () => {
    it("should manually open circuit", () => {
      circuitBreaker.forceOpen("manual test");

      expect(circuitBreaker.isCircuitOpen()).toBe(true);
      const stats = circuitBreaker.getStats();
      expect(stats.lastError?.type).toBe("manual test");
    });

    it("should reset circuit manually", () => {
      // Open circuit
      circuitBreaker.recordFailure("Error", "test");
      circuitBreaker.recordFailure("Error", "test");
      circuitBreaker.recordFailure("Error", "test");
      expect(circuitBreaker.isCircuitOpen()).toBe(true);

      // Reset
      circuitBreaker.reset();

      expect(circuitBreaker.isCircuitOpen()).toBe(false);
      expect(circuitBreaker.getErrorHistory()).toHaveLength(0);

      const stats = circuitBreaker.getStats();
      expect(stats.isOpen).toBe(false);
      expect(stats.currentCount).toBe(0);
      expect(stats.lastError).toBeNull();
    });
  });

  describe("自动重置", () => {
    it("should auto-reset after timeout", async () => {
      const cb = createCircuitBreaker({
        resetTimeoutMs: 50,
        taskId: "auto-reset-task",
        threshold: 2,
      });

      // Open circuit
      cb.recordFailure("Error", "test");
      cb.recordFailure("Error", "test");
      expect(cb.isCircuitOpen()).toBe(true);

      // Wait for auto-reset
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(cb.isCircuitOpen()).toBe(false);
      cb.destroy();
    });
  });

  describe("死循环处理器", () => {
    it("should create dead loop handler", () => {
      const onDeadLoop = () => {};
      const handler = createDeadLoopHandler("dead-loop-task", onDeadLoop);

      expect(typeof handler).toBe("function");
    });

    it("should detect dead loop and call callback", () => {
      let callbackCalled = false;
      let receivedTaskId = "";
      const onDeadLoop = (taskId: string) => {
        callbackCalled = true;
        receivedTaskId = taskId;
      };
      const handler = createDeadLoopHandler("dead-loop-task", onDeadLoop);

      // Simulate repeated errors
      handler("SyntaxError", "unexpected token");
      handler("SyntaxError", "unexpected token");
      handler("SyntaxError", "unexpected token");

      expect(callbackCalled).toBe(true);
      expect(receivedTaskId).toBe("dead-loop-task");
    });
  });

  describe("错误指纹", () => {
    it("should normalize context in fingerprint", () => {
      circuitBreaker.recordFailure("TypeError", "error at line 123");
      circuitBreaker.recordFailure("TypeError", "error at line 456");

      // Both should be treated as same error after normalization
      const history = circuitBreaker.getErrorHistory();
      expect(history).toHaveLength(1);
      expect(history[0]!.count).toBe(2);
    });

    it("should limit context length", () => {
      const longContext = "a".repeat(300);
      circuitBreaker.recordFailure("Error", longContext);

      const history = circuitBreaker.getErrorHistory();
      expect(history[0]!.context.length).toBeLessThanOrEqual(200);
    });
  });

  describe("历史清理", () => {
    it("should cleanup oldest entries when history is full", () => {
      // CIRCUIT_BREAKER_MAX_HISTORY is 100, so create more than that
      for (let i = 0; i < 105; i++) {
        circuitBreaker.recordFailure(`Error${i}`, `context${i}`);
      }

      const history = circuitBreaker.getErrorHistory();
      // Should have limited entries (max history size is 100)
      expect(history.length).toBeLessThanOrEqual(100);
    });
  });
});
