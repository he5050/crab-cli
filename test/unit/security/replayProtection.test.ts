/**
 * replayProtection 单元测试 — 重放攻击防护
 */
import { describe, it, expect, afterEach } from "bun:test";
import { ReplayProtector, createReplayProtector, validateReplayProtectionConfig } from "@/security/replayProtection";

describe("replayProtection", () => {
  let protector: ReplayProtector;

  afterEach(() => {
    protector?.reset();
  });

  describe("validateRequest", () => {
    it("正常请求(valid nonce + timestamp)通过", () => {
      protector = createReplayProtector({ strictMode: true });
      const ctx = protector.createRequestContext();
      const result = protector.validateRequest(ctx);
      expect(result.valid).toBe(true);
    });

    it("缺少 nonce 在非严格模式下通过", () => {
      protector = createReplayProtector({ strictMode: false });
      const result = protector.validateRequest({
        timestamp: Date.now(),
      });
      expect(result.valid).toBe(true);
    });

    it("缺少 nonce 在严格模式下失败", () => {
      protector = createReplayProtector({ strictMode: true });
      const result = protector.validateRequest({
        timestamp: Date.now(),
      });
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("MISSING_NONCE");
    });

    it("重复 nonce 被检测为重放", () => {
      protector = createReplayProtector();
      const nonce = protector.generateNonce();
      const ctx1 = { nonce, timestamp: Date.now() };
      const ctx2 = { nonce, timestamp: Date.now() };
      expect(protector.validateRequest(ctx1).valid).toBe(true);
      expect(protector.validateRequest(ctx2).valid).toBe(false);
      expect(protector.validateRequest(ctx2).errorCode).toBe("INVALID_NONCE");
    });

    it("缺少 timestamp 在非严格模式下通过", () => {
      protector = createReplayProtector({ strictMode: false });
      const result = protector.validateRequest({
        nonce: protector.generateNonce(),
      });
      expect(result.valid).toBe(true);
    });

    it("缺少 timestamp 在严格模式下失败", () => {
      protector = createReplayProtector({ strictMode: true });
      const result = protector.validateRequest({
        nonce: protector.generateNonce(),
      });
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("MISSING_TIMESTAMP");
    });

    it("过期 timestamp 被拒绝", () => {
      protector = createReplayProtector({ timestampWindowMs: 5000 });
      const result = protector.validateRequest({
        nonce: protector.generateNonce(),
        timestamp: Date.now() - 10000, // 10 seconds ago, window is 5s
      });
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("EXPIRED_TIMESTAMP");
    });

    it("未来 timestamp 被拒绝", () => {
      protector = createReplayProtector({ timestampWindowMs: 300000 });
      const result = protector.validateRequest({
        nonce: protector.generateNonce(),
        timestamp: Date.now() + 60000, // 1 minute in the future
      });
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("EXPIRED_TIMESTAMP");
    });
  });

  describe("validateAgentMessage", () => {
    it("正常消息通过", () => {
      protector = createReplayProtector();
      const result = protector.validateAgentMessage({
        role: "assistant",
        content: "hello",
      });
      expect(result.valid).toBe(true);
    });

    it("重复消息被检测为重放", () => {
      protector = createReplayProtector();
      const message = { role: "assistant", content: "hello" };
      expect(protector.validateAgentMessage(message).valid).toBe(true);
      expect(protector.validateAgentMessage(message).valid).toBe(false);
      expect(protector.validateAgentMessage(message).errorCode).toBe("REPLAYED_MESSAGE");
    });
  });

  describe("generateNonce", () => {
    it("返回非空字符串", () => {
      protector = createReplayProtector();
      const nonce = protector.generateNonce();
      expect(typeof nonce).toBe("string");
      expect(nonce.length).toBeGreaterThan(0);
    });

    it("每次生成不同的 nonce", () => {
      protector = createReplayProtector();
      const nonce1 = protector.generateNonce();
      const nonce2 = protector.generateNonce();
      expect(nonce1).not.toBe(nonce2);
    });
  });

  describe("createRequestContext", () => {
    it("返回包含 nonce 和 timestamp 的上下文", () => {
      protector = createReplayProtector();
      const ctx = protector.createRequestContext("session-123", "cli");
      expect(ctx.nonce).toBeDefined();
      expect(typeof ctx.nonce).toBe("string");
      expect(ctx.timestamp).toBeDefined();
      expect(typeof ctx.timestamp).toBe("number");
      expect(ctx.sessionId).toBe("session-123");
      expect(ctx.source).toBe("cli");
    });
  });

  describe("getStats", () => {
    it("返回正确的统计信息", () => {
      protector = createReplayProtector();
      const ctx = protector.createRequestContext();
      protector.validateRequest(ctx);
      protector.validateAgentMessage({ role: "assistant", content: "hello" });
      protector.validateAgentMessage({ role: "user", content: "world" });

      const stats = protector.getStats();
      expect(stats.nonceCacheSize).toBe(1);
      expect(stats.messageFingerprints).toBe(2);
      expect(stats.totalMessages).toBe(2);
    });
  });

  describe("reset", () => {
    it("非生产环境允许重置", () => {
      protector = createReplayProtector();
      const ctx = protector.createRequestContext();
      protector.validateRequest(ctx);
      expect(protector.getStats().nonceCacheSize).toBe(1);

      protector.reset();
      expect(protector.getStats().nonceCacheSize).toBe(0);
    });
  });

  describe("validateReplayProtectionConfig", () => {
    it("maxNonceCacheSize 为 0 抛错", () => {
      expect(() => validateReplayProtectionConfig({ maxNonceCacheSize: 0 })).toThrow();
    });

    it("maxNonceCacheSize 为负数抛错", () => {
      expect(() => validateReplayProtectionConfig({ maxNonceCacheSize: -1 })).toThrow();
    });

    it("maxNonceCacheSize 非整数抛错", () => {
      expect(() => validateReplayProtectionConfig({ maxNonceCacheSize: 1.5 })).toThrow();
    });

    it("maxNonceCacheSize 超过安全上限抛错", () => {
      expect(() => validateReplayProtectionConfig({ maxNonceCacheSize: 2_000_000 })).toThrow();
    });

    it("maxFingerprintCacheSize 为 0 抛错", () => {
      expect(() => validateReplayProtectionConfig({ maxFingerprintCacheSize: 0 })).toThrow();
    });

    it("maxFingerprintCacheSize 超过安全上限抛错", () => {
      expect(() => validateReplayProtectionConfig({ maxFingerprintCacheSize: 20_000_000 })).toThrow();
    });

    it("timestampWindowMs 为 0 抛错", () => {
      expect(() => validateReplayProtectionConfig({ timestampWindowMs: 0 })).toThrow();
    });

    it("timestampWindowMs 为负数抛错", () => {
      expect(() => validateReplayProtectionConfig({ timestampWindowMs: -1 })).toThrow();
    });

    it("timestampWindowMs 超过 24 小时上限抛错", () => {
      expect(() => validateReplayProtectionConfig({ timestampWindowMs: 25 * 60 * 60 * 1000 })).toThrow();
    });

    it("合法配置不抛错", () => {
      expect(() =>
        validateReplayProtectionConfig({
          maxNonceCacheSize: 100,
          maxFingerprintCacheSize: 1000,
          timestampWindowMs: 60000,
          strictMode: true,
        }),
      ).not.toThrow();
    });
  });

  describe("TTL 过期后 nonce 可复用", () => {
    it("过期 nonce 可以重新使用", () => {
      protector = createReplayProtector({
        maxNonceCacheSize: 1000,
        timestampWindowMs: 100, // 100ms TTL
      });
      const nonce = protector.generateNonce();
      const ctx = { nonce, timestamp: Date.now() };
      expect(protector.validateRequest(ctx).valid).toBe(true);

      // 等待 TTL 过期
      const waitMs = 150;
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          // 同一个 nonce 再次使用 - 应该被允许因为已过期
          // Note: cleanup 只在 checkAndMark 时触发,
          // 所以需要先触发一次 check 来清理过期条目
          const freshCtx = { nonce: protector.generateNonce(), timestamp: Date.now() };
          protector.validateRequest(freshCtx); // 触发 cleanup

          const reuseResult = protector.validateRequest({ nonce, timestamp: Date.now() });
          // 已过期条目被清理, nonce 可以重新使用
          expect(reuseResult.valid).toBe(true);
          resolve();
        }, waitMs);
      });
    });
  });

  describe("NonceManager cleanup", () => {
    it("清理过期条目减少缓存大小", () => {
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

      // 等待过期
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          // 触发一次新的 checkAndMark 来执行 cleanup
          const freshCtx = protector.createRequestContext();
          protector.validateRequest(freshCtx);
          // 过期条目应该被清理, 只保留新鲜的
          expect(protector.getStats().nonceCacheSize).toBe(1);
          resolve();
        }, 150);
      });
    });
  });
});
