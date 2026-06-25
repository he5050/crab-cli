/**
 * HeartbeatMonitor 单元测试
 *
 * 测试覆盖:
 *   - 心跳监控器基本功能
 *   - 启动/停止/暂停/恢复控制
 *   - ping 心跳发送
 *   - 超时检测与自动终止
 *   - 监听器注册与通知
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import {
  type HeartbeatConfig,
  type HeartbeatEvent,
  HeartbeatMonitor,
  createHeartbeatMonitor,
} from "@/agent/runtime/heartbeat";

describe("HeartbeatMonitor", () => {
  let monitor: HeartbeatMonitor | null = null;

  afterEach(() => {
    if (monitor) {
      monitor.stop();
      monitor = null;
    }
  });

  describe("基本功能", () => {
    it("should create monitor with default config", () => {
      monitor = createHeartbeatMonitor();
      expect(monitor).toBeInstanceOf(HeartbeatMonitor);
      expect(monitor.status).toBe("stopped");
      expect(monitor.beatCount).toBe(0);
      expect(monitor.missedBeatCount).toBe(0);
    });

    it("should create monitor with custom config", () => {
      monitor = createHeartbeatMonitor({
        autoTerminate: true,
        intervalMs: 1000,
        maxMissedBeats: 5,
        timeoutMs: 5000,
      });
      expect(monitor).toBeInstanceOf(HeartbeatMonitor);
      expect(monitor.status).toBe("stopped");
    });

    it("should return event with correct structure", () => {
      monitor = createHeartbeatMonitor();
      const event = monitor.getEvent();
      expect(event).toHaveProperty("status");
      expect(event).toHaveProperty("lastBeat");
      expect(event).toHaveProperty("missedBeats");
      expect(event).toHaveProperty("totalBeats");
    });

    it("should return summary string", () => {
      monitor = createHeartbeatMonitor();
      const summary = monitor.getSummary();
      expect(typeof summary).toBe("string");
      expect(summary).toContain("Heartbeat[stopped]");
    });
  });

  describe("启动和停止", () => {
    it("should start monitor", () => {
      monitor = createHeartbeatMonitor({ intervalMs: 100 });
      monitor.start("test-session");
      expect(monitor.status).toBe("running");
    });

    it("should not start twice", () => {
      monitor = createHeartbeatMonitor({ intervalMs: 100 });
      monitor.start("test-session");
      monitor.start("test-session"); // Should be no-op
      expect(monitor.status).toBe("running");
    });

    it("should stop monitor", () => {
      monitor = createHeartbeatMonitor({ intervalMs: 100 });
      monitor.start("test-session");
      expect(monitor.status).toBe("running");
      monitor.stop();
      expect(monitor.status).toBe("stopped");
    });

    it("should reset state on start", () => {
      monitor = createHeartbeatMonitor({ intervalMs: 100 });
      monitor.start("session-1");
      monitor.ping();
      monitor.ping();
      expect(monitor.beatCount).toBe(2);
      monitor.stop();
      monitor.start("session-2");
      expect(monitor.beatCount).toBe(0);
    });
  });

  describe("暂停和恢复", () => {
    it("should pause running monitor", () => {
      monitor = createHeartbeatMonitor({ intervalMs: 100 });
      monitor.start("test-session");
      expect(monitor.status).toBe("running");
      monitor.pause();
      expect(monitor.status).toBe("paused");
    });

    it("should not pause if not running", () => {
      monitor = createHeartbeatMonitor();
      monitor.pause(); // Should be no-op
      expect(monitor.status).toBe("stopped");
    });

    it("should resume paused monitor", () => {
      monitor = createHeartbeatMonitor({ intervalMs: 100 });
      monitor.start("test-session");
      monitor.pause();
      expect(monitor.status).toBe("paused");
      monitor.resume();
      expect(monitor.status).toBe("running");
    });

    it("should not resume if not paused", () => {
      monitor = createHeartbeatMonitor();
      monitor.resume(); // Should be no-op
      expect(monitor.status).toBe("stopped");
    });
  });

  describe("ping 心跳发送", () => {
    it("should increment beat count on ping", () => {
      monitor = createHeartbeatMonitor();
      monitor.start("test-session");
      monitor.ping();
      expect(monitor.beatCount).toBe(1);
      monitor.ping();
      expect(monitor.beatCount).toBe(2);
    });

    it("should reset missed beats on ping", () => {
      monitor = createHeartbeatMonitor();
      monitor.start("test-session");
      monitor.ping();
      expect(monitor.missedBeatCount).toBe(0);
    });

    it("should not ping when not running", () => {
      monitor = createHeartbeatMonitor();
      monitor.ping(); // Should be no-op
      expect(monitor.beatCount).toBe(0);
    });

    it("should not ping when paused", () => {
      monitor = createHeartbeatMonitor({ intervalMs: 100 });
      monitor.start("test-session");
      monitor.pause();
      monitor.ping(); // Should be no-op
      expect(monitor.beatCount).toBe(0);
    });
  });

  describe("监听器", () => {
    it("should register and call listener on timeout", async () => {
      monitor = createHeartbeatMonitor({
        intervalMs: 50,
        maxMissedBeats: 1,
        timeoutMs: 100,
      });
      const listener = vi.fn();
      monitor.onHeartbeat(listener);
      monitor.start("test-session");

      // Wait for timeout to trigger
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(listener).toHaveBeenCalled();
      const event: HeartbeatEvent = listener.mock.calls[0]?.[0];
      expect(event?.status).toBe("timeout");
    });

    it("should unsubscribe listener", () => {
      monitor = createHeartbeatMonitor({ intervalMs: 50, maxMissedBeats: 1, timeoutMs: 100 });
      const listener = vi.fn();
      const unsubscribe = monitor.onHeartbeat(listener);
      unsubscribe();

      monitor.start("test-session");

      // Wait and verify listener not called
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(listener).not.toHaveBeenCalled();
          resolve();
        }, 200);
      });
    });

    it("should handle listener errors gracefully", async () => {
      monitor = createHeartbeatMonitor({ intervalMs: 50, maxMissedBeats: 1, timeoutMs: 100 });
      const badListener = vi.fn().mockImplementation(() => {
        throw new Error("listener error");
      });
      const goodListener = vi.fn();

      monitor.onHeartbeat(badListener);
      monitor.onHeartbeat(goodListener);
      monitor.start("test-session");

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Both listeners should be called despite error
      expect(badListener).toHaveBeenCalled();
      expect(goodListener).toHaveBeenCalled();
    });
  });

  describe("自动终止", () => {
    it("should auto-terminate when maxMissedBeats exceeded", async () => {
      monitor = createHeartbeatMonitor({
        autoTerminate: true,
        intervalMs: 50,
        maxMissedBeats: 2,
        timeoutMs: 100,
      });

      const events: HeartbeatEvent[] = [];
      monitor.onHeartbeat((event) => events.push(event));
      monitor.start("test-session");

      await new Promise((resolve) => setTimeout(resolve, 400));

      expect(monitor.status).toBe("terminated");
      const lastEvent = events[events.length - 1];
      expect(lastEvent?.status).toBe("terminated");
    });

    it("should not auto-terminate when autoTerminate is false", async () => {
      monitor = createHeartbeatMonitor({
        autoTerminate: false,
        intervalMs: 50,
        maxMissedBeats: 2,
        timeoutMs: 100,
      });

      monitor.start("test-session");
      await new Promise((resolve) => setTimeout(resolve, 400));

      expect(monitor.status).toBe("running");
      expect(monitor.missedBeatCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe("getters", () => {
    it("should return last beat time", () => {
      monitor = createHeartbeatMonitor();
      expect(monitor.lastBeatTime).toBe(0);
      monitor.start("test-session");
      expect(monitor.lastBeatTime).toBeGreaterThan(0);
    });

    it("should return correct beat count", () => {
      monitor = createHeartbeatMonitor();
      monitor.start("test-session");
      monitor.ping();
      monitor.ping();
      monitor.ping();
      expect(monitor.beatCount).toBe(3);
    });

    it("should return correct missed beat count", () => {
      monitor = createHeartbeatMonitor();
      expect(monitor.missedBeatCount).toBe(0);
    });
  });
});
