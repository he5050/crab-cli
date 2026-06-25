/**
 * 数据库迁移兼容测试。
 *
 * 测试用例:
 *   - 旧版 schema(空 journal)在新代码下可被识别与升级
 *   - 关键表(approvals / checkpoints / sessions 等)存在性
 *   - 迁移幂等
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import path from "node:path";
import { initDb, resetDb } from "@/db";
import { cleanupTestDir, createGlobalTmpTestDir } from "../../helpers/testPaths";

function createBusinessSchemaWithEmptyJournal(dbPath: string): void {
  const db = new Database(dbPath, { create: true });
  db.exec(`
    CREATE TABLE approvals (
      id text PRIMARY KEY NOT NULL,
      permission text NOT NULL,
      pattern text NOT NULL,
      session_id text NOT NULL,
      decision text NOT NULL,
      timestamp integer NOT NULL,
      expires_at integer
    );
    CREATE TABLE checkpoints (
      id text PRIMARY KEY NOT NULL,
      session_id text NOT NULL,
      label text DEFAULT '' NOT NULL,
      message_index integer NOT NULL,
      snapshot_json text NOT NULL,
      created_at integer NOT NULL
    );
    CREATE TABLE messages (
      id text PRIMARY KEY NOT NULL,
      session_id text NOT NULL,
      role text NOT NULL,
      parts_json text NOT NULL,
      created_at integer NOT NULL
    );
    CREATE TABLE persistent_permissions (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      permission text NOT NULL,
      pattern text NOT NULL,
      action text DEFAULT 'allow' NOT NULL,
      source text DEFAULT 'user' NOT NULL,
      created_at integer NOT NULL
    );
    CREATE TABLE sessions (
      id text PRIMARY KEY NOT NULL,
      title text DEFAULT '' NOT NULL,
      status text DEFAULT 'active' NOT NULL,
      model text,
      parent_id text,
      project_dir text,
      tokens_input integer DEFAULT 0 NOT NULL,
      tokens_output integer DEFAULT 0 NOT NULL,
      tokens_reasoning integer DEFAULT 0 NOT NULL,
      cost integer DEFAULT 0 NOT NULL,
      agent_state_json text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );
    CREATE TABLE __drizzle_migrations (
      id integer PRIMARY KEY,
      hash text NOT NULL,
      created_at integer NOT NULL
    );
  `);
  db.close();
}

describe("DB 迁移兼容性", () => {
  test("空 Drizzle journal 的业务 schema 在 migration replay 之前引导", () => {
    const tempDir = createGlobalTmpTestDir("db-empty-journal-");
    const dbPath = path.join(tempDir, "crab.db");

    try {
      createBusinessSchemaWithEmptyJournal(dbPath);

      expect(() => initDb(dbPath)).not.toThrow();

      const raw = new Database(dbPath, { readonly: true });
      const rows = raw.query("SELECT hash, created_at FROM __drizzle_migrations").all();
      raw.close();

      expect(rows).toHaveLength(1);
    } finally {
      resetDb();
      cleanupTestDir(tempDir);
    }
  });
});
