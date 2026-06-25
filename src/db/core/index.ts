/**
 * 数据库核心模块 — 连接管理 + 迁移执行。
 *
 * 统一导出所有数据库核心 API。
 */
export { closeDb, getDb, getDbPath, getRawDb, initDb, resetDb, type DrizzleDb } from "./connection";
export { runMigrations } from "./migrations";
