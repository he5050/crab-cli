/**
 * 检查点管理 — 会话快照创建和恢复。
 *
 * 职责:
 *   - 创建检查点
 *   - 恢复到检查点
 *   - 管理检查点列表
 *   - 比较检查点差异
 *   - 清理旧检查点
 *
 * 模块功能:
 *   - createCheckpoint: 创建检查点
 *   - restoreCheckpoint: 恢复检查点
 *   - listCheckpoints: 列总会话检查点
 *   - deleteCheckpoint: 删除检查点
 *   - updateCheckpointLabel: 更新检查点标签
 *   - getCheckpoint: 获取检查点
 *   - compareCheckpoints: 比较检查点
 *   - cleanupOldCheckpoints: 清理旧检查点
 *   - getCheckpointStats: 获取检查点统计
 *   - CheckpointRecord: 检查点记录类型
 *
 * 使用场景:
 *   - 保存会话状态快照
 *   - 回滚到历史状态
 *   - 管理会话检查点
 *   - 比较不同版本差异
 *
 * 边界:
 *   1. 仅数据库操作，不涉及 AI 对话流程
 *   2. 检查点保存消息快照
 *   3. 恢复时删除当前消息并恢复快照
 *   4. 支持检查点标签管理
 *
 * 流程:
 *   1. 调用 createCheckpoint 创建快照
 *   2. 使用 listCheckpoints 查看检查点
 *   3. 调用 restoreCheckpoint 恢复状态
 *   4. 使用 deleteCheckpoint 删除检查点
 */
import { desc, eq, getDb, inArray } from "@/db";
import { checkpoints } from "@/db/schema";
import { createId } from "@/core/identity";
import { createLogger } from "@/core/logging/logger";
import { SessionError } from "@/core/errors/appError";
import { type MessageRecord, addMessage, deleteSessionMessages, getSessionMessages } from "./message";
import { getSession } from "./session";
import { applyRollbackEntry, isInsideGitWorkTree, listRollbackEntriesForSessionSince } from "@/tool/rollback";

const log = createLogger("session:checkpoint");
type SQLiteRunResult = { changes?: number } | undefined;

/** 检查点记录 */
export interface CheckpointRecord {
  id: string;
  sessionId: string;
  label: string;
  messageIndex: number;
  snapshot: MessageRecord[];
  createdAt: number;
}

/**
 * 创建检查点。
 * 保存当前会话所有消息的快照。
 */
export function createCheckpoint(sessionId: string, label?: string): CheckpointRecord {
  const db = getDb();
  const id = createId("chk");
  const now = Date.now();
  const currentMessages = getSessionMessages(sessionId);

  const record = {
    createdAt: now,
    id,
    label: label ?? `检查点 ${now}`,
    messageIndex: currentMessages.length,
    sessionId,
    snapshotJson: JSON.stringify(currentMessages),
  };

  db.insert(checkpoints).values(record).run();

  log.info(`检查点已创建: ${id} (会话 ${sessionId}, ${currentMessages.length} 条消息)`);
  return {
    createdAt: now,
    id,
    label: record.label,
    messageIndex: currentMessages.length,
    sessionId,
    snapshot: currentMessages,
  };
}

/**
 * 恢复到检查点。
 * 将会话消息回滚到检查点时的状态。
 * 返回恢复后的消息列表。
 */
