/**
 * 消息管理 — 消息 CRUD 和结构化 Parts。
 *
 * 职责:
 *   - 添加/查询/删除消息
 *   - 管理结构化消息 Parts
 *   - 消息序列化和反序列化
 *
 * 模块功能:
 *   - addMessage: 添加消息
 *   - addTextMessage: 添加文本消息
 *   - getSessionMessages: 获取会话消息
 *   - getMessageCount: 获取消息数量
 *   - deleteSessionMessages: 删除会话消息
 *   - deleteMessage: 删除单条消息
 *   - copyMessages: 复制消息
 *   - cleanIncompleteToolCalls: 清理不完整的工具调用
 *   - TextPart: 文本 Part 类型
 *   - ToolUsePart: 工具使用 Part 类型
 *   - ToolResultPart: 工具结果 Part 类型
 *   - ThinkingPart: 思考 Part 类型
 *   - MessagePart: 消息 Part 联合类型
 *   - MessageRole: 消息角色类型
 *   - MessageRecord: 消息记录类型
 *
 * 使用场景:
 *   - 添加用户消息
 *   - 添加助手消息
 *   - 添加工具调用消息
 *   - 查询会话历史
 *   - 删除消息
 *
 * 边界:
 *   1. 仅数据库操作，不涉及 AI 对话流程
 *   2. 消息以 JSON 格式存储 Parts
 *   3. 支持多种消息 Part 类型
 *   4. 反序列化失败时回退为文本
 *
 * 流程:
 *   1. 构建消息 Parts
 *   2. 调用 addMessage 添加消息
 *   3. 使用 getSessionMessages 查询消息
 *   4. 使用 deleteMessage 删除消息
 */
import { asc, eq, getDb } from "@/db";
import { messages, parts, sessions } from "@/db/schema";
import { createId } from "@/core/identity";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("session:message");
type SQLiteRunResult = { changes?: number } | undefined;

// ─── 消息 Part 类型 ─────────────────────────────────────────────
// 纯数据类型定义在 session/types.ts，此处引入 + re-export 保持向后兼容
import type { MessagePartTime, MessageFileReference } from "../types";
export type { MessagePartTime, MessageFileReference };

export interface MessagePartBase {
  metadata?: Record<string, unknown>;
  time?: MessagePartTime;
}

export interface TextPart {
  type: "text";
  content: string;
  metadata?: Record<string, unknown>;
  time?: MessagePartTime;
}

export interface ToolUsePart {
  type: "tool_use";
  content: string;
  tool_use_id: string;
  tool_name: string;
  callId?: string;
  input?: unknown;
  metadata?: Record<string, unknown>;
  files?: MessageFileReference[];
  diagnostics?: unknown[];
  subSessionId?: string;
  time?: MessagePartTime;
}

export interface ToolResultPart {
  type: "tool_result";
  content: string;
  tool_use_id: string;
  result: unknown;
  callId?: string;
  metadata?: Record<string, unknown>;
  files?: MessageFileReference[];
  diagnostics?: unknown[];
  subSessionId?: string;
  time?: MessagePartTime;
  success?: boolean;
  truncated?: boolean;
  outputPath?: string;
}

export interface ThinkingPart {
  type: "thinking";
  content: string;
  metadata?: Record<string, unknown>;
  time?: MessagePartTime;
}

/** 所有 Part 类型的联合 */
export type MessagePart = TextPart | ToolUsePart | ToolResultPart | ThinkingPart;

/** 消息角色 */
export type MessageRole = "system" | "user" | "assistant" | "tool";

/** 消息记录 */
export interface MessageRecord {
  id: string;
  sessionId: string;
  role: MessageRole;
  parts: MessagePart[];
  createdAt: number;
  metadata?: Record<string, unknown>;
  time?: MessagePartTime;
}

// ─── 序列化 ──────────────────────────────────────────────────────

function serializeParts(parts: MessagePart[]): string {
  return JSON.stringify(parts);
}

function deserializeParts(json: string): MessagePart[] {
  try {
    return JSON.parse(json) as MessagePart[];
  } catch {
    log.warn(`消息 Parts 反序列化失败，回退为文本`);
    return [{ content: json, type: "text" }] as TextPart[];
  }
}

/** Part 类型分类，用于 parts 表的 type 字段 */
type PartTableType = "text" | "tool" | "reasoning";

/** 将 MessagePart 映射到 parts 表的类型分类 */
function classifyPart(part: MessagePart): PartTableType {
  switch (part.type) {
    case "text":
      return "text";
    case "thinking":
      return "reasoning";
    case "tool_use":
    case "tool_result":
      return "tool";
    default:
      return "text";
  }
}

