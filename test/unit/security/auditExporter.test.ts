/**
 * exporter 独立函数 + AuditLogger 新增功能测试
 */
import { describe, it, expect, afterEach } from "bun:test";
import { exportAuditAsJson, exportAuditAsCsv } from "@/security/audit/exporter";
import { AuditLogger, createAuditLogger } from "@/security/audit/auditLogger";
import type { AuditLogEntry } from "@/security/audit/auditLogger";

describe("exportAuditAsJson", () => {
  it("空数组返回空 JSON 数组", () => {
    const result = exportAuditAsJson([]);
    expect(JSON.parse(result)).toEqual([]);
  });

  it("包含完整字段的对象序列化正确", () => {
    const entries: AuditLogEntry[] = [
      {
        id: "test-1",
        action: "test",
        app: "test-app",
        eventType: "system",
        level: "info",
        timestamp: 1700000000000,
        version: "1.0",
      },
    ];
    const result = exportAuditAsJson(entries);
    const parsed = JSON.parse(result);
    expect(parsed.length).toBe(1);
    expect(parsed[0].id).toBe("test-1");
    expect(parsed[0].app).toBe("test-app");
  });

  it("输出格式化 JSON（有缩进）", () => {
    const entries: AuditLogEntry[] = [
      { id: "1", action: "a", app: "t", eventType: "system", level: "info", timestamp: 0 },
    ];
    const result = exportAuditAsJson(entries);
    expect(result).toContain("  "); // 格式化缩进
  });
});

describe("exportAuditAsCsv", () => {
  it("空数组仅返回表头", () => {
    const result = exportAuditAsCsv([]);
    const lines = result.split("\n");
    expect(lines[0]).toContain("id");
    expect(lines[0]).toContain("timestamp");
  });

  it("包含正确的列数", () => {
    const entries: AuditLogEntry[] = [
      {
        id: "1",
        action: "test-action",
        app: "app",
        eventType: "system",
        level: "info",
        timestamp: 1700000000000,
      },
    ];
    const result = exportAuditAsCsv(entries);
    const lines = result.split("\n").filter(Boolean);
    expect(lines.length).toBe(2);
    // action 字段被双引号包裹，split(",") 会将 "test-action" 作为一个整体
    const dataCols = lines[1]!.split(",");
    // headers: id, timestamp, app, eventType, level, "action", userId, resourceType = 8 cols
    // action 被引号包裹所以不会产生额外的 split
    expect(dataCols.length).toBe(8);
  });

  it("双引号正确转义", () => {
    const entries: AuditLogEntry[] = [
      {
        id: "1",
        action: 'say "hello" now',
        app: "app",
        eventType: "system",
        level: "info",
        timestamp: 1700000000000,
      },
    ];
    const result = exportAuditAsCsv(entries);
    expect(result).toContain('say ""hello"" now');
  });

  it("缺省字段用空字符串填充", () => {
    const entries: AuditLogEntry[] = [
      {
        id: "1",
        action: "test",
        app: "app",
        eventType: "system",
        level: "info",
        timestamp: 1700000000000,
      },
    ];
    const result = exportAuditAsCsv(entries);
    const lines = result.split("\n");
    const dataLine = lines[1]!;
    // subject?.userId 缺省 → 空, resource?.type 缺省 → 空
    const cols = dataLine.split(",");
    expect(cols[6]).toBe(""); // userId 缺省
    expect(cols[7]).toBe(""); // resourceType 缺省
  });
});

describe("AuditLogger.getPersistenceInfo", () => {
  let logger: AuditLogger;

  afterEach(async () => {
    await logger?.clear();
  });

  it("persistToFile=false 时返回 null", () => {
    logger = new AuditLogger("test-persist-info", { persistToFile: false });
    expect(logger.getPersistenceInfo()).toBeNull();
  });

  it("persistToFile=true 时返回文件路径和失败计数", async () => {
    logger = new AuditLogger("test-persist-info", { persistToFile: true });
    await logger.init();
    const info = logger.getPersistenceInfo();
    expect(info).not.toBeNull();
    expect(info!.filePath).toContain("audit.jsonl");
    expect(info!.consecutiveWriteFailures).toBe(0);
    await logger.clear();
  });

  it("写入后失败计数仍为 0", async () => {
    logger = new AuditLogger("test-persist-info", { persistToFile: true });
    await logger.init();
    logger.log({ action: "test", eventType: "system", level: "info" });
    // 等待写入完成
    await new Promise((r) => setTimeout(r, 50));
    expect(logger.getPersistenceInfo()!.consecutiveWriteFailures).toBe(0);
    await logger.clear();
  });
});

describe("AuditLogger maxLogFileSize 选项", () => {
  it("创建时接受 maxLogFileSize 参数", () => {
    const logger = new AuditLogger("test-max-size", {
      persistToFile: false,
      maxLogFileSize: 1024,
    });
    expect(logger.size()).toBe(0);
  });

  it("createAuditLogger 支持传递 maxLogFileSize", () => {
    const logger = createAuditLogger("test-factory-size", {
      maxLogFileSize: 5 * 1024 * 1024,
    });
    expect(logger).toBeDefined();
  });
});
