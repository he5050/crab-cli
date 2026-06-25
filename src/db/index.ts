/**
 * 数据库管理器 — bun:sqlite + Drizzle ORM 初始化与连接管理。
 *
 * 职责:
 *   - 数据库文件初始化
 *   - 表迁移管理(Drizzle Kit 迁移)
 *   - 连接管理
 *   - Drizzle ORM 实例提供
 *
 * 边界:
 *   1. 仅管理数据库连接和 Schema，不涉及业务逻辑
 *   2. 数据库文件位于 ~/.crab/crab.db
 *   3. 使用 WAL 模式提升并发性能
 *   4. Schema 单源定义在 schema.ts，迁移由 Drizzle Kit 管理
 */
export { closeDb, getDb, getDbPath, getRawDb, initDb, resetDb, runMigrations, type DrizzleDb } from "@/db/core";

// 重导出 Drizzle 操作符，方便使用
export { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
