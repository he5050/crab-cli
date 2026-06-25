/**
 * Agent 状态持久化 — ConversationHandler 运行时状态的序列化与恢复。
 */
import { eq, getDb, getRawDb } from "@/db";
import { sessions } from "@/db/schema";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("conversation:agent-state");
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Agent 运行时状态(可序列化) */
export interface AgentRuntimeState {
  modelId?: string;
  providerId?: string;
  temperature?: number;
  topP?: number;
  systemPrompt: string;
  allowedTools?: string[];
  activeSkillContext?: string;
  sessionDiscoveredSkills?: string[];
  sessionActiveSkills?: string[];
  sessionLoadedSkills?: string[];
  sessionAllowedExternalTools?: string[];
  recentToolCalls: { toolName: string; args: string }[];
  recoveredFrom: boolean;
  recoveredAt?: number;
  savedAt: number;
}

/** 持久化状态类型别名 */
export type AgentPersistentState = AgentRuntimeState;

/** 保存 Agent 状态到 DB. 返回 true 表示成功, false 表示失败 */
export function saveAgentState(sessionId: string, state: Omit<AgentRuntimeState, "savedAt">): boolean {
  try {
    const db = getDb();
    const fullState: AgentRuntimeState = { ...state, savedAt: Date.now() };
    db.update(sessions)
      .set({ agentStateJson: JSON.stringify(fullState), updatedAt: Date.now() })
      .where(eq(sessions.id, sessionId))
      .run();
    log.debug(`Agent 状态已保存: ${sessionId}`);
    return true;
  } catch (error) {
    log.warn(`保存 Agent 状态失败: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/** 加载 Agent 状态 */
export function loadAgentState(sessionId: string): AgentRuntimeState | null {
  try {
    const db = getDb();
    const rows = db.select().from(sessions).where(eq(sessions.id, sessionId)).all();

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0] as Record<string, unknown>;
    const json = row.agentStateJson as string | null;
    if (!json) {
      return null;
    }

    const state = JSON.parse(json) as AgentRuntimeState;

    if (Date.now() - state.savedAt > MAX_AGE_MS) {
      log.info(`Agent 状态已过期: ${sessionId} (${Math.round((Date.now() - state.savedAt) / 60_000)} 分钟前)`);
      return null;
    }

    return state;
  } catch (error) {
    log.warn(`加载 Agent 状态失败: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** 清除 Agent 状态 */
export function clearAgentState(sessionId: string): void {
  try {
    const db = getDb();
    db.update(sessions).set({ agentStateJson: null, updatedAt: Date.now() }).where(eq(sessions.id, sessionId)).run();
    log.debug(`Agent 状态已清除: ${sessionId}`);
  } catch (error) {
    // 状态清除失败不应阻塞主流程(例如会话已被并发清理);
    // 记录 warn 以便问题排查, 但继续执行.
    log.warn(`清除 Agent 状态失败: ${sessionId}`, { error: String(error) });
  }
}

/** 查找可恢复的会话列表 */
export function findRecoverableSessions(options?: { limit?: number; offset?: number }): {
  sessionId: string;
  title: string;
  savedAt: number;
  status: string;
}[] {
  try {
    const db = getRawDb();
    if (!db) {
      return [];
    }
    const now = Date.now();
    const cutoff = now - MAX_AGE_MS;
    const rows = db
      .query(
        `SELECT id, title, updated_at as savedAt, status, agent_state_json
         FROM sessions
         WHERE status IN ('active', 'paused')
           AND agent_state_json IS NOT NULL
           AND updated_at > ?`,
      )
      .all(cutoff) as { id: string; title: string; savedAt: number; status: string; agent_state_json: string }[];

    const valid = rows
      .filter((r) => {
        try {
          JSON.parse(r.agent_state_json);
          return true;
        } catch (error) {
          log.warn(
            `发现损坏的 Agent 状态(将被忽略): sessionId=${r.id}, error=${error instanceof Error ? error.message : String(error)}`,
          );
          return false;
        }
      })
      .map((r) => ({
        savedAt: r.savedAt,
        sessionId: r.id,
        status: r.status,
        title: r.title,
      }));

    const offset = options?.offset ?? 0;
    const limit = options?.limit;
    const sliced = limit !== undefined ? valid.slice(offset, offset + limit) : valid.slice(offset);
    return sliced;
  } catch (error) {
    log.warn("查找可恢复会话失败", { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

/** 清理过期的持久化状态(使用事务保护) */
export function cleanupExpiredStates(): number {
  try {
    const db = getRawDb();
    if (!db) {
      return 0;
    }
    const now = Date.now();
    const cutoff = now - MAX_AGE_MS;

    const rows = db
      .query(
        `SELECT id FROM sessions
         WHERE status IN ('active', 'paused')
           AND agent_state_json IS NOT NULL
           AND updated_at <= ?`,
      )
      .all(cutoff) as { id: string }[];

    if (rows.length === 0) {
      return 0;
    }

    // 使用 db.transaction 包装，自动管理 COMMIT/ROLLBACK
    const tx = db.transaction(() => {
      for (const row of rows) {
        db.query(`UPDATE sessions SET agent_state_json = NULL, status = 'completed', updated_at = ? WHERE id = ?`).run(
          now,
          row.id,
        );
      }
    });
    tx();

    log.info(`已清理 ${rows.length} 条过期 Agent 状态`);
    return rows.length;
  } catch (error) {
    log.warn(`清理过期 Agent 状态失败`, { error: String(error) });
    return 0;
  }
}
