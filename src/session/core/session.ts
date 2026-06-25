/**
 * 会话管理器 — 会话 CRUD 操作。
 *
 * 职责:
 *   - 创建/查询/更新/删除/分叉会话
 *   - 管理会话生命周期
 *   - 会话 Token 统计
 *   - 触发会话 Hook
 *
 * 模块功能:
 *   - createSession: 创建会话(同步)
 *   - createSessionAsync: 创建会话(异步)
 *   - ensureSession: 确保会话存在
 *   - ensureSessionAsync: 确保会话存在(异步)
 *   - getSession: 获取会话
 *   - updateSession: 更新会话
 *   - deleteSession: 删除会话
 *   - listSessions: 列总会话
 *   - forkSession: 分叉会话
 *   - addSessionTokens: 添加会话 Token 统计
 *   - CreateSessionInput: 会话创建输入类型
 *   - SessionRecord: 会话记录类型
 *   - SessionListItem: 会话列表项类型
 *
 * 使用场景:
 *   - 创建新会话
 *   - 查询会话信息
 *   - 更新会话状态
 *   - 删除会话
 *   - 分叉会话创建分支
 *
 * 边界:
 *   1. 仅数据库操作，不涉及 UI 和对话逻辑
 *   2. 会话创建时触发 SessionStart Hook
 *   3. 分叉会话继承父会话消息
 *   4. 会话删除级联删除消息和检查点
 *
 * 流程:
 *   1. 调用 createSession 创建新会话
 *   2. 使用 getSession 查询会话
 *   3. 使用 updateSession 更新会话
 *   4. 使用 deleteSession 删除会话
 *   5. 使用 forkSession 创建会话分支
 */
import { desc, eq, getDb, sql } from "@/db";
import { messages as messagesTable, sessions } from "@/db/schema";
import { createId } from "@/core/identity";
import { createLogger } from "@/core/logging/logger";
import { copyMessages } from "./message";

const log = createLogger("session");

// ─── 类型定义 ────────────────────────────────────────────────────

/** 会话创建参数 */
export interface CreateSessionInput {
  id?: string;
  title?: string;
  model?: string;
  projectDir?: string;
  parentId?: string;
}

/** 会话数据库记录 */
export interface SessionRecord {
  id: string;
  title: string;
  status: "active" | "paused" | "completed" | "error";
  model: string | null;
  parentId: string | null;
  projectDir: string | null;
  tokensInput: number;
  tokensOutput: number;
  tokensReasoning: number;
  cost: number;
  createdAt: number;
  updatedAt: number;
}