/**
 * 将消息的 Parts 写入独立的 parts 表(P2-A4)。
 * 与 messages.parts_json 双写，保证向后兼容。
 */
function writePartsToTable(sessionId: string, messageId: string, messageParts: MessagePart[], createdAt: number): void {
  const db = getDb();
  for (const part of messageParts) {
    const partId = createId("part");
    const partType = classifyPart(part);
    db.insert(parts)
      .values({
        id: partId,
        sessionId,
        messageId,
        type: partType,
        dataJson: JSON.stringify(part),
        createdAt,
      })
      .run();
  }
}

/**
 * 从 parts 表读取指定消息的所有 Parts。
 * 如果 parts 表中没有数据(旧消息)，返回 null 以触发 parts_json 回退。
 */
function readPartsFromTable(sessionId: string, messageId: string): MessagePart[] | null {
  const db = getDb();
  const rows = db.select().from(parts).where(eq(parts.messageId, messageId)).orderBy(asc(parts.createdAt)).all() as {
    id: string;
    dataJson: string;
    type: string;
  }[];

  if (rows.length === 0) {
    return null;
  }

  const result: MessagePart[] = [];
  for (const row of rows) {
    try {
      result.push(JSON.parse(row.dataJson) as MessagePart);
    } catch {
      log.warn(`Part 反序列化失败(messageId=${messageId}, partId=${row.id})，跳过`);
    }
  }
  return result;
}

// ─── CRUD 操作 ────────────────────────────────────────────────────

/**
 * 添加消息到会话。
 */
export function addMessage(
  sessionId: string,
  role: MessageRole,
  parts: MessagePart[],
  createdAt?: number,
): MessageRecord {
  const db = getDb();
  const id = createId("msg");
  const now = createdAt ?? Date.now();

  const record = {
    createdAt: now,
    id,
    partsJson: serializeParts(parts),
    role,
    sessionId,
  };

  db.insert(messages).values(record).run();

  // P2-A4: 同步写入 parts 表(Part 粒度消息模型)
  writePartsToTable(sessionId, id, parts, now);

  // 更新会话的 updatedAt 时间戳，确保列表排序准确
  db.update(sessions).set({ updatedAt: now }).where(eq(sessions.id, sessionId)).run();

  // 自动标题生成:首条用户消息时，截取前 50 字作为会话标题
  if (role === "user") {
    const row = db.select({ title: sessions.title }).from(sessions).where(eq(sessions.id, sessionId)).get();
    if (row && (!row.title || row.title.trim() === "")) {
      // 提取第一个 TextPart 的纯文本内容
      const textPart = parts.find((p) => p.type === "text");
      const rawText = textPart && "content" in textPart ? (textPart as { content: string }).content : "";
      const title = rawText.length > 50 ? `${rawText.slice(0, 50)}...` : rawText;
      db.update(sessions).set({ title }).where(eq(sessions.id, sessionId)).run();
      log.debug(`自动设置会话标题: ${title}`);
    }
  }

  log.debug(`消息已添加: ${id} → 会话 ${sessionId}`);
  return { createdAt: now, id, parts, role, sessionId };
}

/**
 * 快捷方式 — 添加纯文本消息。
 */
export function addTextMessage(sessionId: string, role: MessageRole, content: string): MessageRecord {
  return addMessage(sessionId, role, [{ content, type: "text" }]);
}

/**
 * 按会话查询所有消息(按时间升序)。
 *
 * P2-A4: 优先从 parts 表读取 Part 粒度数据，
 * 如果 parts 表无数据(旧消息兼容)，回退到 parts_json。
 */
export function getSessionMessages(sessionId: string): MessageRecord[] {
  const db = getDb();
  const rows = db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.createdAt))
    .all();

  return (rows as { id: string; sessionId: string; role: string; partsJson: string; createdAt: number }[]).map(
    (row) => {
      // P2-A4: 优先从 parts 表读取
      const partsFromTable = readPartsFromTable(sessionId, row.id);
      const messageParts = partsFromTable ?? deserializeParts(row.partsJson);

      return {
        createdAt: row.createdAt,
        id: row.id,
        parts: messageParts,
        role: row.role as MessageRole,
        sessionId: row.sessionId,
      };
    },
  );
}

/**
 * 按类型查询会话中的 Parts(P2-A4)。
 *
 * 从 parts 表按 type 过滤查询，支持高效获取特定类型的 Part。
 *
 * @param sessionId 会话 ID
 * @param type Part 类型(text/tool/reasoning)
 * @returns 匹配的 Part 数据数组
 */
