/**
 * 持久化权限管理 — 权限规则写入数据库。
 *
 * 职责:
 *   - 管理"始终允许"规则的持久化存储
 *   - 提供权限规则的加载和清理功能
 *   - 与 PermissionManager 配合使用
 *
 * 模块功能:
 *   - addPersistentPermission:添加持久化权限规则
 *   - loadPersistentPermissions:加载所有持久化权限规则
 *   - findPersistentPermission:查询匹配的持久化规则
 *   - removePersistentPermission:删除单条持久化规则
 *   - clearPersistentPermissions:清除所有持久化规则
 *
 * 使用场景:
 *   - 应用启动时加载持久化权限规则
 *   - 用户设置"始终允许"规则时保存
 *   - 权限评估时快速查找规则
 *
 * 边界:
 *   1. 仅数据库操作，不涉及权限评估逻辑
 *   2. 同一 permission + pattern 不重复写入(幂等)
 *   3. 支持 allow/deny 两种动作
 *   4. 支持 user/default/project 三种来源
 *
 * 流程:
 *   1. 应用启动时调用 loadPersistentPermissions 加载规则
 *   2. 用户设置规则时调用 addPersistentPermission 保存
 *   3. 权限评估时调用 findPersistentPermission 查询
 *   4. 需要清理时调用 removePersistentPermission 或 clearPersistentPermissions
 */
import { and, eq, getDb } from "@/db";
import { persistentPermissions } from "@/db/schema";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("permission:persistent");
type SQLiteRunResult = { changes?: number } | undefined;

/** 持久化权限规则 */
export interface PersistentPermission {
  id: number;
  permission: string;
  pattern: string;
  action: "allow" | "deny";
  source: "user" | "default" | "project";
  createdAt: number;
}

/**
 * 添加持久化权限规则。
 * 同一 permission + pattern 不重复写入(幂等)。
 */
export function addPersistentPermission(
  permission: string,
  pattern: string,
  action: "allow" | "deny" = "allow",
  source: "user" | "default" | "project" = "user",
): void {
  const db = getDb();

  // 检查是否已存在
  const existing = db
    .select()
    .from(persistentPermissions)
    .where(and(eq(persistentPermissions.permission, permission), eq(persistentPermissions.pattern, pattern)))
    .all();

  if (existing.length > 0) {
    // 已存在 → 更新 action
    db.update(persistentPermissions)
      .set({ action, createdAt: Date.now(), source })
      .where(and(eq(persistentPermissions.permission, permission), eq(persistentPermissions.pattern, pattern)))
      .run();
    log.debug(`持久化规则已更新: ${permission} ${pattern} → ${action}`);
    return;
  }

  db.insert(persistentPermissions)
    .values({
      action,
      createdAt: Date.now(),
      pattern,
      permission,
      source,
    })
    .run();

  log.info(`持久化规则已添加: ${permission} ${pattern} → ${action}`);
}

/**
 * 加载所有持久化权限规则。
 * 应用启动时调用，将规则注入 PermissionManager。
 */
export function loadPersistentPermissions(): PersistentPermission[] {
  const db = getDb();
  const rows = db.select().from(persistentPermissions).all();

  log.info(`已加载 ${rows.length} 条持久化权限规则`);
  return rows as PersistentPermission[];
}

/**
 * 查询匹配的持久化规则。
 * 用于权限评估时快速查找。
 */
export function findPersistentPermission(permission: string, pattern: string): PersistentPermission | null {
  const db = getDb();
  const rows = db
    .select()
    .from(persistentPermissions)
    .where(and(eq(persistentPermissions.permission, permission), eq(persistentPermissions.pattern, pattern)))
    .all();

  return (rows[0] as PersistentPermission) ?? null;
}

/**
 * 删除单条持久化规则。
 */
export function removePersistentPermission(id: number): boolean {
  const db = getDb();
  const result = db.delete(persistentPermissions).where(eq(persistentPermissions.id, id)).run() as SQLiteRunResult;
  return (result?.changes ?? 0) > 0;
}

/**
 * 清除所有持久化规则。
 */
export function clearPersistentPermissions(): number {
  const db = getDb();
  const result = db.delete(persistentPermissions).run() as SQLiteRunResult;
  const count = result?.changes ?? 0;
  log.info(`已清除 ${count} 条持久化权限规则`);
  return count;
}
