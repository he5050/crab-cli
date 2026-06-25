/**
 * auditLogger 单元测试 — 审计日志服务
 */
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { AuditLogger, createAuditLogger, type AuditLogEntry } from "@/security/audit/auditLogger";
import { IntegrityError } from "@/security/audit/integrity";

const TEST_SECRET = "test-integrity-key";

function createTestLogger(options?: { integrityKey?: string; maxEntries?: number }): AuditLogger {
  return new AuditLogger("test-app", {
    version: "0.0.1",
    persistToFile: false, // 跳过文件操作
    maxEntries: options?.maxEntries ?? 1000,
    integrityKey: options?.integrityKey ?? null,
  });
}

describe("auditLogger", () => {
  let logger: AuditLogger;

  beforeEach(() => {
    logger = createTestLogger();
  });

  afterEach(async () => {
    await logger.clear();
  });

  describe("log", () => {
    it("基本日志记录返回 id", () => {
      const id = logger.log({
        action: "test.action",
        eventType: "system",
        level: "info",
      });
      expect(typeof id).toBe("string");
      expect(id).toMatch(/^audit_/);
    });

    it("日志条目包含正确的字段", () => {
      logger.log({
        action: "test.action",
        eventType: "system",
        level: "info",
      });
      const recent = logger.getRecent(1);
      expect(recent.length).toBe(1);
      expect(recent[0]!.action).toBe("test.action");
      expect(recent[0]!.eventType).toBe("system");
      expect(recent[0]!.level).toBe("info");
      expect(recent[0]!.app).toBe("test-app");
      expect(recent[0]!.timestamp).toBeGreaterThan(0);
    });
  });

  describe("logAuth", () => {
    it("成功认证记录为 info 级别", () => {
      logger.logAuth("login", { success: true, subject: { userId: "u1", username: "alice" } });
      const recent = logger.getRecent(1);
      expect(recent[0]!.eventType).toBe("authentication");
      expect(recent[0]!.level).toBe("info");
      expect(recent[0]!.subject?.userId).toBe("u1");
    });

    it("失败认证记录为 warning 级别", () => {
      logger.logAuth("login", { success: false, subject: { userId: "u1" }, error: "bad password" });
      const recent = logger.getRecent(1);
      expect(recent[0]!.level).toBe("warning");
      expect(recent[0]!.error).toBe("bad password");
    });
  });

  describe("logAuthz", () => {
    it("允许授权记录为 info 级别", () => {
      logger.logAuthz("read", { allowed: true, resource: { type: "file", id: "f1" } });
      const recent = logger.getRecent(1);
      expect(recent[0]!.eventType).toBe("authorization");
      expect(recent[0]!.level).toBe("info");
    });

    it("拒绝授权记录为 warning 级别", () => {
      logger.logAuthz("delete", { allowed: false, resource: { type: "file", id: "f1" } });
      const recent = logger.getRecent(1);
      expect(recent[0]!.level).toBe("warning");
    });
  });

  describe("logDataAccess", () => {
    it("记录数据访问", () => {
      logger.logDataAccess("read", { resource: { type: "db", id: "t1" } });
      const recent = logger.getRecent(1);
      expect(recent[0]!.eventType).toBe("data_access");
      expect(recent[0]!.level).toBe("info");
      expect(recent[0]!.resource?.type).toBe("db");
    });
  });

  describe("logDataModification", () => {
    it("记录数据修改含 before/after", () => {
      logger.logDataModification("update", {
        resource: { type: "db", id: "t1" },
        before: { name: "old" },
        after: { name: "new" },
      });
      const recent = logger.getRecent(1);
      expect(recent[0]!.eventType).toBe("data_modification");
      expect(recent[0]!.level).toBe("warning");
      expect(recent[0]!.metadata?.before).toEqual({ name: "old" });
      expect(recent[0]!.metadata?.after).toEqual({ name: "new" });
    });
  });

  describe("logConfigChange", () => {
    it("记录配置变更", () => {
      logger.logConfigChange("update_config", { resource: { type: "config", id: "c1" } });
      const recent = logger.getRecent(1);
      expect(recent[0]!.eventType).toBe("config_change");
      expect(recent[0]!.level).toBe("warning");
    });
  });

  describe("logSecurityEvent", () => {
    it("记录安全事件", () => {
      logger.logSecurityEvent("brute_force", {
        severity: "error",
        resource: { type: "auth" },
      });
      const recent = logger.getRecent(1);
      expect(recent[0]!.eventType).toBe("security_event");
      expect(recent[0]!.level).toBe("error");
    });
  });

  describe("query", () => {
    beforeEach(() => {
      const now = Date.now();
      logger.log({ action: "auth.login", eventType: "authentication", level: "info" });
      logger.log({
        action: "authz.read",
        eventType: "authorization",
        level: "info",
        timestamp: now + 1,
      } as AuditLogEntry);
      logger.log({
        action: "auth.fail",
        eventType: "authentication",
        level: "warning",
        timestamp: now + 2,
      } as AuditLogEntry);
      logger.log({
        action: "data.read",
        eventType: "data_access",
        level: "info",
        timestamp: now + 3,
      } as AuditLogEntry);
    });

    it("时间范围过滤", () => {
      const now = Date.now();
      const results = logger.query({ startTime: now, endTime: now + 2 });
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it("事件类型过滤(单个)", () => {
      const results = logger.query({ eventType: "authentication" });
      expect(results.every((e) => e.eventType === "authentication")).toBe(true);
    });

    it("事件类型过滤(数组)", () => {
      const results = logger.query({ eventType: ["authentication", "authorization"] });
      expect(results.every((e) => e.eventType === "authentication" || e.eventType === "authorization")).toBe(true);
    });

    it("级别过滤", () => {
      const results = logger.query({ level: "warning" });
      expect(results.every((e) => e.level === "warning")).toBe(true);
      expect(results.length).toBe(1);
    });

    it("搜索关键词(action)", () => {
      const results = logger.query({ search: "login" });
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it("分页(offset + limit)", () => {
      const results = logger.query({ offset: 0, limit: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  describe("getRecent", () => {
    it("获取最近 N 条", () => {
      for (let i = 0; i < 5; i++) {
        logger.log({ action: `action_${i}`, eventType: "system", level: "info" });
      }
      const recent = logger.getRecent(3);
      expect(recent.length).toBe(3);
      // 最近的第一条应该是最后记录的
      expect(recent[0]!.action).toBe("action_4");
    });
  });

  describe("getStats", () => {
    it("返回统计信息", () => {
      logger.log({ action: "a1", eventType: "authentication", level: "info" });
      logger.log({ action: "a2", eventType: "authorization", level: "warning" });
      logger.log({ action: "a3", eventType: "authentication", level: "error" });

      const stats = logger.getStats();
      expect(stats.total).toBe(3);
      expect(stats.byEventType.authentication).toBe(2);
      expect(stats.byEventType.authorization).toBe(1);
      expect(stats.byLevel.info).toBe(1);
      expect(stats.byLevel.warning).toBe(1);
      expect(stats.byLevel.error).toBe(1);
    });
  });

  describe("export", () => {
    it("JSON 格式导出", () => {
      logger.log({ action: "test", eventType: "system", level: "info" });
      const json = logger.export("json");
      const parsed = JSON.parse(json);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(1);
    });

    it("CSV 格式导出", () => {
      logger.log({ action: "test", eventType: "system", level: "info" });
      const csv = logger.export("csv");
      const lines = csv.split("\n");
      expect(lines[0]).toContain("id,timestamp,app,eventType,level,action");
      expect(lines.length).toBe(2); // header + 1 data
    });
  });

  describe("size", () => {
    it("获取日志数量", () => {
      expect(logger.size()).toBe(0);
      logger.log({ action: "test", eventType: "system", level: "info" });
      expect(logger.size()).toBe(1);
      logger.log({ action: "test2", eventType: "system", level: "info" });
      expect(logger.size()).toBe(2);
    });
  });

  describe("onAuditEntry", () => {
    it("监听器注册和取消", () => {
      const listener = mock(() => {});
      const unsub = logger.onAuditEntry(listener);
      logger.log({ action: "test", eventType: "system", level: "info" });
      expect(listener).toHaveBeenCalledTimes(1);

      // 取消注册
      unsub();
      logger.log({ action: "test2", eventType: "system", level: "info" });
      expect(listener).toHaveBeenCalledTimes(1); // 不再增加
    });
  });

  describe("verifyIntegrity", () => {
    it("未配置密钥抛错", () => {
      logger = createTestLogger({ integrityKey: undefined });
      const entry = logger.getRecent(1)[0];
      expect(() => logger.verifyIntegrity({ ...entry, id: "test" } as AuditLogEntry)).toThrow(IntegrityError);
    });

    it("配置密钥后签名验证通过", () => {
      logger = createTestLogger({ integrityKey: TEST_SECRET });
      logger.log({ action: "test", eventType: "system", level: "info" });
      const entry = logger.getRecent(1)[0]!;
      expect(logger.verifyIntegrity(entry)).toBe(true);
    });

    it("篡改后签名验证失败", () => {
      logger = createTestLogger({ integrityKey: TEST_SECRET });
      logger.log({ action: "test", eventType: "system", level: "info" });
      const entry = logger.getRecent(1)[0]!;
      // 篡改 action
      (entry as unknown as Record<string, unknown>).action = "tampered";
      expect(() => logger.verifyIntegrity(entry)).toThrow(IntegrityError);
    });
  });

  describe("clear", () => {
    it("非生产环境清除日志", async () => {
      logger.log({ action: "test", eventType: "system", level: "info" });
      expect(logger.size()).toBe(1);
      await logger.clear();
      expect(logger.size()).toBe(0);
    });
  });

  describe("EventEmitter", () => {
    it("entry 事件触发", () => {
      const listener = mock(() => {});
      logger.on("entry", listener);
      logger.log({ action: "test", eventType: "system", level: "info" });
      expect(listener).toHaveBeenCalledTimes(1);

      logger.removeAllListeners("entry");
    });
  });

  describe("createAuditLogger", () => {
    it("工厂函数创建实例", async () => {
      const instance = createAuditLogger("my-app", { version: "1.0", maxEntries: 500 });
      expect(instance).toBeInstanceOf(AuditLogger);
      await instance.clear();
    });
  });
});
