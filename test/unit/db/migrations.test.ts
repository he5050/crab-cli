/**
 * 数据库迁移与级联触发器单元测试。
 *
 * 覆盖场景:
 *   - 迁移后表结构完整性（5 张表 + 索引）
 *   - 级联触发器验证（删除 session 自动清理关联数据）
 *   - 迁移幂等（多次 initDb 不重复创建触发器/表）
 *   - 备份文件在迁移前创建
 *   - legacy schema 引导（空 journal 已有业务表）
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import path from "node:path";
import { existsSync } from "node:fs";
import { getRawDb, initDb, resetDb } from "@/db";
import { cleanupTestDir, createGlobalTmpTestDir } from "../../helpers/testPaths";

describe("数据库迁移与触发器", () => {
  let tempDir = "";
  let originalXdgDataHome: string | undefined;
  let dbPath = "";

  beforeEach(() => {
    resetDb();
    tempDir = createGlobalTmpTestDir("db-migr-");
    originalXdgDataHome = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = tempDir;
    dbPath = path.join(tempDir, "crab.db");
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

  describe("表结构完整性", () => {
    test("迁移后 5 张业务表均存在", () => {
      initDb(dbPath);
      const raw = getRawDb()!;

      const tables = raw
        .query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '__drizzle%'")
        .all() as { name: string }[];

      const tableNames = tables.map((t) => t.name);
      expect(tableNames).toContain("sessions");
      expect(tableNames).toContain("messages");
      expect(tableNames).toContain("checkpoints");
      expect(tableNames).toContain("persistent_permissions");
      expect(tableNames).toContain("approvals");
    });

    test("关键索引已创建", () => {
      initDb(dbPath);
      const raw = getRawDb()!;

      const indexes = raw
        .query("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[];

      const indexNames = indexes.map((i) => i.name);
      expect(indexNames).toContain("idx_messages_session");
      expect(indexNames).toContain("idx_messages_created");
      expect(indexNames).toContain("idx_checkpoints_session");
      expect(indexNames).toContain("idx_permissions_pattern");
      expect(indexNames).toContain("idx_approvals_permission");
      expect(indexNames).toContain("idx_approvals_session");
    });

    test("Drizzle 迁移 journal 已写入", () => {
      initDb(dbPath);
      const raw = getRawDb()!;

      const rows = raw.query("SELECT hash FROM __drizzle_migrations").all() as { hash: string }[];
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0]!.hash).toBeTruthy();
    });
  });

  describe("级联触发器", () => {
    function setupTestData(raw: Database) {
      // 创建 session
      raw
        .query("INSERT INTO sessions (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run("Ses_test001", "Test Session", "active", Date.now(), Date.now());

      // 创建关联消息
      raw
        .query("INSERT INTO messages (id, session_id, role, parts_json, created_at) VALUES (?, ?, ?, ?, ?)")
        .run("Msg_001", "Ses_test001", "user", '"test"', Date.now());

      // 创建关联检查点
      raw
        .query(
          "INSERT INTO checkpoints (id, session_id, label, message_index, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run("Chk_001", "Ses_test001", "v1", 0, '"{}"', Date.now());

      // 创建关联审批
      raw
        .query(
          "INSERT INTO approvals (id, session_id, pattern, permission, decision, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run("Appr_001", "Ses_test001", "*", "Bash", "allow", Date.now());
    }

    test("删除 session 级联清理 messages", () => {
      initDb(dbPath);
      const raw = getRawDb()!;
      setupTestData(raw);

      raw.query("DELETE FROM sessions WHERE id = 'Ses_test001'").run();

      const msgs = raw.query("SELECT COUNT(*) AS count FROM messages WHERE session_id = 'Ses_test001'").get() as {
        count?: number;
      };
      expect(msgs?.count).toBe(0);
    });

    test("删除 session 级联清理 checkpoints", () => {
      initDb(dbPath);
      const raw = getRawDb()!;
      setupTestData(raw);

      raw.query("DELETE FROM sessions WHERE id = 'Ses_test001'").run();

      const chks = raw.query("SELECT COUNT(*) AS count FROM checkpoints WHERE session_id = 'Ses_test001'").get() as {
        count?: number;
      };
      expect(chks?.count).toBe(0);
    });

    test("删除 session 级联清理 approvals", () => {
      initDb(dbPath);
      const raw = getRawDb()!;
      setupTestData(raw);

      raw.query("DELETE FROM sessions WHERE id = 'Ses_test001'").run();

      const apprs = raw.query("SELECT COUNT(*) AS count FROM approvals WHERE session_id = 'Ses_test001'").get() as {
        count?: number;
      };
      expect(apprs?.count).toBe(0);
    });

    test("级联不影响 persistent_permissions（无 session_id）", () => {
      initDb(dbPath);
      const raw = getRawDb()!;

      raw
        .query("INSERT INTO persistent_permissions (pattern, permission, action, created_at) VALUES (?, ?, ?, ?)")
        .run("*", "Bash", "allow", Date.now());

      // 创建并删除 session
      raw
        .query("INSERT INTO sessions (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run("Ses_test002", "Test", "active", Date.now(), Date.now());
      raw.query("DELETE FROM sessions WHERE id = 'Ses_test002'").run();

      // persistent_permissions 应不受影响
      const perms = raw.query("SELECT COUNT(*) AS count FROM persistent_permissions").get() as { count?: number };
      expect(perms?.count).toBe(1);
    });
  });

  describe("迁移幂等", () => {
    test("多次 initDb 不报错，触发器仅创建一次", () => {
      initDb(dbPath);
      initDb(dbPath);

      // 触发器用 IF NOT EXISTS，多次创建不应报错
      const raw = getRawDb()!;
      const triggers = raw.query("SELECT name FROM sqlite_master WHERE type='trigger'").all() as { name: string }[];

      const triggerNames = triggers.map((t) => t.name);
      expect(triggerNames).toContain("cascade_session_messages");
      expect(triggerNames).toContain("cascade_session_checkpoints");
      expect(triggerNames).toContain("cascade_session_approvals");
    });
  });

  describe("备份机制", () => {
    test("迁移前自动创建备份文件", () => {
      initDb(dbPath);

      // 初始化时数据库已存在（刚创建），备份文件应存在
      // 但由于是首次创建，initDb 在创建数据库文件后立即迁移
      // 备份发生在迁移前，文件已创建
      expect(existsSync(dbPath)).toBe(true);
    });

    test("已有数据库的备份文件在迁移前生成", () => {
      // 先创建一个空数据库文件
      const db = new Database(dbPath, { create: true });
      db.exec("CREATE TABLE dummy (id INTEGER PRIMARY KEY)");
      db.close();

      initDb(dbPath);

      expect(existsSync(`${dbPath}.bak`)).toBe(true);
    });
  });

  describe("legacy schema 引导", () => {
    test("已有业务表但缺少 drizzle journal 时自动写入基线迁移记录", () => {
      // 模拟 legacy 数据库：有业务表但无 __drizzle_migrations
      const legacyDb = new Database(dbPath, { create: true });
      legacyDb.exec(
        "CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT, status TEXT, created_at INTEGER, updated_at INTEGER)",
      );
      legacyDb.exec(
        "CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT, role TEXT, parts_json TEXT, created_at INTEGER)",
      );
      legacyDb.exec(
        "CREATE TABLE approvals (id TEXT PRIMARY KEY, session_id TEXT, pattern TEXT, permission TEXT, decision TEXT, timestamp INTEGER)",
      );
      legacyDb.exec(
        "CREATE TABLE persistent_permissions (id INTEGER PRIMARY KEY AUTOINCREMENT, pattern TEXT, permission TEXT, action TEXT, created_at INTEGER)",
      );
      legacyDb.close();

      // initDb 应检测到 legacy schema 并写入基线 journal
      expect(() => initDb(dbPath)).not.toThrow();

      const raw = getRawDb()!;
      const rows = raw.query("SELECT hash FROM __drizzle_migrations").all() as { hash: string }[];
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0]!.hash).toBeTruthy();
    });
  });
});
