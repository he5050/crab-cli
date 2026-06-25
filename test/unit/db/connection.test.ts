/**
 * 数据库连接管理单元测试。
 *
 * 覆盖场景:
 *   - initDb 懒初始化 / 重复调用幂等 / 自定义路径
 *   - getDb 未初始化时自动调用 initDb
 *   - getRawDb 返回原始 Database
 *   - closeDb 连接关闭
 *   - resetDb 清空单例状态后可重新初始化
 *   - getDbPath 缓存 / 自定义路径覆盖
 *   - applyPragmas PRAGMA 验证
 *   - 迁移幂等（多次 initDb 不报错）
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import path from "node:path";
import { closeDb, getDb, getDbPath, getRawDb, initDb, resetDb } from "@/db";
import { applyPragmas } from "@/db/core/connection";
import { cleanupTestDir, createGlobalTmpTestDir } from "../../helpers/testPaths";

describe("数据库连接管理", () => {
  let tempDir = "";
  let originalXdgDataHome: string | undefined;

  beforeEach(() => {
    resetDb();
    tempDir = createGlobalTmpTestDir("db-conn-");
    originalXdgDataHome = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = tempDir;
  });

  afterEach(() => {
    resetDb();
    if (originalXdgDataHome !== undefined) {
      process.env.XDG_DATA_HOME = originalXdgDataHome;
    } else {
      delete process.env.XDG_DATA_HOME;
    }
    cleanupTestDir(tempDir);
  });

  describe("initDb", () => {
    test("初始化数据库并返回 Drizzle 实例", () => {
      const db = initDb();

      expect(db).toBeDefined();
      expect(getRawDb()).not.toBeNull();
    });

    test("重复调用 initDb 返回同一实例（幂等）", () => {
      const db1 = initDb();
      const db2 = initDb();

      expect(db1).toBe(db2);
    });

    test("自定义路径创建数据库文件", () => {
      const dbPath = path.join(tempDir, "custom.db");
      const db = initDb(dbPath);

      expect(db).toBeDefined();
      expect(getDbPath()).toBe(dbPath);
    });

    test("自定义路径重复调用返回同一实例", () => {
      const dbPath = path.join(tempDir, "custom.db");
      const db1 = initDb(dbPath);
      const db2 = initDb(dbPath);

      expect(db1).toBe(db2);
    });
  });

  describe("getDb", () => {
    test("未初始化时自动调用 initDb", () => {
      // resetDb 已在 beforeEach 调用，确保未初始化
      const db = getDb();

      expect(db).toBeDefined();
    });

    test("初始化后返回同一实例", () => {
      const initResult = initDb();
      const getResult = getDb();

      expect(getResult).toBe(initResult);
    });
  });

  describe("getRawDb", () => {
    test("返回原始 Database 实例", () => {
      initDb();
      const raw = getRawDb();

      expect(raw).toBeInstanceOf(Database);
    });

    test("未初始化时返回 null", () => {
      resetDb();
      const raw = getRawDb();

      expect(raw).toBeNull();
    });
  });

  describe("closeDb", () => {
    test("关闭数据库连接", () => {
      initDb();
      closeDb();

      expect(getRawDb()).toBeNull();
    });

    test("未初始化时调用 closeDb 不报错", () => {
      expect(() => closeDb()).not.toThrow();
    });
  });

  describe("resetDb", () => {
    test("清空单例状态（drizzle/db 置空，路径回归默认计算）", () => {
      initDb();
      resetDb();

      expect(getRawDb()).toBeNull();
      // dbPath 置空后 getDbPath 会重新计算默认路径
      expect(getDbPath()).toContain("crab.db");
    });

    test("resetDb 后可重新初始化", () => {
      initDb();
      resetDb();

      const db = initDb();
      expect(db).toBeDefined();
      expect(getRawDb()).not.toBeNull();
    });
  });

  describe("getDbPath", () => {
    test("未设置自定义路径时返回默认路径", () => {
      const p = getDbPath();

      expect(p).toContain("crab.db");
    });

    test("自定义路径覆盖后返回自定义路径", () => {
      const dbPath = path.join(tempDir, "custom.db");
      initDb(dbPath);

      expect(getDbPath()).toBe(dbPath);
    });

    test("resetDb 后 dbPath 被清空，getDbPath 重新计算默认路径", () => {
      initDb();
      resetDb();

      // dbState.dbPath 被置空，但 getDbPath 会 fallback 计算默认值
      expect(getDbPath()).toContain("crab.db");
    });
  });

  describe("PRAGMA 配置", () => {
    test("WAL 模式已启用", () => {
      initDb();
      const raw = getRawDb()!;

      const result = raw.query("PRAGMA journal_mode").get() as { journal_mode?: string } | null;
      expect(result?.journal_mode).toBe("wal");
    });

    test("外键约束已启用", () => {
      initDb();
      const raw = getRawDb()!;

      const result = raw.query("PRAGMA foreign_keys").get() as { foreign_keys?: number } | null;
      expect(result?.foreign_keys).toBe(1);
    });

    test("busy_timeout 已配置", () => {
      initDb();
      const raw = getRawDb()!;

      const result = raw.query("PRAGMA busy_timeout").get() as { timeout?: number } | null;
      expect(result?.timeout).toBeGreaterThan(0);
    });
  });

  describe("迁移幂等", () => {
    test("多次 initDb 不报错", () => {
      initDb();
      // 第二次 initDb 应幂等（不重复迁移）
      expect(() => initDb()).not.toThrow();
      // 第三次通过 getDb 触发
      expect(() => getDb()).not.toThrow();
    });
  });

  describe("applyPragmas", () => {
    test("对独立 Database 实例正确配置 WAL、外键、busy_timeout", () => {
      const dbPath = path.join(tempDir, "pragma-test.db");
      const standaloneDb = new Database(dbPath, { create: true });
      try {
        applyPragmas(standaloneDb);

        const journalMode = standaloneDb.query("PRAGMA journal_mode").get() as { journal_mode?: string } | null;
        expect(journalMode?.journal_mode).toBe("wal");

        const foreignKeys = standaloneDb.query("PRAGMA foreign_keys").get() as { foreign_keys?: number } | null;
        expect(foreignKeys?.foreign_keys).toBe(1);

        const busyTimeout = standaloneDb.query("PRAGMA busy_timeout").get() as { timeout?: number } | null;
        expect(busyTimeout?.timeout).toBeGreaterThan(0);
      } finally {
        standaloneDb.close();
      }
    });
  });
});