/** 会话列表项(轻量版，含消息计数) */
export interface SessionListItem {
  id: string;
  title: string;
  status: SessionRecord["status"];
  model: string | null;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

// ─── CRUD 操作 ────────────────────────────────────────────────────

/**
 * 创建新会话(同步版本，用于测试和简单场景)。
 */
export function createSession(input?: CreateSessionInput): SessionRecord {
  const db = getDb();
  const now = Date.now();
  const id = input?.id ?? createId("ses");

  const record: SessionRecord = {
    cost: 0,
    createdAt: now,
    id,
    model: input?.model ?? null,
    parentId: input?.parentId ?? null,
    projectDir: input?.projectDir ?? null,
    status: "active",
    title: input?.title ?? "",
    tokensInput: 0,
    tokensOutput: 0,
    tokensReasoning: 0,
    updatedAt: now,
  };

  db.insert(sessions).values(record).run();

  // 异步触发 SessionStart Hook(不阻塞)
  Promise.resolve().then(async () => {
    try {
      const { hookExecutor } = await import("@/hooks/hookExecutor");
      await hookExecutor.sessionStart(id);
    } catch (error) {
      log.warn(`SessionStart Hook 执行失败: ${error}`);
    }
  });

  log.info(`会话已创建: ${id}`);
  return record;
}

/**
 * 创建新会话(异步版本，等待 Hook 执行完成)。
 */
export async function createSessionAsync(input?: CreateSessionInput): Promise<SessionRecord> {
  const db = getDb();
  const now = Date.now();
  const id = input?.id ?? createId("ses");

  const record: SessionRecord = {
    cost: 0,
    createdAt: now,
    id,
    model: input?.model ?? null,
    parentId: input?.parentId ?? null,
    projectDir: input?.projectDir ?? null,
    status: "active",
    title: input?.title ?? "",
    tokensInput: 0,
    tokensOutput: 0,
    tokensReasoning: 0,
    updatedAt: now,
  };

  db.insert(sessions).values(record).run();

  // 触发 SessionStart Hook
  try {
    const { hookExecutor } = await import("@/hooks/hookExecutor");
    await hookExecutor.sessionStart(id);
  } catch (error) {
    log.warn(`SessionStart Hook 执行失败: ${error}`);
  }

  log.info(`会话已创建: ${id}`);
  return record;
}

/**
 * 确保指定 ID 的会话存在。
 * 如果已存在则返回现有记录，不存在则按给定 ID 创建。
 */
export function ensureSession(id: string, input?: Omit<CreateSessionInput, "id">): SessionRecord {
  const existing = getSession(id);
  if (existing) {
    return existing;
  }
  return createSession({ ...input, id });
}

/**
 * 确保指定 ID 的会话存在(异步版本)。
 */
export async function ensureSessionAsync(id: string, input?: Omit<CreateSessionInput, "id">): Promise<SessionRecord> {
  const existing = getSession(id);
  if (existing) {
    return existing;
  }
  return createSessionAsync({ ...input, id });
}

/**
 * 按 ID 查询会话。
 */
export function getSession(id: string): SessionRecord | null {
  const db = getDb();
  const rows = db.select().from(sessions).where(eq(sessions.id, id)).all();
  return (rows[0] as SessionRecord) ?? null;
}

/**
 * 更新会话。
 */
export function updateSession(
  id: string,
  updates: Partial<Pick<SessionRecord, "title" | "status" | "model">>,
): SessionRecord | null {
  const db = getDb();
  const existing = getSession(id);
  if (!existing) {
    return null;
  }

  db.update(sessions)
    .set({ ...updates, updatedAt: Date.now() })
    .where(eq(sessions.id, id))
    .run();

  log.debug(`会话已更新: ${id}`, updates);
  return getSession(id);
}

export function setSessionPersistenceStatus(id: string, status: SessionRecord["status"]): SessionRecord | null {
  return updateSession(id, { status });
}

/**
 * 删除会话及其所有消息和检查点。
 */
export function deleteSession(id: string): boolean {
  const db = getDb();
  const existing = getSession(id);
  if (!existing) {
    return false;
  }

  // 异步触发 SessionEnd Hook(不阻塞删除)
  Promise.resolve().then(async () => {
    try {
      const { hookExecutor } = await import("@/hooks/hookExecutor");
      await hookExecutor.sessionEnd(id);
    } catch (error) {
      log.warn(`SessionEnd Hook 执行失败: ${error}`);
    }
  });

  // CASCADE 会自动删除关联的 messages 和 checkpoints
  db.delete(sessions).where(eq(sessions.id, id)).run();

  log.info(`会话已删除: ${id}`);
  return true;
}

/**
 * 列出所有会话(按更新时间降序，含消息计数)。
 */
export function listSessions(): SessionListItem[] {
  const db = getDb();

  // 查询消息计数
  const msgCounts = db
    .select({
      count: sql<number>`count(*)`.as("count"),
      sessionId: messagesTable.sessionId,
    })
    .from(messagesTable)
    .groupBy(messagesTable.sessionId)
    .all();

  const countMap = new Map<string, number>();
  for (const row of msgCounts) {
    countMap.set(row.sessionId as string, row.count as number);
  }

  // 查询会话列表
  const rows = db.select().from(sessions).orderBy(desc(sessions.updatedAt)).all();

  return (rows as SessionRecord[]).map((r) => ({
    createdAt: r.createdAt,
    id: r.id,
    messageCount: countMap.get(r.id) ?? 0,
    model: r.model,
    status: r.status,
    title: r.title || `会话 ${r.id.slice(4, 8)}`,
    updatedAt: r.updatedAt,
  }));
}

/**
 * 分叉会话 — 从现有会话创建新分支。
 * 复制父会话的所有消息到新会话。
 */
export function forkSession(parentId: string, title?: string): SessionRecord | null {
  const parent = getSession(parentId);
  if (!parent) {
    return null;
  }

  const forked = createSession({
    model: parent.model ?? undefined,
    parentId: parent.id,
    projectDir: parent.projectDir ?? undefined,
    title: title ?? `${parent.title || "会话"} (分叉)`,
  });

  copyMessages(parentId, forked.id);

  log.info(`会话分叉: ${parentId} → ${forked.id}`);
  return forked;
}

/**
 * 累加会话的 Token 使用量。
 * 每次对话完成后调用，将本轮 token 追加到会话总计。
 *
 * @param id - 会话 ID
 * @param usage - 本轮 token 使用量
 */
export function addSessionTokens(
  id: string,
  usage: { input?: number; output?: number; reasoning?: number; cost?: number },
): void {
  const db = getDb();
  const existing = getSession(id);
  if (!existing) {
    return;
  }

  // 使用 SQL 原子累加，避免 read-then-write 竞态条件
  db.update(sessions)
    .set({
      cost: sql`${sessions.cost} + ${usage.cost ?? 0}`,
      tokensInput: sql`${sessions.tokensInput} + ${usage.input ?? 0}`,
      tokensOutput: sql`${sessions.tokensOutput} + ${usage.output ?? 0}`,
      tokensReasoning: sql`${sessions.tokensReasoning} + ${usage.reasoning ?? 0}`,
      updatedAt: Date.now(),
    })
    .where(eq(sessions.id, id))
    .run();

  log.debug(`Token 累加: ${id}`, usage);
}
