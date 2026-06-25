/**
 * 配置校验边界值测试 — validateReplayProtectionConfig + validateAuditStoreConfig
 */
import { describe, it, expect } from "bun:test";
import { validateReplayProtectionConfig } from "@/security/replayProtection";
import { validateAuditStoreConfig } from "@/security/audit/auditStore";

describe("validateReplayProtectionConfig 边界值", () => {
  it("maxNonceCacheSize=0 抛出 Error", () => {
    expect(() => validateReplayProtectionConfig({ maxNonceCacheSize: 0 })).toThrow();
  });

  it("maxNonceCacheSize=-1 抛出 Error", () => {
    expect(() => validateReplayProtectionConfig({ maxNonceCacheSize: -1 })).toThrow();
  });

  it("maxNonceCacheSize=1_000_001 超过安全上限", () => {
    expect(() => validateReplayProtectionConfig({ maxNonceCacheSize: 1_000_001 })).toThrow("safety cap");
  });

  it("maxNonceCacheSize=1 正常通过", () => {
    expect(() => validateReplayProtectionConfig({ maxNonceCacheSize: 1 })).not.toThrow();
  });

  it("maxFingerprintCacheSize=0 抛出 Error", () => {
    expect(() => validateReplayProtectionConfig({ maxFingerprintCacheSize: 0 })).toThrow();
  });

  it("maxFingerprintCacheSize=10_000_001 超过安全上限", () => {
    expect(() => validateReplayProtectionConfig({ maxFingerprintCacheSize: 10_000_001 })).toThrow("safety cap");
  });

  it("timestampWindowMs=0 抛出 Error", () => {
    expect(() => validateReplayProtectionConfig({ timestampWindowMs: 0 })).toThrow();
  });

  it("timestampWindowMs=-100 抛出 Error", () => {
    expect(() => validateReplayProtectionConfig({ timestampWindowMs: -100 })).toThrow();
  });

  it("timestampWindowMs=24h+1ms 超过安全上限", () => {
    expect(() => validateReplayProtectionConfig({ timestampWindowMs: 24 * 60 * 60 * 1000 + 1 })).toThrow("safety cap");
  });

  it("timestampWindowMs=24h 正好通过", () => {
    expect(() => validateReplayProtectionConfig({ timestampWindowMs: 24 * 60 * 60 * 1000 })).not.toThrow();
  });

  it("空配置不抛错", () => {
    expect(() => validateReplayProtectionConfig({})).not.toThrow();
  });

  it("非整数 maxNonceCacheSize 抛出 Error", () => {
    expect(() => validateReplayProtectionConfig({ maxNonceCacheSize: 1.5 })).toThrow();
  });
});

describe("validateAuditStoreConfig 边界值", () => {
  it("maxEntries=0 抛出 Error", () => {
    expect(() => validateAuditStoreConfig({ maxEntries: 0 })).toThrow();
  });

  it("maxEntries=-1 抛出 Error", () => {
    expect(() => validateAuditStoreConfig({ maxEntries: -1 })).toThrow();
  });

  it("maxEntries=10_000_001 超过安全上限", () => {
    expect(() => validateAuditStoreConfig({ maxEntries: 10_000_001 })).toThrow("safety cap");
  });

  it("maxEntries=1 正常通过", () => {
    expect(() => validateAuditStoreConfig({ maxEntries: 1 })).not.toThrow();
  });

  it("maxEntries=10_000_000 正好通过", () => {
    expect(() => validateAuditStoreConfig({ maxEntries: 10_000_000 })).not.toThrow();
  });

  it("filePath 非字符串抛出 Error", () => {
    expect(() => validateAuditStoreConfig({ filePath: 123 as any })).toThrow();
  });

  it("空配置不抛错（使用默认值）", () => {
    expect(() => validateAuditStoreConfig({})).not.toThrow();
  });

  it("非整数 maxEntries 抛出 Error", () => {
    expect(() => validateAuditStoreConfig({ maxEntries: 1.5 })).toThrow();
  });
});
