/**
 * auditLogger resource 字段脱敏测试
 */
import { describe, it, expect, afterEach } from "bun:test";
import { AuditLogger } from "@/security/audit/auditLogger";

describe("log() 中 resource 字段脱敏", () => {
  let logger: AuditLogger;

  afterEach(async () => {
    await logger?.clear();
  });

  it("resource.token 敏感字段被脱敏", () => {
    logger = new AuditLogger("test-res", { maxEntries: 100, integrityKey: "test-key" });
    logger.log({
      action: "access",
      eventType: "data_access",
      level: "info",
      resource: { type: "api", id: "api-endpoint", token: "bearer_abcdefghijklmnop" } as any,
    });
    const entry = logger.getRecent(1)[0]!;
    expect((entry.resource as any)?.token).not.toBe("bearer_abcdefghijklmnop");
    expect((entry.resource as any)?.token).toContain("****");
  });

  it("resource.apiKey 敏感字段被脱敏", () => {
    logger = new AuditLogger("test-res", { maxEntries: 100, integrityKey: "test-key" });
    logger.log({
      action: "config",
      eventType: "config_change",
      level: "warning",
      resource: { type: "credential", apiKey: "sk-1234567890abcdef" } as any,
    });
    const entry = logger.getRecent(1)[0]!;
    expect((entry.resource as any)?.apiKey).not.toBe("sk-1234567890abcdef");
    expect((entry.resource as any)?.apiKey).toContain("****");
  });

  it("resource 中非敏感字段不被脱敏", () => {
    logger = new AuditLogger("test-res", { maxEntries: 100, integrityKey: "test-key" });
    logger.log({
      action: "access",
      eventType: "data_access",
      level: "info",
      resource: { type: "file", id: "/tmp/test.txt", name: "test-file" },
    });
    const entry = logger.getRecent(1)[0]!;
    expect(entry.resource?.id).toBe("/tmp/test.txt");
    expect(entry.resource?.name).toBe("test-file");
  });

  it("resource 为 undefined 时不报错", () => {
    logger = new AuditLogger("test-res", { maxEntries: 100, integrityKey: "test-key" });
    const id = logger.log({
      action: "no-resource",
      eventType: "system",
      level: "info",
    });
    expect(typeof id).toBe("string");
    const entry = logger.getRecent(1)[0]!;
    expect(entry.resource).toBeUndefined();
  });
});
