/**
 * 会话用量统计模块 — 追踪 Token 使用情况。
 *
 * 职责:
 *   - 从 session/message 真值源推导每个会话的用量
 *   - 提供全局用量统计
 *   - 追踪 Token 使用情况
 *
 * 模块功能:
 *   - getSessionUsageStats:获取单个会话的用量统计
 *   - getGlobalUsageStats:获取全局用量统计
 *   - summarizeToolCalls:统计会话的工具调用次数
 *
 * 使用场景:
 *   - 查看会话用量统计
 *   - 全局用量分析
 *   - 成本估算
 *
 * 边界:
 *   1. 从 session/message 真值源推导数据
 *   2. 实时计算，不缓存
 *   3. 包含输入/输出 Token 统计
 *   4. 包含工具调用次数统计
 *
 * 流程:
 *   1. 读取会话和消息数据
 *   2. 统计消息数量和 Token 用量
 *   3. 计算工具调用次数
 *   4. 返回统计结果
 */
import { createLogger } from "@/core/logging/logger";
import { getRawDb } from "@/db";

const log = createLogger("session:usage");

// 简单的内存缓存，TTL 60 秒
let globalStatsCache: GlobalUsageStats | null = null;
let globalStatsCacheTime = 0;
const CACHE_TTL = 60_000; // 60 秒

/** 用量统计数据结构 */
export interface UsageStats {
  /** 会话 ID */
  sessionId: string;
  /** 消息数量 */
  messageCount: number;
  /** 输入 Token 数 */
  inputTokens: number;
  /** 输出 Token 数 */
  outputTokens: number;
  /** 工具调用次数 */
  toolCallCount: number;
  /** 最后更新时间 */
  lastUpdated: string;
}

/** 全局用量统计 */
export interface GlobalUsageStats {
  /** 总会话数 */
  sessionCount: number;
  /** 总消息数 */
  messageCount: number;
  /** 总输入 Token */
  totalInputTokens: number;
  /** 总输出 Token */
  totalOutputTokens: number;
  /** 总工具调用次数 */
  totalToolCalls: number;
}

function countToolCalls(rows: { parts_json: string }[]): number {
  let total = 0;
  for (const row of rows) {
    try {
      const parts = JSON.parse(row.parts_json) as { type: string }[];
      for (const part of parts) {
        if (part.type === "tool_use") {
          total++;
        }
      }
    } catch {
      // 跳过解析失败的行
    }
  }
  return total;
}

function deriveSessionUsage(sessionId: string): UsageStats {
  const db = getRawDb();
  if (!db) {
    return {
      inputTokens: 0,
      lastUpdated: new Date().toISOString(),
      messageCount: 0,
      outputTokens: 0,
      sessionId,
      toolCallCount: 0,
    };
  }

  const session = db
    .query("SELECT tokens_input as ti, tokens_output as tout, updated_at as updatedAt FROM sessions WHERE id = ?")
    .get(sessionId) as { ti: number; tout: number; updatedAt: number } | null;
  if (!session) {
    return {
      inputTokens: 0,
      lastUpdated: new Date().toISOString(),
      messageCount: 0,
      outputTokens: 0,
      sessionId,
      toolCallCount: 0,
    };
  }

  const messageCount = (
    db.query("SELECT COUNT(*) as c FROM messages WHERE session_id = ?").get(sessionId) as { c: number }
  ).c;
  const toolCallRows = db
    .query("SELECT parts_json FROM messages WHERE session_id = ? AND role IN ('assistant', 'tool')")
    .all(sessionId) as { parts_json: string }[];

  return {
    inputTokens: session.ti,
    lastUpdated: new Date(session.updatedAt).toISOString(),
    messageCount,
    outputTokens: session.tout,
    sessionId,
    toolCallCount: countToolCalls(toolCallRows),
  };
}

/**
 * 获取会话用量统计。
 *
 * 如果 sessionId 为 "global"，返回全局统计的视图。
 * 查询失败时返回零值默认值（不抛异常）。
 */
export async function getSessionUsageStats(sessionId: string): Promise<UsageStats> {
  if (sessionId === "global") {
    const global = getGlobalUsageStats();
    return {
      inputTokens: global.totalInputTokens,
      lastUpdated: new Date().toISOString(),
      messageCount: global.messageCount,
      outputTokens: global.totalOutputTokens,
      sessionId,
      toolCallCount: global.totalToolCalls,
    };
  }

  try {
    return deriveSessionUsage(sessionId);
  } catch (error) {
    log.warn("获取会话用量失败", { error: String(error), sessionId });
    return {
      inputTokens: 0,
      lastUpdated: new Date().toISOString(),
      messageCount: 0,
      outputTokens: 0,
      sessionId,
      toolCallCount: 0,
    };
  }
}

/**
 * 获取全局用量统计 — 使用 SQL 聚合避免 O(n*m) 全扫描，带 60 秒缓存。
 */
export function getGlobalUsageStats(): GlobalUsageStats {
  const now = Date.now();

  // 检查缓存是否有效
  if (globalStatsCache && now - globalStatsCacheTime < CACHE_TTL) {
    return globalStatsCache;
  }

  const db = getRawDb();
  if (!db) {
    return { messageCount: 0, sessionCount: 0, totalInputTokens: 0, totalOutputTokens: 0, totalToolCalls: 0 };
  }

  const sessionCount = (db.query("SELECT COUNT(*) as c FROM sessions").get() as { c: number }).c;
  const tokens = db
    .query("SELECT COALESCE(SUM(tokens_input), 0) as ti, COALESCE(SUM(tokens_output), 0) as tout FROM sessions")
    .get() as { ti: number; tout: number };
  const messageCount = (db.query("SELECT COUNT(*) as c FROM messages").get() as { c: number }).c;

  // 性能优化:使用 SQL LIKE 预过滤，减少 JSON 解析的数据量
  const toolCallRows = db
    .query(
      `
    SELECT parts_json
    FROM messages
    WHERE role IN ('assistant', 'tool')
      AND parts_json LIKE '%tool_use%'
  `,
    )
    .all() as { parts_json: string }[];
  const totalToolCalls = countToolCalls(toolCallRows);

  const stats = {
    messageCount,
    sessionCount,
    totalInputTokens: tokens.ti,
    totalOutputTokens: tokens.tout,
    totalToolCalls,
  };

  // 更新缓存
  globalStatsCache = stats;
  globalStatsCacheTime = now;

  return stats;
}
