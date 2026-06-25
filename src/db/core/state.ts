/**
 * 数据库单例状态 — 全局唯一真实来源。
 *
 * connection.ts 和 migrations.ts 共同引用此文件，
 * 避免单例状态在两个文件中重复定义导致分裂。
 */
import type { Database } from "bun:sqlite";
import type { DrizzleDb } from "@/db/core/connection";

export interface DbSingletonState {
  db: Database | null;
  /** Drizzle ORM 实例 */
  drizzle: DrizzleDb | null;
  dbPath: string;
}

const DB_SINGLETON_KEY = "__crab_db_singleton__";
const globalState = globalThis as typeof globalThis & {
  [DB_SINGLETON_KEY]?: DbSingletonState;
};

/** 数据库单例状态 — 跨模块共享的唯一实例 */
export const dbState: DbSingletonState = globalState[DB_SINGLETON_KEY] ?? {
  db: null,
  dbPath: "",
  drizzle: null,
};
globalState[DB_SINGLETON_KEY] = dbState;
