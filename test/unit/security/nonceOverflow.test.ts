/**
 * NonceManager RingBuffer 溢出 + MessageFingerprint 溢出清理 单元测试
 *
 * 实现说明:
 *   - NonceManager.usedNonces 是 Map，仅通过 TTL 过期清理 (cleanup)，
 *     RingBuffer 仅用于 FIFO 历史记录，不控制 Map 的删除。
 *   - MessageFingerprintManager 有显式的两阶段清理:
 *     1. 超时清理: 移除超过 windowMs 的条目
 *     2. 溢出清理: 若仍超限，FIFO 移除最旧条目
 */
import { describe, it, expect, afterEach } from "bun:test";
import { createReplayProtector } from "@/security/replayProtection";

describe("NonceManager 和 MessageFingerprint 溢出清理", () => {
  let protector: ReturnType<typeof createReplayProtector>;

  afterEach(() => {
    protector?.reset();
  });

  describe("NonceManager TTL 过期后 nonce 可复用", () => {
    it("TTL 过期后旧 nonce 可重新使用", () => {
      protector = createReplayProtector({
        maxNonceCacheSize: 1000,
        timestampWindowMs: 100, // 100ms TTL
      });
      const nonce = protector.generateNonce();
      const ctx = { nonce, timestamp: Date.now() };
      expect(protector.validateRequest(ctx).valid).toBe(true);

      // 等待 TTL 过期后触发 cleanup（通过新 nonce 的 checkAndMark）
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          // 先触发一次 checkAndMark 执行 cleanup
          const freshCtx = { nonce: protector.generateNonce(), timestamp: Date.now() };
          protector.validateRequest(freshCtx);

          // 同一个 nonce 再次使用 — 应该被允许因为已过期
          const reuseResult = protector.validateRequest({ nonce, timestamp: Date.now() });
          expect(reuseResult.valid).toBe(true);
          resolve();
        }, 150);
      });
    });

    it("TTL 未过期时旧 nonce 仍被阻止", () => {
      protector = createReplayProtector({
        maxNonceCacheSize: 1000,
        timestampWindowMs: 60000, // 60秒 TTL — 测试中不会过期
      });
      const nonce = protector.generateNonce();
      const ctx = { nonce, timestamp: Date.now() };
      protector.validateRequest(ctx);

      // 立即重用，TTL 未过期
      const reuseResult = protector.validateRequest({ nonce, timestamp: Date.now() });
      expect(reuseResult.valid).toBe(false);
      expect(reuseResult.errorCode).toBe("INVALID_NONCE");
    });

    it("大量 nonce 后 TTL 过期清理减少缓存大小", () => {
      protector = createReplayProtector({
        maxNonceCacheSize: 1000,
        timestampWindowMs: 100, // 100ms TTL
      });

      // 生成多个 nonce
      for (let i = 0; i < 5; i++) {
        const ctx = protector.createRequestContext();
        protector.validateRequest(ctx);
      }
      expect(protector.getStats().nonceCacheSize).toBe(5);

      // 等待 TTL 过期
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          // 触发一次新的 checkAndMark 来执行 cleanup
          const freshCtx = protector.createRequestContext();
          protector.validateRequest(freshCtx);
          // 过期条目应该被清理，只保留新鲜的
          expect(protector.getStats().nonceCacheSize).toBe(1);
          resolve();
        }, 150);
      });
    });
  });

  describe("MessageFingerprint 溢出（maxFingerprintCacheSize 小值）", () => {
    it("超过 maxFingerprintCacheSize 后旧指纹可重复", () => {
      protector = createReplayProtector({ maxFingerprintCacheSize: 3 });
      // 发送 4 个不同消息（超过容量 3）
      const messages = [
        { role: "assistant", content: "msg_0" },
        { role: "assistant", content: "msg_1" },
        { role: "assistant", content: "msg_2" },
        { role: "assistant", content: "msg_3" },
      ];
      for (const msg of messages) {
        protector.validateAgentMessage(msg);
      }

      // msg_0 应该已溢出，可以再次通过
      const reuseResult = protector.validateAgentMessage(messages[0]!);
      expect(reuseResult.valid).toBe(true);
    });

    it("未溢出的消息仍被阻止", () => {
      protector = createReplayProtector({ maxFingerprintCacheSize: 5 });
      const msg = { role: "assistant", content: "unique_msg" };
      protector.validateAgentMessage(msg);
      const replay = protector.validateAgentMessage(msg);
      expect(replay.valid).toBe(false);
    });

    it("溢出边界: 容量刚好等于消息数时不溢出", () => {
      protector = createReplayProtector({ maxFingerprintCacheSize: 3 });
      const messages = [
        { role: "assistant", content: "a" },
        { role: "assistant", content: "b" },
        { role: "assistant", content: "c" },
      ];
      for (const msg of messages) {
        protector.validateAgentMessage(msg);
      }

      // 容量刚好是 3，不溢出
      const replay = protector.validateAgentMessage(messages[0]!);
      expect(replay.valid).toBe(false);
    });
  });

  describe("MessageFingerprint 统计", () => {
    it("getStats 反映指纹去重计数", () => {
      protector = createReplayProtector({ maxFingerprintCacheSize: 100 });
      protector.validateAgentMessage({ role: "assistant", content: "hello" });
      protector.validateAgentMessage({ role: "assistant", content: "hello" }); // 重复
      protector.validateAgentMessage({ role: "user", content: "world" });

      const stats = protector.getStats();
      expect(stats.messageFingerprints).toBe(2); // 2 个唯一指纹
      expect(stats.totalMessages).toBe(3); // 3 次验证
    });
  });
});
