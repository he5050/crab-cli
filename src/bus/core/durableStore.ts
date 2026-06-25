/**
 * Durable Event Store — 持久化事件存储。
 *
 * 职责:
 *   - 将事件写入 durable_events 表(含全局自增 seq)
 *   - 按 aggregateId 回放事件(支持增量回放 fromSeq)
 *   - 查询全局事件流(用于跨聚合事件溯源)
 *
 * 使用场景:
 *   - 会话恢复: 崩溃后从 durable events 重建会话状态
 *   - 事件溯源: 按顺序回放聚合事件重建状态
 *   - 审计追踪: 持久化关键事件用于事后分析
 *
 * 边界:
 *   1. 仅处理持久化读写，不涉及事件分发
 *   2. seq 为全局自增(跨所有聚合)，version 为聚合内版本号
 *   3. 依赖 @db 模块已初始化
 */
import { desc, eq, getDb, sql } from "@/db";
import { durableEvents } from "@/db/schema";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("bus:durable");

/** 持久化事件记录 */
export interface DurableEventRecord {
  id: string;
  seq: number;
  aggregateId: string;
  version: number;
  definition: string;
  data: unknown;
  createdAt: number;
}

/**
 * 将事件持久化到数据库。
 *
 * @param id - 事件唯一 ID
 * @param aggregateId - 聚合根 ID(如 sessionId)
 * @param version - 聚合内版本号
 * @param definition - 事件类型字符串
 * @param data - 事件载荷(将被 JSON 序列化)
 * @returns 写入的 seq 号；如果数据库未初始化则返回 -1
 */
export function persistEvent(
  id: string,
  aggregateId: string,
  version: number,
  definition: string,
  data: unknown,
): number {
  try {
    const db = getDb();
    const now = Date.now();
    // 使用 SQLite 自增 seq: 先插入 NULL 让 AUTOINCREMENT 生效
    // 但 durable_events.id 是主键，seq 不是 AUTOINCREMENT 列
    // 所以我们用 (SELECT COALESCE(MAX(seq), 0) + 1 FROM durable_events) 计算下一个 seq
    const result = db
      .insert(durableEvents)
      .values({
        aggregateId,
        createdAt: now,
        dataJson: JSON.stringify(data),
        definition,
        id,
        seq: sql`(SELECT COALESCE(MAX(${durableEvents.seq}), 0) + 1 FROM ${durableEvents})`,
        version,
      })
      .returning({ seq: durableEvents.seq })
      .get();
    return result?.seq ?? -1;
  } catch (error) {
    log.warn(`持久化事件失败: ${error instanceof Error ? error.message : String(error)}`);
    return -1;
  }
}

/**
 * 按 aggregateId 回放事件。
 *
 * @param aggregateId - 聚合根 ID
 * @param fromSeq - 从哪个 seq 开始回放(默认 0 = 全部)
 * @returns 事件列表(按 seq 升序)
 */
export function replayEvents(aggregateId: string, fromSeq = 0): DurableEventRecord[] {
  try {
    const db = getDb();
    const rows = db
      .select()
      .from(durableEvents)
      .where(
        fromSeq > 0
          ? sql`${durableEvents.aggregateId} = ${aggregateId} AND ${durableEvents.seq} > ${fromSeq}`
          : eq(durableEvents.aggregateId, aggregateId),
      )
      .orderBy(durableEvents.seq)
      .all();
    return rows.map((row) => ({
      aggregateId: row.aggregateId,
      createdAt: row.createdAt,
      data: JSON.parse(row.dataJson),
      definition: row.definition,
      id: row.id,
      seq: row.seq,
      version: row.version,
    }));
  } catch (error) {
    log.warn(`回放事件失败: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/**
 * 获取全局事件流(跨聚合，按 seq 降序)。
 *
 * @param limit - 返回条数(默认 100)
 * @returns 事件列表(按 seq 降序)
 */
export function getGlobalEventStream(limit = 100): DurableEventRecord[] {
  try {
    const db = getDb();
    const rows = db.select().from(durableEvents).orderBy(desc(durableEvents.seq)).limit(limit).all();
    return rows.map((row) => ({
      aggregateId: row.aggregateId,
      createdAt: row.createdAt,
      data: JSON.parse(row.dataJson),
      definition: row.definition,
      id: row.id,
      seq: row.seq,
      version: row.version,
    }));
  } catch (error) {
    log.warn(`获取全局事件流失败: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/**
 * 获取指定聚合根的最新 version。
 */
export function getLatestVersion(aggregateId: string): number {
  try {
    const db = getDb();
    const result = db
      .select({ maxVersion: sql<number>`MAX(${durableEvents.version})` })
      .from(durableEvents)
      .where(eq(durableEvents.aggregateId, aggregateId))
      .get();
    return result?.maxVersion ?? -1;
  } catch {
    return -1;
  }
}

/**
 * 删除指定聚合根的所有持久化事件。
 */
export function deleteEventsByAggregate(aggregateId: string): number {
  try {
    const db = getDb();
    const result = db.delete(durableEvents).where(eq(durableEvents.aggregateId, aggregateId)).run();
    return result.changes;
  } catch (error) {
    log.warn(`删除聚合事件失败: ${error instanceof Error ? error.message : String(error)}`);
    return 0;
  }
}
