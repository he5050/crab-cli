/**
 * 会话 Revert 系统 — 回滚到指定消息并支持恢复。
 *
 * 职责:
 *   - revertToMessage: 回滚到指定消息(删除后续消息 + 恢复文件)
 *   - unrevert: 恢复最近一次 revert
 *   - getRevertedCount: 获取已 revert 的消息数
 *
 * 模块功能:
 *   - revertToMessage(sessionId, messageIndex): 回滚到指定消息
 *   - unrevert(sessionId): 恢复最近一次 revert
 *   - getRevertedCount(sessionId): 获取已 revert 的消息数
 *   - getRevertState(sessionId): 获取 revert 状态
 *   - RevertState: revert 状态类型
 *
 * 使用场景:
 *   - 用户想回到之前的对话点重新提问
 *   - 撤销错误的工具调用导致的问题
 *   - 从特定消息点重新分支对话
 *
 * 边界:
 *   1. revert 会删除目标消息之后的所有消息
 *   2. 文件恢复依赖 Git(非 Git 仓库仅删除消息)
 *   3. unrevert 只能恢复最近一次 revert
 *   4. revert 前会保存当前状态用于 unrevert
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { eq, getDb } from "@/db";
import { messages as messagesTable } from "@/db/schema";
import { createLogger } from "@/core/logging/logger";
import { getSession } from "./session";
import { getSessionMessages, type MessageRecord } from "./message";
import { getSnapshot, type SnapshotData } from "./snapshot";
import { isInsideGitWorkTree } from "@/tool/rollback";

const log = createLogger("session:revert");

/** Revert 状态记录 */
interface RevertState {
  /** 被 revert 的消息列表(用于 unrevert 恢复) */
  revertedMessages: MessageRecord[];
  /** revert 前的文件快照(用于 unrevert 恢复文件) */
  beforeSnapshot: SnapshotData | null;
  /** revert 时间戳 */
  revertedAt: number;
  /** revert 到的消息索引 */
  targetIndex: number;
}

/** 会话 revert 状态存储: sessionId → RevertState */
const revertStore = new Map<string, RevertState>();

/**
 * 回滚到指定消息。
 * 删除该消息之后的所有消息，并尝试恢复文件变更。
 *
 * @param sessionId 会话 ID
 * @param messageIndex 目标消息索引(0-based，该索引及之前的消息保留)
 * @returns 成功返回 true，失败返回 false
 */
export function revertToMessage(sessionId: string, messageIndex: number): boolean {
  try {
    const allMessages = getSessionMessages(sessionId);
    if (messageIndex < 0 || messageIndex >= allMessages.length) {
      log.warn(`revert 失败: 消息索引 ${messageIndex} 超出范围(共 ${allMessages.length} 条消息)`);
      return false;
    }

    // 获取要删除的消息(目标索引之后的所有消息)
    const messagesToRemove = allMessages.slice(messageIndex + 1);
    if (messagesToRemove.length === 0) {
      log.debug(`revert: 消息索引 ${messageIndex} 之后无消息需要删除`);
      return true;
    }

    // 保存 revert 前的状态(用于 unrevert)
    const beforeSnapshot = getSnapshot(sessionId, "before");
    revertStore.set(sessionId, {
      beforeSnapshot,
      revertedAt: Date.now(),
      revertedMessages: messagesToRemove.map((m) => ({ ...m })),
      targetIndex: messageIndex,
    });

    // 尝试恢复文件变更(Git checkout)
    restoreFilesForRevert(sessionId);

    // 删除目标索引之后的所有消息
    const db = getDb();
    const messageIdsToRemove = messagesToRemove.map((m) => m.id);
    for (const msgId of messageIdsToRemove) {
      db.delete(messagesTable).where(eq(messagesTable.id, msgId)).run();
    }

    log.info(`revert 完成: 会话 ${sessionId} 回滚到消息 ${messageIndex}，删除了 ${messagesToRemove.length} 条消息`);
    return true;
  } catch (error) {
    log.error(`revert 失败: ${error instanceof Error ? error.message : String(error)}`, {
      eventType: "session.revert.failed",
      payload: { error: String(error), messageIndex, sessionId },
      sessionId,
    });
    return false;
  }
}

/**
 * 恢复最近一次 revert。
 * 将被 revert 的消息重新添加回会话，并恢复文件变更。
 *
 * @param sessionId 会话 ID
 * @returns 成功返回 true，无 revert 记录或失败返回 false
 */
