/**
 * strictMode=true 时重放防护严格验证测试
 */
import { describe, it, expect, afterEach } from "bun:test";
import { createReplayProtector } from "@/security/replayProtection";

describe("strictMode=true 重放防护", () => {
  let protector: ReturnType<typeof createReplayProtector>;

  afterEach(() => {
    protector?.reset();
  });

  it("strictMode=true 时缺少 nonce 返回 MISSING_NONCE", () => {
    protector = createReplayProtector({ strictMode: true });
    const result = protector.validateRequest({ timestamp: Date.now() });
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("MISSING_NONCE");
    expect(result.message).toContain("Nonce");
  });

  it("strictMode=true 时缺少 timestamp 返回 MISSING_TIMESTAMP", () => {
    protector = createReplayProtector({ strictMode: true });
    const result = protector.validateRequest({ nonce: protector.generateNonce() });
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("MISSING_TIMESTAMP");
    expect(result.message).toContain("时间戳");
  });

  it("strictMode=true 时同时缺少 nonce 和 timestamp 返回 MISSING_NONCE（优先级）", () => {
    protector = createReplayProtector({ strictMode: true });
    const result = protector.validateRequest({});
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("MISSING_NONCE");
  });

  it("strictMode=true 时有效请求通过验证", () => {
    protector = createReplayProtector({ strictMode: true });
    const ctx = protector.createRequestContext("session-1", "cli");
    const result = protector.validateRequest(ctx);
    expect(result.valid).toBe(true);
  });

  it("strictMode=true 时重放 nonce 被拒绝", () => {
    protector = createReplayProtector({ strictMode: true });
    const ctx = protector.createRequestContext("session-1", "cli");
    expect(protector.validateRequest(ctx).valid).toBe(true);
    // 重用同一个 nonce
    const replay = protector.validateRequest({ nonce: ctx.nonce, timestamp: Date.now() });
    expect(replay.valid).toBe(false);
    expect(replay.errorCode).toBe("INVALID_NONCE");
  });

  it("strictMode=true 时过期时间戳被拒绝", () => {
    protector = createReplayProtector({ strictMode: true, timestampWindowMs: 100 });
    const ctx = protector.createRequestContext("session-1", "cli");
    // 等待时间窗口过期
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const freshNonce = protector.generateNonce();
        const result = protector.validateRequest({ nonce: freshNonce, timestamp: ctx.timestamp });
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe("EXPIRED_TIMESTAMP");
        resolve();
      }, 150);
    });
  });

  it("strictMode=true 时未来时间戳被拒绝", () => {
    protector = createReplayProtector({ strictMode: true });
    const futureTimestamp = Date.now() + 60_000; // 1 分钟后
    const result = protector.validateRequest({
      nonce: protector.generateNonce(),
      timestamp: futureTimestamp,
    });
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("EXPIRED_TIMESTAMP");
  });
});

describe("strictMode=false 默认行为", () => {
  it("缺少 nonce 时自动放行", () => {
    const protector = createReplayProtector({ strictMode: false });
    const result = protector.validateRequest({ timestamp: Date.now() });
    expect(result.valid).toBe(true);
  });

  it("缺少 timestamp 时自动放行", () => {
    const protector = createReplayProtector({ strictMode: false });
    const result = protector.validateRequest({ nonce: protector.generateNonce() });
    expect(result.valid).toBe(true);
  });
});
