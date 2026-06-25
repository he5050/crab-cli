/**
 * 数据库连接管理 — SQLite 单例、WAL 模式、Drizzle ORM 实例化。
 *
 * 职责:
 *   - 数据库文件路径管理
 *   - SQLite 连接单例(懒初始化)
 *   - WAL 模式配置
 *   - Drizzle ORM 实例封装
 *
 * 边界:
 *   1. 仅管理连接生命周期，不涉及迁移逻辑
 *   2. 数据库文件位于 ~/.crab/crab.db
 *   3. 使用全局单例模式，支持热重载复用
 */
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "@/db/schema";
import { getDataDir, SQLITE_BUSY_TIMEOUT_MS } from "@/config";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "@/core/logging/logger";
import { dbState } from "./state";
import { runMigrations } from "./migrations";

const log = createLogger("db");

/** Drizzle ORM 实例类型 */
export type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

/**
 * 对 SQLite 连接应用标准 PRAGMA 配置。
 *
 * - WAL 模式: 提升并发读写性能
 * - synchronous = NORMAL: WAL 模式下安全且更快(比 FULL 减少 fsync)
 * - foreign_keys = ON: 外键约束保证引用完整性
 * - busy_timeout: 避免写锁死锁(默认 5000ms)
 * - cache_size = -64000: 64MB 页缓存(负值=KB)，提升读性能
 */
export function applyPragmas(db: Database): void {
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
  db.exec("PRAGMA cache_size = -64000");
}

/**
 * 获取数据库文件路径。
 */
export function getDbPath(): string {
  if (dbState.dbPath) {
    return dbState.dbPath;
  }
  return join(getDataDir(), "crab.db");
}

/**
 * 初始化数据库连接。
 * 如果已初始化则复用现有连接。
 */
export function initDb(dbPath?: string): DrizzleDb {
  if (dbState.drizzle && !dbPath) {
    return dbState.drizzle;
  }
  if (dbState.drizzle && dbPath && dbState.dbPath === dbPath) {
    return dbState.drizzle;
  }

  dbState.dbPath = dbPath ?? join(getDataDir(), "crab.db");
  const dir = join(dbState.dbPath, "..");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  dbState.db = new Database(dbState.dbPath, { create: true });
  applyPragmas(dbState.db);

  dbState.drizzle = drizzle(dbState.db, { schema });

  // 自动运行迁移
  runMigrations();

  log.info(`数据库已初始化: ${dbState.dbPath}`);
  return dbState.drizzle;
}

/**
 * 获取 Drizzle 实例(必须先调用 initDb)。
 */
export function getDb(): DrizzleDb {
  if (!dbState.drizzle) {
    return initDb();
  }
  return dbState.drizzle;
}

/**
 * 获取原始 SQLite 实例(用于特殊查询)。
 */
export function getRawDb(): Database | null {
  return dbState.db;
}

/**
 * 关闭数据库连接。
 */
export function closeDb(): void {
  if (dbState.db) {
    dbState.db.close();
    dbState.db = null;
    dbState.drizzle = null;
    log.info("数据库连接已关闭");
  }
}

/**
 * 重置数据库(仅用于测试)。
 */
export function resetDb(): void {
  closeDb();
  dbState.dbPath = "";
}
