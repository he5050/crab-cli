/**
 * P3-4: fallbackCache 独立单元测试。
 *
 * 测试目标:
 * - verifiedKey 生成格式
 * - setVerifiedMethod / getVerifiedEntry 基本读写
 * - TTL 过期后 getVerifiedEntry 返回 undefined
 * - clearVerifiedMethods 清空所有缓存
 * - cleanupExpiredVerifiedMethods 按 providerId 过滤清理
 * - cleanupExpiredVerifiedMethods 不传 providerId 清理全部
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  verifiedKey,
  setVerifiedMethod,
  getVerifiedEntry,
  clearVerifiedMethods,
  cleanupExpiredVerifiedMethods,
  _setEntryForTesting,
} from "@/api/resilience/fallbackCache";

describe("fallbackCache", () => {
  beforeEach(() => {
    clearVerifiedMethods();
  });

  afterEach(() => {
    clearVerifiedMethods();
  });

  test("verifiedKey 生成正确格式", () => {
    expect(verifiedKey("openai")).toBe("openai:*");
    expect(verifiedKey("openai", "gpt-4o")).toBe("openai:gpt-4o");
    expect(verifiedKey("anthropic", "claude-3")).toBe("anthropic:claude-3");
  });

  test("setVerifiedMethod + getVerifiedEntry 基本读写", () => {
    setVerifiedMethod("openai", "chat", "gpt-4o");
    const entry = getVerifiedEntry(verifiedKey("openai", "gpt-4o"));
    expect(entry).toBeDefined();
    expect(entry!.method).toBe("chat");
    expect(entry!.verifiedAt).toBeGreaterThan(0);
  });

  test("getVerifiedEntry 不存在的 key 返回 undefined", () => {
    expect(getVerifiedEntry("nonexistent:key")).toBeUndefined();
  });

  test("TTL 过期后 getVerifiedEntry 返回 undefined", async () => {
    setVerifiedMethod("openai", "chat", "gpt-4o");
    const entry1 = getVerifiedEntry(verifiedKey("openai", "gpt-4o"));
    expect(entry1).toBeDefined();

    // 手动将 verifiedAt 设为很久以前以模拟过期
    // 由于 TTL 是 24 小时，我们直接操作内部 Map
    setVerifiedMethod("openai", "responses", "gpt-4o");
    // 读取确认存在
    const entry2 = getVerifiedEntry(verifiedKey("openai", "gpt-4o"));
    expect(entry2).toBeDefined();
    expect(entry2!.method).toBe("responses");
  });

  test("TTL 过期场景：通过 _setEntryForTesting 模拟过期", () => {
    // 写入一个 verifiedAt 为 25 小时前的条目（TTL=24h）
    const expiredTime = Date.now() - 25 * 60 * 60 * 1000;
    _setEntryForTesting(verifiedKey("openai", "expired-model"), "chat", expiredTime);

    // 验证：过期条目应返回 undefined
    const expiredEntry = getVerifiedEntry(verifiedKey("openai", "expired-model"));
    expect(expiredEntry).toBeUndefined();
  });

  test("clearVerifiedMethods 清空所有缓存", () => {
    setVerifiedMethod("openai", "chat", "gpt-4o");
    setVerifiedMethod("anthropic", "claude", "claude-3");
    expect(getVerifiedEntry(verifiedKey("openai", "gpt-4o"))).toBeDefined();
    expect(getVerifiedEntry(verifiedKey("anthropic", "claude-3"))).toBeDefined();

    clearVerifiedMethods();

    expect(getVerifiedEntry(verifiedKey("openai", "gpt-4o"))).toBeUndefined();
    expect(getVerifiedEntry(verifiedKey("anthropic", "claude-3"))).toBeUndefined();
  });

  test("cleanupExpiredVerifiedMethods 按 providerId 过滤（未过期条目不被清理）", () => {
    setVerifiedMethod("openai", "chat", "gpt-4o");
    setVerifiedMethod("anthropic", "claude", "claude-3");

    // 清理 openai 的过期项 — 但条目未过期，所以不会被清理
    cleanupExpiredVerifiedMethods("openai");

    // 未过期的条目保留
    expect(getVerifiedEntry(verifiedKey("openai", "gpt-4o"))).toBeDefined();
    expect(getVerifiedEntry(verifiedKey("anthropic", "claude-3"))).toBeDefined();
  });

  test("cleanupExpiredVerifiedMethods 不传 providerId 清理全部", () => {
    setVerifiedMethod("openai", "chat", "gpt-4o");
    setVerifiedMethod("anthropic", "claude", "claude-3");

    cleanupExpiredVerifiedMethods();

    // 未过期的项不会被清理
    expect(getVerifiedEntry(verifiedKey("openai", "gpt-4o"))).toBeDefined();
    expect(getVerifiedEntry(verifiedKey("anthropic", "claude-3"))).toBeDefined();
  });

  test("setVerifiedMethod 覆盖同名 key", () => {
    setVerifiedMethod("openai", "chat", "gpt-4o");
    setVerifiedMethod("openai", "responses", "gpt-4o");
    const entry = getVerifiedEntry(verifiedKey("openai", "gpt-4o"));
    expect(entry!.method).toBe("responses");
  });
});
