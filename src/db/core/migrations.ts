/**
 * 数据库迁移管理 — Drizzle Kit 迁移、备份恢复、级联触发器。
 *
 * 职责:
 *   - 执行 Drizzle Kit 生成的迁移脚本
 *   - 迁移前自动备份数据库
 *   - 迁移失败时从备份恢复
 *   - 创建级联删除触发器
 *   - 兼容 legacy 数据库的迁移 journal 引导
 *
 * 边界:
 *   1. 仅管理迁移执行，不生成迁移脚本(Drizzle Kit 负责)
 *   2. 备份文件保留在磁盘上，支持手动回滚
 *   3. 级联触发器仅针对 sessions 表的关联数据
 */
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "@/db/schema";
import { copyFileSync, existsSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "@/core/logging/logger";
import { applyPragmas } from "./connection";
import { dbState } from "./state";

const log = createLogger("db:migrations");

function hasDrizzleJournal(dir: string): boolean {
  return existsSync(join(dir, "meta", "_journal.json"));
}

/** 迁移文件目录 — 兼容源码运行、dist bundle 和编译后的 release artifact。 */
function resolveMigrationsDir(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(moduleDir, "..", "migrations"),
    join(moduleDir, "db", "migrations"),
    join(dirname(process.execPath), "db", "migrations"),
  ];

  return candidates.find(hasDrizzleJournal) ?? candidates[0]!;
}

const MIGRATIONS_DIR = resolveMigrationsDir();
const INITIAL_MIGRATION_HASH = "07f6070570407b5e1d3d6c6ed07e0174562582f05541af92c19413fc1a5753da";
const INITIAL_MIGRATION_CREATED_AT = 1_780_465_990_200;

const BACKUP_SUFFIX = ".bak";
const WAL_SUFFIX = "-wal";
const SHM_SUFFIX = "-shm";

function getBackupPath(dbPath: string): string {
  return dbPath + BACKUP_SUFFIX;
}

/**
 * 运行数据库迁移 — Drizzle Kit 管理的 Schema 单源迁移。
 *
 * 迁移前自动备份 crab.db → crab.db.bak，迁移失败时从备份恢复。
 * 备份保留在磁盘上，支持手动回滚。
 */
export function runMigrations(): void {
  const { dbPath } = dbState;
  if (!dbPath) {
    return;
  }

  const backupPath = getBackupPath(dbPath);

  try {
    dbState.db?.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch {
    /* Non-fatal */
  }

  try {
    if (existsSync(dbPath)) {
      copyFileSync(dbPath, backupPath);
    }
  } catch (error) {
    log.warn("数据库备份失败，跳过回滚能力", { error: String(error) });
  }

  try {
    runDrizzleMigrations();
  } catch (error) {
    log.error("迁移失败，正在从备份恢复...");
    try {
      restoreFromBackup(dbPath, backupPath);
    } catch (restoreError) {
      log.error("从备份恢复失败，数据库可能已损坏", { error: String(restoreError) });
    }
    throw error;
  }
}

function restoreFromBackup(dbPath: string, backupPath: string): void {
  if (dbState.db) {
    dbState.db.close();
    dbState.db = null;
    dbState.drizzle = null;
  }

  for (const suffix of [WAL_SUFFIX, SHM_SUFFIX]) {
    try {
      unlinkSync(dbPath + suffix);
    } catch {
      /* Ignore */
    }
  }

  if (existsSync(backupPath)) {
    copyFileSync(backupPath, dbPath);
    log.info(`已从备份恢复: ${backupPath}`);
  }

  dbState.db = new Database(dbPath, { create: true });
  applyPragmas(dbState.db);
  dbState.drizzle = drizzle(dbState.db, { schema });
}

/** Drizzle Kit 迁移 */
function runDrizzleMigrations(): void {
  try {
    if (!dbState.db || !dbState.drizzle) {
      return;
    }
    bootstrapLegacyDrizzleJournal(dbState.db);
    migrate(dbState.drizzle, { migrationsFolder: MIGRATIONS_DIR });
    ensureCascadeTriggers(dbState.db);
    ensureDurableEventsTable(dbState.db);
    ensurePartsTable(dbState.db);
    log.debug("Drizzle Kit 迁移完成");
  } catch (error) {
    log.error("Drizzle Kit 迁移失败", { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

function tableExists(db: Database, tableName: string): boolean {
  const row = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(tableName) as {
    name?: string;
  } | null;
  return Boolean(row?.name);
}

function bootstrapLegacyDrizzleJournal(db: Database): void {
  const hasBusinessSchema =
    tableExists(db, "sessions") &&
    tableExists(db, "messages") &&
    tableExists(db, "approvals") &&
    tableExists(db, "persistent_permissions");

  if (!hasBusinessSchema) {
    return;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    );
  `);

  const existing = db.query("SELECT COUNT(*) AS count FROM __drizzle_migrations").get() as { count?: number } | null;
  if ((existing?.count ?? 0) > 0) {
    return;
  }

  db.query("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)").run(
    INITIAL_MIGRATION_HASH,
    INITIAL_MIGRATION_CREATED_AT,
  );
  log.warn("检测到 legacy 数据库表但缺少 Drizzle journal，已写入基线迁移记录");
}

function ensureCascadeTriggers(db: Database): void {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS cascade_session_messages
    AFTER DELETE ON sessions
    BEGIN
      DELETE FROM messages WHERE session_id = OLD.id;
    END;
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS cascade_session_checkpoints
    AFTER DELETE ON sessions
    BEGIN
      DELETE FROM checkpoints WHERE session_id = OLD.id;
    END;
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS cascade_session_approvals
    AFTER DELETE ON sessions
    BEGIN
      DELETE FROM approvals WHERE session_id = OLD.id;
    END;
  `);
}

/**
 * 确保 durable_events 表存在(运行时安全保障)。
 *
 * 即使 Drizzle 迁移因 journal 不一致而跳过，此函数也能保证表结构可用。
 * 同时创建聚合根 ID + seq 的复合索引，用于高效回放。
 */
function ensureDurableEventsTable(db: Database): void {
  if (tableExists(db, "durable_events")) {
    return;
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS durable_events (
      id TEXT PRIMARY KEY NOT NULL,
      seq INTEGER NOT NULL,
      aggregate_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      definition TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_durable_events_aggregate ON durable_events (aggregate_id, seq);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_durable_events_seq ON durable_events (seq);`);
  log.info("已创建 durable_events 表(运行时保障)");
}

/**
 * 确保 parts 表存在(运行时安全保障 — P2-A4)。
 *
 * 即使 Drizzle 迁移因 journal 不一致而跳过，此函数也能保证 parts 表结构可用。
 * 同时创建 session_id + message_id 的复合索引，用于高效查询。
 */
function ensurePartsTable(db: Database): void {
  if (tableExists(db, "parts")) {
    return;
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS parts (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      type TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_parts_session_message ON parts (session_id, message_id);`);
  log.info("已创建 parts 表(运行时保障 — P2-A4)");
}
