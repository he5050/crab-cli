/**
 * auditStore 单元测试 — 审计日志存储
 */
import { describe, it, expect, afterEach, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  MemoryAuditStore,
  FileAuditStore,
  createMemoryStore,
  createFileStore,
  applyAuditFilters,
  computeAuditStats,
  validateAuditStoreConfig,
} from "@/security/audit/auditStore";
import type { AuditLogEntry } from "@/security/audit/auditLogger";

function makeEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: `audit_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    app: "test-app",
    timestamp: Date.now(),
    action: "test.action",
    eventType: "system",
    level: "info",
    ...overrides,
  };
}

describe("auditStore", () => {
  describe("MemoryAuditStore", () => {
    let store: MemoryAuditStore;

    afterEach(() => {
      store.clear();
    });

    it("save 和 query 基本功能", async () => {
      store = new MemoryAuditStore(100);
      const entry = makeEntry();
      await store.save(entry);
      const results = await store.query({});
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe(entry.id);
    });

    it("saveBatch 批量保存", async () => {
      store = new MemoryAuditStore(100);
      const entries = [makeEntry({ action: "a1" }), makeEntry({ action: "a2" }), makeEntry({ action: "a3" })];
      await store.saveBatch(entries);
      const results = await store.query({});
      expect(results).toHaveLength(3);
    });

    it("getRecent 获取最近 N 条", async () => {
      store = new MemoryAuditStore(100);
      for (let i = 0; i < 5; i++) {
        await store.save(makeEntry({ action: `action_${i}` }));
      }
      const recent = await store.getRecent(3);
      expect(recent).toHaveLength(3);
      expect(recent[2]!.action).toBe("action_4");
    });

    it("getStats 返回统计信息", async () => {
      store = new MemoryAuditStore(100);
      await store.save(makeEntry({ eventType: "authentication", level: "info" }));
      await store.save(makeEntry({ eventType: "authentication", level: "warning" }));
      await store.save(makeEntry({ eventType: "data_access", level: "info" }));

      const stats = await store.getStats();
      expect(stats.total).toBe(3);
      expect(stats.byEventType.authentication).toBe(2);
      expect(stats.byEventType.data_access).toBe(1);
      expect(stats.byLevel.info).toBe(2);
      expect(stats.byLevel.warning).toBe(1);
    });

    it("deleteOlderThan 删除旧日志", async () => {
      store = new MemoryAuditStore(100);
      const now = Date.now();
      await store.save(makeEntry({ timestamp: now - 2000 }));
      await store.save(makeEntry({ timestamp: now - 1000 }));
      await store.save(makeEntry({ timestamp: now }));

      const deleted = await store.deleteOlderThan(now - 500);
      expect(deleted).toBe(2);
      const remaining = await store.query({});
      expect(remaining).toHaveLength(1);
    });

    it("getStorageInfo 返回存储信息", async () => {
      store = new MemoryAuditStore(100);
      const now = Date.now();
      await store.save(makeEntry({ timestamp: now - 1000 }));
      await store.save(makeEntry({ timestamp: now }));

      const info = await store.getStorageInfo();
      expect(info.count).toBe(2);
      expect(info.oldestTimestamp).toBe(now - 1000);
      expect(info.newestTimestamp).toBe(now);
    });

    it("空存储的 getStorageInfo", async () => {
      store = new MemoryAuditStore(100);
      const info = await store.getStorageInfo();
      expect(info.count).toBe(0);
      expect(info.oldestTimestamp).toBeUndefined();
      expect(info.newestTimestamp).toBeUndefined();
    });

    it("clear 清除所有日志", async () => {
      store = new MemoryAuditStore(100);
      await store.save(makeEntry());
      await store.save(makeEntry());
      store.clear();
      const results = await store.query({});
      expect(results).toHaveLength(0);
    });

    it("RingBuffer 容量限制", async () => {
      store = new MemoryAuditStore(3); // 仅能容纳 3 条
      for (let i = 0; i < 5; i++) {
        await store.save(makeEntry({ action: `action_${i}` }));
      }
      const results = await store.query({});
      expect(results).toHaveLength(3);
      // 最旧的两条被覆盖, 保留最后 3 条
      expect(results[0]!.action).toBe("action_2");
      expect(results[2]!.action).toBe("action_4");
    });
  });

  describe("FileAuditStore", () => {
    let tempDir: string;
    let store: FileAuditStore;

    beforeAll(async () => {
      tempDir = await mkdtemp(join(tmpdir(), "audit-store-test-"));
    });

    afterEach(async () => {
      store = undefined as unknown as FileAuditStore;
    });

    afterAll(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it("save 和 query 使用临时目录", async () => {
      const filePath = join(tempDir, "test1.jsonl");
      store = new FileAuditStore(filePath);
      const entry = makeEntry({ action: "file-test" });
      await store.save(entry);
      const results = await store.query({});
      expect(results).toHaveLength(1);
      expect(results[0]!.action).toBe("file-test");
    });

    it("saveBatch 批量写入文件", async () => {
      const filePath = join(tempDir, "test2.jsonl");
      store = new FileAuditStore(filePath);
      const entries = [makeEntry({ action: "batch1" }), makeEntry({ action: "batch2" })];
      await store.saveBatch(entries);
      const results = await store.query({});
      expect(results).toHaveLength(2);
    });

    it("getRecent 获取最近条目", async () => {
      const filePath = join(tempDir, "test3.jsonl");
      store = new FileAuditStore(filePath);
      for (let i = 0; i < 5; i++) {
        await store.save(makeEntry({ action: `file_action_${i}` }));
      }
      const recent = await store.getRecent(2);
      expect(recent).toHaveLength(2);
      expect(recent[1]!.action).toBe("file_action_4");
    });

    it("getStats 返回统计", async () => {
      const filePath = join(tempDir, "test4.jsonl");
      store = new FileAuditStore(filePath);
      await store.save(makeEntry({ eventType: "authentication", level: "info" }));
      await store.save(makeEntry({ eventType: "security_event", level: "error" }));

      const stats = await store.getStats();
      expect(stats.total).toBe(2);
      expect(stats.byEventType.authentication).toBe(1);
      expect(stats.byEventType.security_event).toBe(1);
    });

    it("deleteOlderThan 删除旧条目", async () => {
      const filePath = join(tempDir, "test5.jsonl");
      store = new FileAuditStore(filePath);
      const now = Date.now();
      await store.save(makeEntry({ timestamp: now - 5000 }));
      await store.save(makeEntry({ timestamp: now }));

      const deleted = await store.deleteOlderThan(now - 1000);
      expect(deleted).toBe(1);
      const results = await store.query({});
      expect(results).toHaveLength(1);
    });

    it("文件持久化: 重载后数据保留", async () => {
      const filePath = join(tempDir, "test6.jsonl");
      const store1 = new FileAuditStore(filePath);
      await store1.save(makeEntry({ action: "persisted" }));

      // 创建新实例重新加载同一文件
      const store2 = new FileAuditStore(filePath);
      const results = await store2.query({});
      expect(results).toHaveLength(1);
      expect(results[0]!.action).toBe("persisted");
    });
  });

  describe("createMemoryStore", () => {
    it("工厂函数创建 MemoryAuditStore", () => {
      const store = createMemoryStore(500);
      expect(store).toBeDefined();
      expect(store.save).toBeDefined();
    });
  });

  describe("createFileStore", () => {
    it("工厂函数创建 FileAuditStore", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "audit-factory-"));
      const filePath = join(tempDir, "factory.jsonl");
      const store = createFileStore(filePath);
      expect(store).toBeDefined();
      expect(store.save).toBeDefined();
      await rm(tempDir, { recursive: true, force: true });
    });
  });

  describe("applyAuditFilters", () => {
    it("无过滤条件返回全部", () => {
      const entries = [makeEntry({ action: "a1" }), makeEntry({ action: "a2" })];
      const results = applyAuditFilters(entries, {});
      expect(results).toHaveLength(2);
    });

    it("时间范围过滤", () => {
      const now = Date.now();
      const entries = [
        makeEntry({ timestamp: now - 2000 }),
        makeEntry({ timestamp: now - 1000 }),
        makeEntry({ timestamp: now }),
      ];
      const results = applyAuditFilters(entries, { startTime: now - 1500, endTime: now - 500 });
      expect(results).toHaveLength(1);
    });

    it("事件类型过滤", () => {
      const entries = [
        makeEntry({ eventType: "authentication" }),
        makeEntry({ eventType: "data_access" }),
        makeEntry({ eventType: "authentication" }),
      ];
      const results = applyAuditFilters(entries, { eventType: "authentication" });
      expect(results).toHaveLength(2);
    });

    it("事件类型数组过滤", () => {
      const entries = [
        makeEntry({ eventType: "authentication" }),
        makeEntry({ eventType: "data_access" }),
        makeEntry({ eventType: "security_event" }),
      ];
      const results = applyAuditFilters(entries, { eventType: ["authentication", "security_event"] });
      expect(results).toHaveLength(2);
    });

    it("级别过滤", () => {
      const entries = [makeEntry({ level: "info" }), makeEntry({ level: "warning" }), makeEntry({ level: "info" })];
      const results = applyAuditFilters(entries, { level: "info" });
      expect(results).toHaveLength(2);
    });

    it("主体 ID 过滤", () => {
      const entries = [makeEntry({ subject: { userId: "u1" } }), makeEntry({ subject: { userId: "u2" } }), makeEntry()];
      const results = applyAuditFilters(entries, { subjectId: "u1" });
      expect(results).toHaveLength(1);
    });

    it("资源类型过滤", () => {
      const entries = [makeEntry({ resource: { type: "file" } }), makeEntry({ resource: { type: "db" } })];
      const results = applyAuditFilters(entries, { resourceType: "file" });
      expect(results).toHaveLength(1);
    });

    it("资源 ID 过滤", () => {
      const entries = [
        makeEntry({ resource: { type: "file", id: "f1" } }),
        makeEntry({ resource: { type: "file", id: "f2" } }),
      ];
      const results = applyAuditFilters(entries, { resourceId: "f1" });
      expect(results).toHaveLength(1);
    });

    it("搜索关键词过滤(action)", () => {
      const entries = [
        makeEntry({ action: "user.login" }),
        makeEntry({ action: "user.logout" }),
        makeEntry({ action: "data.read" }),
      ];
      const results = applyAuditFilters(entries, { search: "login" });
      expect(results).toHaveLength(1);
    });

    it("搜索关键词过滤(username)", () => {
      const entries = [makeEntry({ subject: { username: "alice" } }), makeEntry({ subject: { username: "bob" } })];
      const results = applyAuditFilters(entries, { search: "alice" });
      expect(results).toHaveLength(1);
    });

    it("搜索关键词过滤(resource name)", () => {
      const entries = [
        makeEntry({ resource: { type: "file", name: "important-file" } }),
        makeEntry({ resource: { type: "file", name: "other-file" } }),
      ];
      const results = applyAuditFilters(entries, { search: "important" });
      expect(results).toHaveLength(1);
    });

    it("分页 offset + limit", () => {
      const entries = Array.from({ length: 10 }, (_, i) => makeEntry({ action: `a${i}` }));
      const results = applyAuditFilters(entries, { offset: 3, limit: 2 });
      expect(results).toHaveLength(2);
      expect(results[0]!.action).toBe("a3");
    });
  });

  describe("computeAuditStats", () => {
    it("基本统计计算", () => {
      const entries = [
        makeEntry({ eventType: "authentication", level: "info" }),
        makeEntry({ eventType: "authentication", level: "warning" }),
        makeEntry({ eventType: "data_access", level: "info" }),
      ];
      const stats = computeAuditStats(entries);
      expect(stats.total).toBe(3);
      expect(stats.byEventType.authentication).toBe(2);
      expect(stats.byEventType.data_access).toBe(1);
      expect(stats.byLevel.info).toBe(2);
      expect(stats.byLevel.warning).toBe(1);
    });

    it("时间范围过滤统计", () => {
      const now = Date.now();
      const entries = [
        makeEntry({ timestamp: now - 2000, eventType: "authentication", level: "info" }),
        makeEntry({ timestamp: now, eventType: "data_access", level: "info" }),
      ];
      const stats = computeAuditStats(entries, { startTime: now - 500, endTime: now + 500 });
      expect(stats.total).toBe(1);
      expect(stats.byEventType.data_access).toBe(1);
    });

    it("空数组统计", () => {
      const stats = computeAuditStats([]);
      expect(stats.total).toBe(0);
      expect(Object.keys(stats.byLevel)).toHaveLength(0);
      expect(Object.keys(stats.byEventType)).toHaveLength(0);
    });
  });

  describe("validateAuditStoreConfig", () => {
    it("maxEntries 为 0 抛错", () => {
      expect(() => validateAuditStoreConfig({ maxEntries: 0 })).toThrow();
    });

    it("maxEntries 为负数抛错", () => {
      expect(() => validateAuditStoreConfig({ maxEntries: -1 })).toThrow();
    });

    it("maxEntries 非整数抛错", () => {
      expect(() => validateAuditStoreConfig({ maxEntries: 1.5 })).toThrow();
    });

    it("maxEntries 超过安全上限抛错", () => {
      expect(() => validateAuditStoreConfig({ maxEntries: 20_000_000 })).toThrow();
    });

    it("filePath 非字符串抛错", () => {
      expect(() => validateAuditStoreConfig({ filePath: 123 as unknown as string })).toThrow();
    });

    it("合法配置不抛错", () => {
      expect(() => validateAuditStoreConfig({ maxEntries: 5000, filePath: "/tmp/test.jsonl" })).not.toThrow();
    });

    it("默认 maxEntries 合法", () => {
      expect(() => validateAuditStoreConfig({})).not.toThrow();
    });
  });
});
