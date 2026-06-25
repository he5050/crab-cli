/**
 * ApprovalStore — 审批结果持久化存储
 *
 * 职责:
 *   - 存储工具调用的审批结果
 *   - 提供审批记录的 CRUD 操作
 *   - 支持审批记录的过期检查
 *   - 提供会话级隔离
 *
 * 模块功能:
 *   - saveApproval: 保存审批记录
 *   - getApproval: 获取单条审批记录
 *   - deleteApproval: 删除审批记录
 *   - getAllApprovals: 获取所有审批记录
 *   - cleanExpired: 清理过期审批记录
 *
 * 使用场景:
 *   - 工具调用权限审批
 *   - 审批结果持久化
 *   - 历史审批记录查询
 *
 * 边界:
 * 1. 使用统一的 crab.db 数据库存储
 * 2. 支持审批记录的过期机制
 * 3. 会话级隔离确保审批记录不被滥用
 *
 * 流程:
 * 1. 暂无(这是数据存储模块，无特定执行流程)
 */
import { and, eq, getDb, sql } from "@/db";
import { approvals } from "@/db/schema";
import { createLogger } from "@/core/logging/logger";
import { uuid } from "@/core/id";
import { wildcardMatch } from "../core/wildcard";
import type { IApprovalRepository, ApprovalRecord } from "./types";

const log = createLogger("permission:approval-store");
type SQLiteRunResult = { changes?: number } | undefined;

/** 安全地将数据库行转为 ApprovalRecord */
function rowToApprovalRecord(row: Record<string, unknown>): ApprovalRecord {
  return {
    decision: row.decision as "allow" | "deny",
    expiresAt: (row.expiresAt as number | null) ?? null,
    id: row.id as string,
    pattern: row.pattern as string,
    permission: row.permission as string,
    sessionId: row.sessionId as string,
    timestamp: row.timestamp as number,
  };
}

/** 审批存储接口（从 types.ts 重导出，保持向后兼容） */
export type { IApprovalRepository, ApprovalRecord } from "./types";

/**
 * 保存审批结果。
 */
export function saveApproval(record: Omit<ApprovalRecord, "id">): void {
  const db = getDb();
  const id = uuid();
  db.insert(approvals)
    .values({
      decision: record.decision,
      expiresAt: record.expiresAt,
      id,
      pattern: record.pattern,
      permission: record.permission,
      sessionId: record.sessionId,
      timestamp: record.timestamp,
    })
    .run();
  log.debug(`审批结果已保存: ${record.permission} ${record.pattern} → ${record.decision}`);
}

/**
 * 查询审批结果(按 permission + pattern 精确匹配)。
 * 返回未过期的最新记录。
 */
export function getApproval(permission: string, pattern: string): ApprovalRecord | null {
  const db = getDb();
  const now = Date.now();
  const rows = db
    .select()
    .from(approvals)
    .where(
      and(
        eq(approvals.permission, permission),
        eq(approvals.pattern, pattern),
        sql`(expires_at IS NULL OR expires_at > ${now})`,
      ),
    )
    .all();

  if (!rows.length) {
    return null;
  }

  const row = [...(rows as unknown[])]
    .map((raw) => raw as Record<string, unknown>)
    .toSorted((a, b) => Number(b.timestamp ?? 0) - Number(a.timestamp ?? 0))[0];

  if (!row) {
    return null;
  }

  return rowToApprovalRecord(row);
}

/**
 * 按 ID 删除审批记录。
 */
export function deleteApproval(id: string): void {
  const db = getDb();
  db.delete(approvals).where(eq(approvals.id, id)).run();
  log.debug(`审批记录已删除: ${id}`);
}

/**
 * 清除所有审批记录。
 */
export function clearAllApprovals(): void {
  const db = getDb();
  db.delete(approvals).run();
  log.info("所有审批记录已清除");
}

/**
 * 获取所有审批记录(可选按会话过滤)。
 */
export function getAllApprovals(sessionId?: string): ApprovalRecord[] {
  const db = getDb();
  const rows = sessionId
    ? db.select().from(approvals).where(eq(approvals.sessionId, sessionId)).all()
    : db.select().from(approvals).all();

  return (rows as unknown[])
    .map((raw) => rowToApprovalRecord(raw as Record<string, unknown>))
    .toSorted((a, b) => b.timestamp - a.timestamp);
}

/**
 * 清理过期记录。
 * @returns 清理的记录数
 */
export function cleanExpired(): number {
  const db = getDb();
  const now = Date.now();
  const result = db
    .delete(approvals)
    .where(sql`expires_at IS NOT NULL AND expires_at <= ${now}`)
    .run() as SQLiteRunResult;
  const cleaned = result?.changes ?? 0;
  if (cleaned > 0) {
    log.info(`已清理 ${cleaned} 条过期审批记录`);
  }
  return cleaned;
}

/**
 * 通配符匹配查找审批记录。
 * 查询同一 permission 下的所有未过期审批记录，
 * 使用 wildcardMatch 找到与 pattern 匹配的最新记录。
 */
export function findApproval(permission: string, pattern: string): ApprovalRecord | null {
  const db = getDb();
  const now = Date.now();
  const rows = db
    .select()
    .from(approvals)
    .where(and(eq(approvals.permission, permission), sql`(expires_at IS NULL OR expires_at > ${now})`))
    .all();

  if (!rows.length) return null;

  const records = (rows as unknown[])
    .map((raw) => rowToApprovalRecord(raw as Record<string, unknown>))
    .filter((record) => wildcardMatch(record.pattern, pattern))
    .toSorted((a, b) => b.timestamp - a.timestamp);

  return records[0] ?? null;
}

/** 创建 SQLite 审批存储 */
export function createSqliteApprovalRepository(): IApprovalRepository {
  return {
    saveApproval,
    getApproval,
    findApproval,
    deleteApproval,
    getAllApprovals,
    clearAllApprovals,
    cleanExpired,
  };
}