export function getPartsByType(
  sessionId: string,
  type: "text" | "tool" | "reasoning",
): Array<{ messageId: string; data: unknown; createdAt: number }> {
  const db = getDb();
  const rows = db.select().from(parts).where(eq(parts.sessionId, sessionId)).all() as {
    messageId: string;
    dataJson: string;
    type: string;
    createdAt: number;
  }[];

  const filtered = rows.filter((row) => row.type === type);
  return filtered.map((row) => ({
    messageId: row.messageId,
    data: (() => {
      try {
        return JSON.parse(row.dataJson);
      } catch {
        log.warn(`Part 反序列化失败(messageId=${row.messageId})，返回 null`);
        return null;
      }
    })(),
    createdAt: row.createdAt,
  }));
}

/**
 * 获取会话的消息数量。
 */
export function getMessageCount(sessionId: string): number {
  const db = getDb();
  const rows = db.select({ count: messages.id }).from(messages).where(eq(messages.sessionId, sessionId)).all();
  return rows.length;
}

/**
 * 删除会话的所有消息。
 */
export function deleteSessionMessages(sessionId: string): void {
  const db = getDb();
  db.delete(messages).where(eq(messages.sessionId, sessionId)).run();
  log.debug(`会话消息已清空: ${sessionId}`);
}

/**
 * 按消息 ID 删除单条消息。
 */
export function deleteMessage(id: string): boolean {
  const db = getDb();
  const result = db.delete(messages).where(eq(messages.id, id)).run() as SQLiteRunResult;
  return (result?.changes ?? 0) > 0;
}

/**
 * 复制源会话的所有消息到目标会话。
 * 用于会话分叉场景。
 */
export function copyMessages(fromSessionId: string, toSessionId: string): number {
  const sourceMessages = getSessionMessages(fromSessionId);
  const db = getDb();

  let count = 0;
  for (const msg of sourceMessages) {
    const newId = createId("msg");
    db.insert(messages)
      .values({
        createdAt: msg.createdAt,
        id: newId,
        partsJson: serializeParts(msg.parts),
        role: msg.role,
        sessionId: toSessionId,
      })
      .run();
    count++;
  }

  log.debug(`消息复制完成: ${fromSessionId} → ${toSessionId} (${count} 条)`);
  return count;
}

// ─── 崩溃恢复 ──────────────────────────────────────────────────────

/**
 * 清理会话中不完整的工具调用。
 *
 * 场景:进程崩溃或用户中断时，assistant 消息包含 ToolUsePart 但没有
 * 对应的 ToolResultPart(tool_use_id 无法匹配)。这些不完整的工具
 * 调用会导致恢复会话时 AI 收到格式错误的上下文。
 *
 * 策略:
 *   1. 从末尾向前扫描，找到最后一条包含 ToolUsePart 的 assistant 消息
 *   2. 检查每个 ToolUsePart 是否有匹配的 ToolResultPart
 *   3. 如果存在不完整的工具调用，删除从该条 assistant 消息起的所有后续消息
 *   4. 如果 assistant 消息只有 ToolUsePart 而无其他内容，直接删除该条消息
 *
 * @returns 被清理的消息数量
 */
export function cleanIncompleteToolCalls(sessionId: string): number {
  const allMessages = getSessionMessages(sessionId);
  if (allMessages.length === 0) {
    return 0;
  }

  // 收集所有 tool_use_id → 是否有匹配 tool_result
  const toolUseIds = new Map<string, { found: boolean; msgIndex: number }>();

  for (let i = 0; i < allMessages.length; i++) {
    const msg = allMessages[i]!;
    for (const part of msg.parts) {
      if (part.type === "tool_use") {
        const tu = part as ToolUsePart;
        toolUseIds.set(tu.tool_use_id, { found: false, msgIndex: i });
      } else if (part.type === "tool_result") {
        const tr = part as ToolResultPart;
        const entry = toolUseIds.get(tr.tool_use_id);
        if (entry) {
          entry.found = true;
        }
      }
    }
  }

  // 找出所有不完整的 tool_use(没有匹配 tool_result)
  const incompleteIndices: number[] = [];
  for (const [, val] of toolUseIds) {
    if (!val.found) {
      incompleteIndices.push(val.msgIndex);
    }
  }

  if (incompleteIndices.length === 0) {
    return 0;
  }

  // 取最早的不完整消息索引，删除从它开始的所有后续消息
  const cutIndex = Math.min(...incompleteIndices);
  const toDelete = allMessages.slice(cutIndex);
  const db = getDb();

  for (const msg of toDelete) {
    db.delete(messages).where(eq(messages.id, msg.id)).run();
  }

  log.info(`崩溃恢复: 清理 ${toDelete.length} 条不完整消息 (会话 ${sessionId}, 从索引 ${cutIndex} 开始)`);
  return toDelete.length;
}