export function restoreCheckpoint(checkpointId: string): MessageRecord[] | null {
  const db = getDb();
  const rows = db.select().from(checkpoints).where(eq(checkpoints.id, checkpointId)).all();

  if (rows.length === 0) {
    log.warn(`检查点不存在: ${checkpointId}`);
    return null;
  }

  const row = rows[0] as {
    id: string;
    sessionId: string;
    label: string;
    messageIndex: number;
    snapshotJson: string;
    createdAt: number;
  };
  const snapshot = JSON.parse(row.snapshotJson) as MessageRecord[];

  // 先创建安全备份检查点，确保恢复失败时可手动恢复
  const backupId = createId("chk");
  try {
    db.insert(checkpoints)
      .values({
        createdAt: Date.now(),
        id: backupId,
        label: `自动备份(恢复前) - ${row.label}`,
        messageIndex: 0,
        sessionId: row.sessionId,
        snapshotJson: JSON.stringify(getSessionMessages(row.sessionId)),
      })
      .run();
  } catch (backupError) {
    log.warn(`创建恢复前备份失败，继续恢复: ${backupError}`);
  }

  try {
    db.transaction(() => {
      // 删除当前所有消息，然后恢复快照
      deleteSessionMessages(row.sessionId);
      for (const msg of snapshot) {
        addMessage(row.sessionId, msg.role, msg.parts);
      }
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error(`检查点恢复失败，备份检查点: ${backupId}`, {
      eventType: "checkpoint.restore.failed",
      payload: { backupCheckpointId: backupId, checkpointId, error: errorMsg, sessionId: row.sessionId },
      sessionId: row.sessionId,
    });
    throw new SessionError("SESSION-405", `检查点恢复失败: ${errorMsg}。备份检查点 ${backupId} 可用于手动恢复。`);
  }

  restoreFileMutationsForCheckpoint(row.sessionId, row.createdAt);

  log.info(`检查点已恢复: ${checkpointId} → 会话 ${row.sessionId}`);
  return snapshot;
}

function restoreFileMutationsForCheckpoint(sessionId: string, checkpointCreatedAt: number): void {
  const projectDir = getSession(sessionId)?.projectDir ?? process.cwd();
  if (isInsideGitWorkTree(projectDir)) {
    log.debug(`检测到 Git worktree，跳过 checkpoint 文件回滚: ${projectDir}`);
    return;
  }

  const entries = listRollbackEntriesForSessionSince(projectDir, sessionId, checkpointCreatedAt);
  for (const entry of entries) {
    const result = applyRollbackEntry(projectDir, entry.id);
    if (!result.ok) {
      log.warn(`checkpoint 文件回滚跳过: ${entry.filePath} (${result.status})`, {
        projectDir,
        rollbackId: entry.id,
        sessionId,
      });
    }
  }
}

/**
 * 列出会话的所有检查点。
 */
export function listCheckpoints(sessionId: string): CheckpointRecord[] {
  const db = getDb();
  const rows = db
    .select()
    .from(checkpoints)
    .where(eq(checkpoints.sessionId, sessionId))
    .orderBy(desc(checkpoints.createdAt), desc(checkpoints.id))
    .all();

  return (
    rows as {
      id: string;
      sessionId: string;
      label: string;
      messageIndex: number;
      snapshotJson: string;
      createdAt: number;
    }[]
  ).map((row) => ({
    createdAt: row.createdAt,
    id: row.id,
    label: row.label,
    messageIndex: row.messageIndex,
    sessionId: row.sessionId,
    snapshot: JSON.parse(row.snapshotJson) as MessageRecord[],
  }));
}

/**
 * 删除检查点。
 */
export function deleteCheckpoint(id: string): boolean {
  const db = getDb();
  const result = db.delete(checkpoints).where(eq(checkpoints.id, id)).run() as SQLiteRunResult;
  return (result?.changes ?? 0) > 0;
}

/**
 * 更新检查点标签。
 */
export function updateCheckpointLabel(id: string, label: string): boolean {
  const db = getDb();
  const result = db.update(checkpoints).set({ label }).where(eq(checkpoints.id, id)).run() as SQLiteRunResult;
  return (result?.changes ?? 0) > 0;
}

/**
 * 获取单个检查点详情。
 */
export function getCheckpoint(id: string): CheckpointRecord | null {
  const db = getDb();
  const rows = db.select().from(checkpoints).where(eq(checkpoints.id, id)).all();

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0] as {
    id: string;
    sessionId: string;
    label: string;
    messageIndex: number;
    snapshotJson: string;
    createdAt: number;
  };
  return {
    createdAt: row.createdAt,
    id: row.id,
    label: row.label,
    messageIndex: row.messageIndex,
    sessionId: row.sessionId,
    snapshot: JSON.parse(row.snapshotJson) as MessageRecord[],
  };
}

/**
 * 比较两个检查点的差异。
 * 返回新增、删除、修改的消息数量。
 */
export function compareCheckpoints(
  checkpointId1: string,
  checkpointId2: string,
): {
  added: number;
  removed: number;
  modified: number;
  total1: number;
  total2: number;
} | null {
  const cp1 = getCheckpoint(checkpointId1);
  const cp2 = getCheckpoint(checkpointId2);

  if (!cp1 || !cp2) {
    return null;
  }

  const snapshot1 = cp1.snapshot;
  const snapshot2 = cp2.snapshot;

  // 简单的比较逻辑(基于消息索引)
  const maxLen = Math.max(snapshot1.length, snapshot2.length);
  let added = 0;
  let removed = 0;
  let modified = 0;

  for (let i = 0; i < maxLen; i++) {
    const msg1 = snapshot1[i];
    const msg2 = snapshot2[i];

    if (!msg1 && msg2) {
      added++;
    } else if (msg1 && !msg2) {
      removed++;
    } else if (msg1 && msg2) {
      // 简单比较内容
      const content1 = JSON.stringify(msg1.parts);
      const content2 = JSON.stringify(msg2.parts);
      if (content1 !== content2) {
        modified++;
      }
    }
  }

  return {
    added,
    modified,
    removed,
    total1: snapshot1.length,
    total2: snapshot2.length,
  };
}

/**
 * 清理旧的检查点，只保留最近的 N 个。
 * 单条 SQL 批量删除，避免 N 次单条 DELETE + 避免解析 snapshot JSON。
 */
export function cleanupOldCheckpoints(sessionId: string, keepCount: number = 10): number {
  const allIds = listCheckpointIds(sessionId);
  if (allIds.length <= keepCount) {
    return 0;
  }

  // 跳过最近的 keepCount 个(按 createdAt desc 排序，索引 0..keepCount-1 是要保留的)
  const toDeleteIds = allIds.slice(keepCount);
  const result = getDb().delete(checkpoints).where(inArray(checkpoints.id, toDeleteIds)).run() as SQLiteRunResult;

  const deletedCount = result?.changes ?? 0;
  log.info(`清理旧检查点: ${sessionId} 删除了 ${deletedCount} 个，保留 ${keepCount} 个`);
  return deletedCount;
}

/**
 * 列出某会话的全部 checkpoint id(按 createdAt + id 降序)。
 * 轻量查询:仅取 id + createdAt，不解析 snapshot JSON。
 * 用于批量删除/保留的 ID 收集。
 */
function listCheckpointIds(sessionId: string): string[] {
  const rows = getDb()
    .select({ createdAt: checkpoints.createdAt, id: checkpoints.id })
    .from(checkpoints)
    .where(eq(checkpoints.sessionId, sessionId))
    .orderBy(desc(checkpoints.createdAt), desc(checkpoints.id))
    .all() as { id: string; createdAt: number }[];
  return rows.map((r) => r.id);
}

/**
 * 获取检查点统计信息。
 */
export function getCheckpointStats(sessionId: string): {
  total: number;
  oldest?: number;
  newest?: number;
  totalSize?: number;
} {
  const db = getDb();
  const rows = db.select().from(checkpoints).where(eq(checkpoints.sessionId, sessionId)).all();

  if (rows.length === 0) {
    return { total: 0 };
  }

  const timestamps = rows.map((r: { createdAt: number }) => r.createdAt);
  const sizes = rows.map((r: { snapshotJson: string }) => r.snapshotJson.length);

  return {
    newest: Math.max(...timestamps),
    oldest: Math.min(...timestamps),
    total: rows.length,
    totalSize: sizes.reduce((a: number, b: number) => a + b, 0),
  };
}
