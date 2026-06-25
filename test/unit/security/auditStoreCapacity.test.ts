/**
 * FileAuditStore 容量保护 + 损坏 JSONL 行 单元测试
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileAuditStore } from "@/security/audit/auditStore";
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

describe("FileAuditStore 容量保护与损坏行处理", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "audit-capacity-test-"));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("maxEntries 容量保护", () => {
    it("超过 maxEntries 时最旧条目被移除", async () => {
      const filePath = join(tempDir, "capacity.jsonl");
      const store = new FileAuditStore(filePath, 3); // 仅容纳 3 条

      for (let i = 0; i < 5; i++) {
        await store.save(makeEntry({ action: `cap_${i}` }));
      }

      const results = await store.query({});
      expect(results).toHaveLength(3);
      // 最旧的两条被移除
      expect(results[0]!.action).toBe("cap_2");
      expect(results[2]!.action).toBe("cap_4");
    });

    it("saveBatch 超过 maxEntries 时正确截断", async () => {
      const filePath = join(tempDir, "capacity-batch.jsonl");
      const store = new FileAuditStore(filePath, 3);

      await store.saveBatch([
        makeEntry({ action: "batch_0" }),
        makeEntry({ action: "batch_1" }),
        makeEntry({ action: "batch_2" }),
        makeEntry({ action: "batch_3" }),
        makeEntry({ action: "batch_4" }),
      ]);

      const results = await store.query({});
      expect(results).toHaveLength(3);
      expect(results[0]!.action).toBe("batch_2");
    });
  });

  describe("损坏 JSONL 行处理", () => {
    it("跳过损坏的行并正常加载有效行", async () => {
      const filePath = join(tempDir, "corrupted.jsonl");
      // 预写入包含损坏行的文件
      const goodEntry1 = JSON.stringify(makeEntry({ action: "good_1" }));
      const goodEntry2 = JSON.stringify(makeEntry({ action: "good_2" }));
      const content = `${goodEntry1}\n{invalid json\n${goodEntry2}\n`;
      await writeFile(filePath, content, "utf8");

      const store = new FileAuditStore(filePath);
      const results = await store.query({});
      expect(results).toHaveLength(2);
      expect(results[0]!.action).toBe("good_1");
      expect(results[1]!.action).toBe("good_2");
    });

    it("全部损坏行时返回空数组", async () => {
      const filePath = join(tempDir, "all-corrupted.jsonl");
      await writeFile(filePath, `{bad1\n{bad2\n`, "utf8");

      const store = new FileAuditStore(filePath);
      const results = await store.query({});
      expect(results).toHaveLength(0);
    });

    it("空文件正常加载", async () => {
      const filePath = join(tempDir, "empty.jsonl");
      await writeFile(filePath, "", "utf8");

      const store = new FileAuditStore(filePath);
      const results = await store.query({});
      expect(results).toHaveLength(0);
    });
  });

  describe("getStorageInfo", () => {
    it("返回正确的存储信息", async () => {
      const filePath = join(tempDir, "storage-info.jsonl");
      const store = new FileAuditStore(filePath);
      const now = Date.now();
      await store.save(makeEntry({ timestamp: now - 1000 }));
      await store.save(makeEntry({ timestamp: now }));

      const info = await store.getStorageInfo();
      expect(info.count).toBe(2);
      expect(info.oldestTimestamp).toBe(now - 1000);
      expect(info.newestTimestamp).toBe(now);
    });

    it("空存储返回 count=0", async () => {
      const filePath = join(tempDir, "empty-info.jsonl");
      const store = new FileAuditStore(filePath);
      const info = await store.getStorageInfo();
      expect(info.count).toBe(0);
      expect(info.oldestTimestamp).toBeUndefined();
      expect(info.newestTimestamp).toBeUndefined();
    });
  });

  describe("并发加载安全", () => {
    it("多次并发 query 调用不重复加载", async () => {
      const filePath = join(tempDir, "concurrent.jsonl");
      await store_save_seeds(filePath);

      const store = new FileAuditStore(filePath);
      // 并发发起多个 query 调用
      const [r1, r2, r3] = await Promise.all([store.query({}), store.query({}), store.query({})]);
      // 所有结果应一致
      expect(r1).toHaveLength(3);
      expect(r2).toHaveLength(3);
      expect(r3).toHaveLength(3);
    });
  });
});

/** 辅助: 写入种子数据到文件 */
async function store_save_seeds(filePath: string): Promise<void> {
  const entries = [makeEntry({ action: "seed_1" }), makeEntry({ action: "seed_2" }), makeEntry({ action: "seed_3" })];
  const lines = entries.map((e) => `${JSON.stringify(e)}\n`).join("");
  await writeFile(filePath, lines, "utf8");
}
