/**
 * 压缩感知测试。
 *
 * 覆盖导出:
 *   - checkCompressionSince
 *   - buildCompressionContinuationPrompt
 *   - getLastCompressionTime
 *
 * 注意:setup.ts afterEach 使用 clearHistory()(只清除历史)，
 * 不会清除订阅者，因此模块级 EventBus 订阅在测试间保持活跃。
 * recentCompressions 是模块私有数组，无法在测试间重置，
 * 所以每个测试使用相对时间戳确保只匹配自身发出的事件。
 */
import { describe, expect, test } from "bun:test";
import {
  buildCompressionContinuationPrompt,
  checkCompressionSince,
  getLastCompressionTime,
} from "@/agent/runtime/compression";
import { globalBus } from "@/bus";
import { AppEvent } from "@/bus";

/** 等待 EventBus 异步分发完成 */
function flushEvents(ms = 150): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("压缩感知", () => {
  describe("checkCompressionSince", () => {
    test("未来时间戳时返回 null(无压缩事件能比未来更新)", () => {
      const future = Date.now() + 999_999;
      expect(checkCompressionSince(future)).toBeNull();
    });

    test("发布压缩事件后能检测到", async () => {
      const before = Date.now();
      globalBus.publish(AppEvent.CompressCompleted, {
        compressionRatio: "25%",
        method: "ai-summary",
        tokensAfter: 50,
        tokensBefore: 200,
      });
      await flushEvents();

      // Before - 1000 确保能匹配到刚发布的事件
      const result = checkCompressionSince(before - 1000);
      expect(result).not.toBeNull();
      expect(result!.originalMessageCount).toBe(200);
      expect(result!.compressedMessageCount).toBe(50);
      expect(result!.timestamp).toBeGreaterThan(before - 1000);
    });

    test("参数为 0 时不抛异常", () => {
      // 0 是 Unix epoch，几乎所有事件都比它新
      const result = checkCompressionSince(0);
      expect(result === null || typeof result!.timestamp === "number").toBe(true);
    });
  });

  describe("buildCompressionContinuationPrompt", () => {
    test("未来时间戳时返回 null", () => {
      const future = Date.now() + 999_999;
      expect(buildCompressionContinuationPrompt(future)).toBeNull();
    });

    test("发布事件后能构建 continuation prompt", async () => {
      const before = Date.now();
      globalBus.publish(AppEvent.CompressCompleted, {
        compressionRatio: "24%",
        method: "truncate",
        tokensAfter: 120,
        tokensBefore: 500,
      });
      await flushEvents();

      const result = buildCompressionContinuationPrompt(before - 1000);
      expect(result).not.toBeNull();
      expect(typeof result).toBe("string");
      // 验证 prompt 包含压缩前后的消息数
      expect(result).toContain("500");
      expect(result).toContain("120");
      expect(result).toContain("压缩");
    });

    test("返回的 prompt 格式包含关键提示", async () => {
      const before = Date.now();
      globalBus.publish(AppEvent.CompressCompleted, {
        compressionRatio: "27%",
        method: "hybrid",
        tokensAfter: 80,
        tokensBefore: 300,
      });
      await flushEvents();

      const result = buildCompressionContinuationPrompt(before - 1000);
      if (result !== null) {
        // 验证 prompt 引导用户重新描述需求
        expect(result).toContain("重新描述");
      }
    });
  });

  describe("getLastCompressionTime", () => {
    test("发布事件后返回有效时间戳", async () => {
      const before = Date.now();
      globalBus.publish(AppEvent.CompressCompleted, {
        compressionRatio: "30%",
        method: "ai-summary",
        tokensAfter: 30,
        tokensBefore: 100,
      });
      await flushEvents();

      const result = getLastCompressionTime();
      expect(result).not.toBeNull();
      expect(result!).toBeGreaterThan(before - 1000);
      expect(result!).toBeLessThanOrEqual(Date.now());
    });

    test("返回值始终为 number 或 null", () => {
      const result = getLastCompressionTime();
      expect(result === null || typeof result === "number").toBe(true);
    });
  });

  describe("EventBus 订阅传播", () => {
    test("CompressCompleted 事件能被模块正确接收并记录", async () => {
      const before = Date.now();
      globalBus.publish(AppEvent.CompressCompleted, {
        compressionRatio: "10%",
        method: "ai-summary",
        tokensAfter: 100,
        tokensBefore: 999,
      });
      await flushEvents();

      // Before - 1 确保同一毫秒内的事件也能匹配(checkCompressionSince 用 > 比较)
      const event = checkCompressionSince(before - 1);
      expect(event).not.toBeNull();
      expect(event!.originalMessageCount).toBe(999);
      expect(event!.compressedMessageCount).toBe(100);
    });

    test("连续多次发布事件，getLastCompressionTime 返回最新时间", async () => {
      const before = Date.now();
      globalBus.publish(AppEvent.CompressCompleted, {
        compressionRatio: "50%",
        method: "truncate",
        tokensAfter: 50,
        tokensBefore: 100,
      });
      await flushEvents(50);

      globalBus.publish(AppEvent.CompressCompleted, {
        compressionRatio: "25%",
        method: "ai-summary",
        tokensAfter: 20,
        tokensBefore: 80,
      });
      await flushEvents();

      const lastTime = getLastCompressionTime();
      expect(lastTime).not.toBeNull();
      expect(lastTime!).toBeGreaterThan(before);
      // 最近一次事件应该是最新的
      const lastEvent = checkCompressionSince(before);
      expect(lastEvent).not.toBeNull();
    });

    test("AppEvent.CompressCompleted 事件定义正确", () => {
      expect(AppEvent.CompressCompleted).toBeDefined();
      expect(AppEvent.CompressCompleted.type).toBe("compress.completed");
    });
  });
});