export function unrevert(sessionId: string): boolean {
  try {
    const state = revertStore.get(sessionId);
    if (!state) {
      log.debug(`unrevert: 无 revert 记录(会话 ${sessionId})`);
      return false;
    }

    // 恢复被删除的消息
    const db = getDb();
    for (const msg of state.revertedMessages) {
      db.insert(messagesTable)
        .values({
          createdAt: msg.createdAt,
          id: msg.id,
          partsJson: JSON.stringify(msg.parts),
          role: msg.role,
          sessionId,
        })
        .run();
    }

    // 尝试恢复文件变更
    restoreFilesForUnrevert(sessionId, state.beforeSnapshot);

    // 清除 revert 状态
    revertStore.delete(sessionId);

    log.info(`unrevert 完成: 会话 ${sessionId} 恢复了 ${state.revertedMessages.length} 条消息`);
    return true;
  } catch (error) {
    log.error(`unrevert 失败: ${error instanceof Error ? error.message : String(error)}`, {
      eventType: "session.unrevert.failed",
      payload: { error: String(error), sessionId },
      sessionId,
    });
    return false;
  }
}

/**
 * 获取已 revert 的消息数。
 *
 * @param sessionId 会话 ID
 * @returns 已 revert 的消息数(无 revert 记录返回 0)
 */
export function getRevertedCount(sessionId: string): number {
  const state = revertStore.get(sessionId);
  return state?.revertedMessages.length ?? 0;
}

/**
 * 获取 revert 状态详情。
 *
 * @param sessionId 会话 ID
 * @returns revert 状态，无记录返回 null
 */
export function getRevertState(sessionId: string): {
  revertedCount: number;
  revertedAt: number;
  targetIndex: number;
} | null {
  const state = revertStore.get(sessionId);
  if (!state) {
    return null;
  }
  return {
    revertedAt: state.revertedAt,
    revertedCount: state.revertedMessages.length,
    targetIndex: state.targetIndex,
  };
}

/**
 * 清除 revert 状态(不再允许 unrevert)。
 *
 * @param sessionId 会话 ID
 */
export function clearRevertState(sessionId: string): void {
  revertStore.delete(sessionId);
}

/**
 * revert 时恢复文件变更。
 * 通过 git checkout 恢复被修改的文件。
 */
function restoreFilesForRevert(sessionId: string): void {
  const session = getSession(sessionId);
  const projectDir = session?.projectDir ?? process.cwd();
  const resolvedDir = resolve(projectDir);

  if (!isInsideGitWorkTree(resolvedDir)) {
    log.debug(`revert 文件恢复: 不在 Git 工作区内，跳过`);
    return;
  }

  // 获取 before 快照中的变更文件
  const beforeSnapshot = getSnapshot(sessionId, "before");
  if (!beforeSnapshot || beforeSnapshot.files.length === 0) {
    log.debug(`revert 文件恢复: 无 before 快照或无变更文件`);
    return;
  }

  // 对每个变更文件尝试 git checkout 恢复
  for (const file of beforeSnapshot.files) {
    try {
      if (file.isNew) {
        // 新增文件: 删除
        execFileSync("git", ["-C", resolvedDir, "rm", "-f", "--", file.path], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 5000,
        });
      } else if (file.isDeleted) {
        // 删除的文件: 恢复
        execFileSync("git", ["-C", resolvedDir, "checkout", "--", file.path], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 5000,
        });
      } else {
        // 修改的文件: 恢复到 HEAD 版本
        execFileSync("git", ["-C", resolvedDir, "checkout", "--", file.path], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 5000,
        });
      }
    } catch (error) {
      log.warn(`revert 文件恢复失败: ${file.path} — ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * unrevert 时恢复文件变更。
 * 尝试恢复到 revert 前的文件状态。
 */
function restoreFilesForUnrevert(sessionId: string, beforeSnapshot: SnapshotData | null): void {
  const session = getSession(sessionId);
  const projectDir = session?.projectDir ?? process.cwd();
  const resolvedDir = resolve(projectDir);

  if (!isInsideGitWorkTree(resolvedDir)) {
    log.debug(`unrevert 文件恢复: 不在 Git 工作区内，跳过`);
    return;
  }

  // 获取 after 快照(工具执行后的文件状态)
  const afterSnapshot = getSnapshot(sessionId, "after");
  if (!afterSnapshot || afterSnapshot.files.length === 0) {
    log.debug(`unrevert 文件恢复: 无 after 快照或无变更文件`);
    return;
  }

  // 对 after 快照中的变更文件尝试恢复
  // 注意: unrevert 文件恢复是 best-effort，可能因文件冲突而失败
  for (const file of afterSnapshot.files) {
    try {
      if (file.isNew) {
        // 新增文件: 尝试恢复(从 git stash 或 index)
        execFileSync("git", ["-C", resolvedDir, "checkout", "--", file.path], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 5000,
        });
      } else if (file.isDeleted) {
        // 删除的文件: 尝试删除恢复
        execFileSync("git", ["-C", resolvedDir, "rm", "-f", "--", file.path], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 5000,
        });
      } else {
        // 修改的文件: 尝试恢复
        execFileSync("git", ["-C", resolvedDir, "checkout", "--", file.path], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 5000,
        });
      }
    } catch (error) {
      log.warn(`unrevert 文件恢复失败: ${file.path} — ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
