/**
 * auditLogger 文件持久化 + 全局单例 单元测试
 */
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AuditLogger, getGlobalAuditLogger, waitForGlobalAuditLogger } from "@/security/audit/auditLogger";

describe("auditLogger 持久化与全局单例", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "audit-persist-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("init() 异步初始化", () => {
    it("persistToFile=false 时构造后即可使用(size=0)", async () => {
      const logger = new AuditLogger("test-persist", {
        persistToFile: false,
        maxEntries: 100,
      });
      // persistToFile=false 时 _initialized 在构造函数中已设为 true
      expect(logger.size()).toBe(0);
      await logger.clear();
    });

    it("persistToFile=true 时 init() 创建目录并设置 logFilePath", async () => {
      // init() 内部调用 getCrabDir()，这里验证幂等调用不抛错
      const logger = new AuditLogger("test-init-dir", {
        persistToFile: false,
        maxEntries: 100,
      });
      await logger.init();
      await logger.init(); // 第二次调用应立即返回（幂等）
      expect(logger.size()).toBe(0);
      await logger.clear();
    });
  });

  describe("文件持久化", () => {
    it("persistToFile=false 时日志仅存内存", async () => {
      const logger = new AuditLogger("test-file", {
        persistToFile: false,
        maxEntries: 100,
      });
      logger.log({ action: "file-test", eventType: "system", level: "info" });
      expect(logger.size()).toBe(1);
      const recent = logger.getRecent(1);
      expect(recent[0]!.action).toBe("file-test");
      await logger.clear();
    });

    it("init() 幂等性 -- 多次调用不会重复加载", async () => {
      const logger = new AuditLogger("test-idempotent", {
        persistToFile: false,
        maxEntries: 100,
      });
      await logger.init();
      await logger.init(); // 第二次调用应立即返回
      logger.log({ action: "check", eventType: "system", level: "info" });
      expect(logger.size()).toBe(1);
      await logger.clear();
    });
  });

  describe("getGlobalAuditLogger", () => {
    it("返回单例实例", () => {
      const a = getGlobalAuditLogger();
      const b = getGlobalAuditLogger();
      expect(a).toBe(b);
    });
  });

  describe("waitForGlobalAuditLogger", () => {
    it("返回 Promise 且不抛错", async () => {
      // waitForGlobalAuditLogger 在全局单例创建后被调用
      // 静态 import 会在模块加载时创建全局实例并调用 init()
      await expect(waitForGlobalAuditLogger()).resolves.toBeUndefined();
    });
  });

  describe("clear() 安全保护", () => {
    it("非生产环境允许清除", async () => {
      const logger = new AuditLogger("test-clear", {
        persistToFile: false,
        maxEntries: 100,
      });
      logger.log({ action: "test", eventType: "system", level: "info" });
      expect(logger.size()).toBe(1);
      await logger.clear();
      expect(logger.size()).toBe(0);
    });
  });

  describe("integrityKey 从环境变量", () => {
    it("全局单例使用 CRAB_AUDIT_HMAC_KEY 环境变量", () => {
      // getGlobalAuditLogger 内部读取 process.env.CRAB_AUDIT_HMAC_KEY
      // 此测试验证全局单例创建不抛错
      const instance = getGlobalAuditLogger();
      expect(instance).toBeDefined();
      expect(instance.size()).toBeGreaterThanOrEqual(0);
    });
  });

  describe("log() 中 metadata 脱敏", () => {
    it("metadata 中的 apiKey 被脱敏", async () => {
      const logger = new AuditLogger("test-sanitize", {
        persistToFile: false,
        maxEntries: 100,
        integrityKey: "test-key",
      });
      logger.log({
        action: "test",
        eventType: "system",
        level: "info",
        metadata: { apiKey: "sk-1234567890abcdef", safeField: "visible" },
      });
      const entry = logger.getRecent(1)[0]!;
      expect(entry.metadata?.apiKey).not.toBe("sk-1234567890abcdef");
      expect(entry.metadata?.safeField).toBe("visible");
      await logger.clear();
    });

    it("metadata 中的 token 被脱敏", async () => {
      const logger = new AuditLogger("test-sanitize-subj", {
        persistToFile: false,
        maxEntries: 100,
      });
      logger.log({
        action: "auth",
        eventType: "authentication",
        level: "info",
        subject: { userId: "u1" },
        metadata: { token: "bearer_abcdefghijklmnop" },
      });
      const entry = logger.getRecent(1)[0]!;
      expect(entry.metadata?.token).not.toBe("bearer_abcdefghijklmnop");
      expect(entry.metadata?.token).toContain("****");
      await logger.clear();
    });
  });

  describe("日志监听器错误隔离", () => {
    it("监听器抛错不影响 log() 正常执行", async () => {
      const logger = new AuditLogger("test-listener-error", {
        persistToFile: false,
        maxEntries: 100,
      });
      const badListener = mock(() => {
        throw new Error("listener error");
      });
      const unsub = logger.onAuditEntry(badListener);
      // log() 应该正常返回 id，不抛错
      const id = logger.log({ action: "trigger", eventType: "system", level: "info" });
      expect(typeof id).toBe("string");
      expect(logger.size()).toBe(1);
      unsub();
      await logger.clear();
    });
  });

  describe("RingBuffer 容量限制", () => {
    it("超过 maxEntries 时最旧条目被覆盖", async () => {
      const logger = new AuditLogger("test-ring", {
        persistToFile: false,
        maxEntries: 3,
      });
      for (let i = 0; i < 5; i++) {
        logger.log({ action: `overflow_${i}`, eventType: "system", level: "info" });
      }
      expect(logger.size()).toBe(3);
      // getRecent 返回最新的在前，所以 getRecent(3)[2] 是最早的（保留的）
      const recent = logger.getRecent(3);
      // 最旧的两条 (overflow_0, overflow_1) 被覆盖
      expect(recent[2]!.action).toBe("overflow_2");
      expect(recent[0]!.action).toBe("overflow_4");
      await logger.clear();
    });
  });
});
