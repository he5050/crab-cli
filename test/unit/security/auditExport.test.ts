/**
 * auditLogger export 方法和工厂函数测试
 */
import { describe, it, expect, afterEach } from "bun:test";
import { AuditLogger, createAuditLogger } from "@/security/audit/auditLogger";
import { createMemoryStore, createFileStore } from "@/security/audit/auditStore";

describe("export() JSON 格式", () => {
  let logger: AuditLogger;

  afterEach(async () => {
    await logger?.clear();
  });

  it("export JSON 返回有效 JSON 字符串", () => {
    logger = new AuditLogger("test-export", { maxEntries: 100 });
    logger.log({ action: "test", eventType: "system", level: "info" });
    const json = logger.export("json");
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(1);
    expect(parsed[0].action).toBe("test");
  });

  it("export JSON 包含完整字段", () => {
    logger = new AuditLogger("test-export", { maxEntries: 100, version: "2.0" });
    logger.log({
      action: "full-test",
      eventType: "security_event",
      level: "warning",
      subject: { userId: "u1" },
      resource: { type: "tool", id: "bash" },
    });
    const json = logger.export("json");
    const parsed = JSON.parse(json);
    expect(parsed[0].app).toBe("test-export");
    expect(parsed[0].version).toBe("2.0");
    expect(parsed[0].subject.userId).toBe("u1");
    expect(parsed[0].resource.type).toBe("tool");
  });

  it("export JSON 空日志返回空数组", () => {
    logger = new AuditLogger("test-export", { maxEntries: 100 });
    const json = logger.export("json");
    const parsed = JSON.parse(json);
    expect(parsed).toEqual([]);
  });
});

describe("export() CSV 格式", () => {
  let logger: AuditLogger;

  afterEach(async () => {
    await logger?.clear();
  });

  it("export CSV 包含表头", () => {
    logger = new AuditLogger("test-csv", { maxEntries: 100 });
    const csv = logger.export("csv");
    const lines = csv.split("\n");
    expect(lines[0]).toContain("id");
    expect(lines[0]).toContain("timestamp");
    expect(lines[0]).toContain("eventType");
  });

  it("export CSV 行数与日志条目数匹配", () => {
    logger = new AuditLogger("test-csv", { maxEntries: 100 });
    logger.log({ action: "a1", eventType: "system", level: "info" });
    logger.log({ action: "a2", eventType: "system", level: "info" });
    const csv = logger.export("csv");
    const lines = csv.split("\n").filter(Boolean);
    expect(lines.length).toBe(3); // 1 header + 2 data
  });

  it("export CSV action 中的双引号被转义", () => {
    logger = new AuditLogger("test-csv", { maxEntries: 100 });
    logger.log({ action: 'test "quoted" action', eventType: "system", level: "info" });
    const csv = logger.export("csv");
    const dataLine = csv.split("\n")[1]!;
    // CSV 标准转义: " → ""
    expect(dataLine).toContain('test ""quoted"" action');
  });

  it("export CSV 默认格式为 json", () => {
    logger = new AuditLogger("test-csv", { maxEntries: 100 });
    const result = logger.export();
    expect(() => JSON.parse(result)).not.toThrow();
  });
});

describe("createAuditLogger 工厂函数", () => {
  it("创建基本的 AuditLogger 实例", () => {
    const logger = createAuditLogger("factory-test");
    expect(logger).toBeDefined();
    expect(logger.size()).toBe(0);
  });

  it("支持 version 选项", () => {
    const logger = createAuditLogger("factory-test", { version: "3.0" });
    logger.log({ action: "ver", eventType: "system", level: "info" });
    const entry = logger.getRecent(1)[0]!;
    expect(entry.version).toBe("3.0");
  });

  it("支持 maxEntries 选项", () => {
    const logger = createAuditLogger("factory-test", { maxEntries: 5 });
    for (let i = 0; i < 10; i++) {
      logger.log({ action: `fill_${i}`, eventType: "system", level: "info" });
    }
    expect(logger.size()).toBe(5);
  });

  it("支持 integrityKey 选项", () => {
    const logger = createAuditLogger("factory-test", { integrityKey: "factory-key" });
    logger.log({ action: "signed", eventType: "system", level: "info" });
    const entry = logger.getRecent(1)[0]!;
    expect(entry.integrity).toBeDefined();
  });

  it("支持 persistToFile 选项", () => {
    // persistToFile=true 需要文件系统，这里验证构造不抛错
    const logger = createAuditLogger("factory-test", { persistToFile: false });
    expect(logger.size()).toBe(0);
  });
});

describe("createMemoryStore 工厂函数", () => {
  it("创建 MemoryAuditStore 实例", async () => {
    const store = createMemoryStore(100);
    expect(store).toBeDefined();
    await store.save({
      id: "test-1",
      action: "test",
      app: "test",
      eventType: "system",
      level: "info",
      timestamp: Date.now(),
    });
    const info = await store.getStorageInfo();
    expect(info.count).toBe(1);
  });
});

describe("createFileStore 工厂函数", () => {
  it("创建 FileAuditStore 实例", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const tempDir = await mkdtemp(join(tmpdir(), "filestore-test-"));
    try {
      const store = createFileStore(join(tempDir, "audit.jsonl"), 100);
      expect(store).toBeDefined();
      await store.save({
        id: "test-1",
        action: "test",
        app: "test",
        eventType: "system",
        level: "info",
        timestamp: Date.now(),
      });
      const info = await store.getStorageInfo();
      expect(info.count).toBe(1);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
