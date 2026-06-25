/**
 * auditLogger 便捷方法 + verifyIntegrity 单元测试
 */
import { describe, it, expect, afterEach } from "bun:test";
import { AuditLogger } from "@/security/audit/auditLogger";
import { IntegrityError } from "@/security/audit/integrity";

describe("auditLogger 便捷方法", () => {
  let logger: AuditLogger;

  afterEach(async () => {
    await logger?.clear();
  });

  it("logAuth 记录认证成功事件", () => {
    logger = new AuditLogger("test-auth", { maxEntries: 100 });
    const id = logger.logAuth("login", {
      success: true,
      subject: { userId: "u1", username: "alice" },
    });
    expect(typeof id).toBe("string");
    const entry = logger.getRecent(1)[0]!;
    expect(entry.eventType).toBe("authentication");
    expect(entry.action).toBe("login");
    expect(entry.level).toBe("info");
    expect(entry.subject?.userId).toBe("u1");
  });

  it("logAuth 记录认证失败事件", () => {
    logger = new AuditLogger("test-auth", { maxEntries: 100 });
    logger.logAuth("login.failed", {
      success: false,
      subject: { userId: "u1" },
      error: "密码错误",
    });
    const entry = logger.getRecent(1)[0]!;
    expect(entry.eventType).toBe("authentication");
    expect(entry.level).toBe("warning");
    expect(entry.error).toBe("密码错误");
  });

  it("logAuthz 记录授权允许事件", () => {
    logger = new AuditLogger("test-authz", { maxEntries: 100 });
    logger.logAuthz("tool.execute", {
      allowed: true,
      resource: { type: "tool", id: "bash" },
    });
    const entry = logger.getRecent(1)[0]!;
    expect(entry.eventType).toBe("authorization");
    expect(entry.level).toBe("info");
    expect(entry.resource?.type).toBe("tool");
  });

  it("logAuthz 记录授权拒绝事件", () => {
    logger = new AuditLogger("test-authz", { maxEntries: 100 });
    logger.logAuthz("tool.execute", {
      allowed: false,
      resource: { type: "tool", id: "bash" },
      metadata: { reason: "权限不足" },
    });
    const entry = logger.getRecent(1)[0]!;
    expect(entry.eventType).toBe("authorization");
    expect(entry.level).toBe("warning");
  });

  it("logDataAccess 记录数据访问事件", () => {
    logger = new AuditLogger("test-data", { maxEntries: 100 });
    logger.logDataAccess("file.read", {
      resource: { type: "file", id: "/tmp/test" },
    });
    const entry = logger.getRecent(1)[0]!;
    expect(entry.eventType).toBe("data_access");
    expect(entry.level).toBe("info");
  });

  it("logDataModification 记录数据修改事件（含 before/after）", () => {
    logger = new AuditLogger("test-data", { maxEntries: 100 });
    logger.logDataModification("file.write", {
      resource: { type: "file", id: "/tmp/test" },
      before: { size: 100 },
      after: { size: 200 },
    });
    const entry = logger.getRecent(1)[0]!;
    expect(entry.eventType).toBe("data_modification");
    expect(entry.level).toBe("warning");
    expect(entry.metadata?.before).toEqual({ size: 100 });
    expect(entry.metadata?.after).toEqual({ size: 200 });
  });

  it("logConfigChange 记录配置变更事件", () => {
    logger = new AuditLogger("test-config", { maxEntries: 100 });
    logger.logConfigChange("config.update", {
      resource: { type: "config", id: "proxy" },
    });
    const entry = logger.getRecent(1)[0]!;
    expect(entry.eventType).toBe("config_change");
    expect(entry.level).toBe("warning");
  });

  it("logSecurityEvent 记录安全事件", () => {
    logger = new AuditLogger("test-sec", { maxEntries: 100 });
    logger.logSecurityEvent("brute_force", {
      severity: "critical",
      resource: { type: "auth", id: "login" },
    });
    const entry = logger.getRecent(1)[0]!;
    expect(entry.eventType).toBe("security_event");
    expect(entry.level).toBe("critical");
  });

  it("logSecurityEvent 支持 error 级别", () => {
    logger = new AuditLogger("test-sec", { maxEntries: 100 });
    logger.logSecurityEvent("rate_limit", {
      severity: "error",
    });
    const entry = logger.getRecent(1)[0]!;
    expect(entry.level).toBe("error");
  });
});

describe("verifyIntegrity 完整性签名验证", () => {
  let logger: AuditLogger;

  afterEach(async () => {
    await logger?.clear();
  });

  it("配置 integrityKey 后日志自动签名", () => {
    logger = new AuditLogger("test-integrity", { maxEntries: 100, integrityKey: "test-secret-key" });
    logger.log({ action: "signed-event", eventType: "system", level: "info" });
    const entry = logger.getRecent(1)[0]!;
    expect(entry.integrity).toBeDefined();
    expect(typeof entry.integrity).toBe("string");
    expect(entry.integrity!.length).toBe(64); // SHA-256 hex = 64 字符
  });

  it("verifyIntegrity 对合法签名返回 true", () => {
    logger = new AuditLogger("test-integrity", { maxEntries: 100, integrityKey: "test-secret-key" });
    logger.log({ action: "verify-test", eventType: "system", level: "info" });
    const entry = logger.getRecent(1)[0]!;
    expect(logger.verifyIntegrity(entry)).toBe(true);
  });

  it("verifyIntegrity 对未签名条目返回 false", () => {
    logger = new AuditLogger("test-integrity", { maxEntries: 100, integrityKey: "test-secret-key" });
    // 无 integrityKey 时创建的条目无签名
    const noKeyLogger = new AuditLogger("test-no-key", { maxEntries: 100 });
    noKeyLogger.log({ action: "unsigned", eventType: "system", level: "info" });
    const entry = noKeyLogger.getRecent(1)[0]!;
    expect(entry.integrity).toBeUndefined();
    expect(logger.verifyIntegrity(entry)).toBe(false);
  });

  it("verifyIntegrity 对篡改条目抛出 IntegrityError", () => {
    logger = new AuditLogger("test-integrity", { maxEntries: 100, integrityKey: "test-secret-key" });
    logger.log({ action: "tamper-test", eventType: "system", level: "info" });
    const entry = logger.getRecent(1)[0]!;
    // 篡改 action 字段
    entry.action = "tampered-action";
    expect(() => logger.verifyIntegrity(entry)).toThrow(IntegrityError);
  });

  it("不同 integrityKey 导致验证失败", () => {
    const logger1 = new AuditLogger("test-key1", { maxEntries: 100, integrityKey: "key-1" });
    const logger2 = new AuditLogger("test-key2", { maxEntries: 100, integrityKey: "key-2" });
    logger1.log({ action: "key-test", eventType: "system", level: "info" });
    const entry = logger1.getRecent(1)[0]!;
    // 用不同密钥验证
    expect(() => logger2.verifyIntegrity(entry)).toThrow(IntegrityError);
  });

  it("未配置 integrityKey 时 verifyIntegrity 抛出错误", () => {
    logger = new AuditLogger("test-no-key", { maxEntries: 100 });
    expect(() => logger.verifyIntegrity({} as any)).toThrow(IntegrityError);
  });
});
