/**
 * 会话用量统计测试。
 *
 * 测试目标:
 *   - 验证基于 sessions / messages 表的用量统计接口
 *
 * 测试用例:
 *   - 多会话下的统计聚合
 *   - 边界场景(空数据、单条)
 *   - 临时数据库的清理
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { messages, sessions } from "@/db/schema";
import { cleanupTestDir, createGlobalTmpTestDir } from "../../helpers/testPaths";

let testDir = "";
let testDbPath = "";
let originalCwd = "";

let initDb: typeof import("@/db").initDb;
let closeDb: typeof import("@/db").closeDb;
let resetDb: typeof import("@/db").resetDb;
let getDb: typeof import("@/db").getDb;
let getRawDb: typeof import("@/db").getRawDb;
let getSessionUsageStats: typeof import("@/session/usage/usage").getSessionUsageStats;
let getGlobalUsageStats: typeof import("@/session/usage/usage").getGlobalUsageStats;

beforeEach(async () => {
  originalCwd = process.cwd();
  testDir = createGlobalTmpTestDir("session-usage-stats-");
  testDbPath = path.join(testDir, "usage.db");
  fs.mkdirSync(path.join(testDir, ".crab"), { recursive: true });
  process.chdir(testDir);

  const db = require("@/db") as typeof import("@/db");
  ({ initDb } = db);
  ({ closeDb } = db);
  ({ resetDb } = db);
  ({ getDb } = db);
  ({ getRawDb } = db);

  const usage = await import("@/session/usage/usage.ts");
  ({ getSessionUsageStats } = usage);
  ({ getGlobalUsageStats } = usage);

  resetDb();
  initDb(testDbPath);
});

afterEach(() => {
  closeDb();
  process.chdir(originalCwd);
  cleanupTestDir(testDir);
  testDir = "";
});

function insertSession(
  id: string,
  title: string,
  tokens: { input?: number; output?: number } = {},
  updatedAt = Date.now(),
): void {
  getDb()
    .insert(sessions)
    .values({
      agentStateJson: null,
      cost: 0,
      createdAt: updatedAt - 1000,
      id,
      model: null,
      parentId: null,
      projectDir: null,
      status: "active",
      title,
      tokensInput: tokens.input ?? 0,
      tokensOutput: tokens.output ?? 0,
      tokensReasoning: 0,
      updatedAt,
    })
    .run();
}

function insertMessage(
  id: string,
  sessionId: string,
  role: "system" | "user" | "assistant" | "tool",
  parts: unknown[],
): void {
  getDb()
    .insert(messages)
    .values({
      createdAt: Date.now(),
      id,
      partsJson: JSON.stringify(parts),
      role,
      sessionId,
    })
    .run();
}

describe("会话使用统计", () => {
  test("缺失 session 时返回默认值", async () => {
    const result = await getSessionUsageStats("missing-session");
    expect(result.sessionId).toBe("missing-session");
    expect(result.messageCount).toBe(0);
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
    expect(result.toolCallCount).toBe(0);
  });

  test("基于 session/message 真值推导单会话用量并忽略坏消息 parts", async () => {
    const sessionId = "ses_usage_truth";
    const updatedAt = Date.UTC(2026, 5, 4, 9, 30, 0);
    insertSession(sessionId, "usage-truth", { input: 123, output: 45 }, updatedAt);
    insertMessage("msg1", sessionId, "user", [{ content: "用户消息", type: "text" }]);
    insertMessage("msg2", sessionId, "assistant", [{ content: "助手回复", type: "text" }]);
    insertMessage("msg3", sessionId, "assistant", [
      { content: '{"cmd":"ls"}', tool_name: "bash", tool_use_id: "call_1", type: "tool_use" },
      { content: '{"cmd":"pwd"}', tool_name: "bash", tool_use_id: "call_2", type: "tool_use" },
    ]);

    // 手工插入一条坏 JSON，覆盖 countToolCalls 的 catch 分支
    getRawDb()!
      .query("INSERT INTO messages (id, session_id, role, parts_json, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("msg4", sessionId, "assistant", "{bad-json", Date.now());

    const result = await getSessionUsageStats(sessionId);

    expect(result.messageCount).toBe(4);
    expect(result.inputTokens).toBe(123);
    expect(result.outputTokens).toBe(45);
    expect(result.toolCallCount).toBe(2);
    expect(result.lastUpdated).toBe(new Date(updatedAt).toISOString());
  });

  test("global 视图和全局聚合统计返回总量", async () => {
    insertSession("ses_a", "A", { input: 10, output: 5 });
    insertSession("ses_b", "B", { input: 20, output: 8 });

    insertMessage("msg_a1", "ses_a", "user", [{ content: "one", type: "text" }]);
    insertMessage("msg_b1", "ses_b", "user", [{ content: "two", type: "text" }]);
    insertMessage("msg_b2", "ses_b", "assistant", [{ content: "answer", type: "text" }]);
    insertMessage("msg_b3", "ses_b", "assistant", [
      { content: '{"cmd":"pwd"}', tool_name: "bash", tool_use_id: "call_2", type: "tool_use" },
    ]);

    const globalStats = getGlobalUsageStats();
    const globalSession = await getSessionUsageStats("global");

    expect(globalStats).toEqual({
      messageCount: 4,
      sessionCount: 2,
      totalInputTokens: 30,
      totalOutputTokens: 13,
      totalToolCalls: 1,
    });
    expect(globalSession.sessionId).toBe("global");
    expect(globalSession.messageCount).toBe(4);
    expect(globalSession.inputTokens).toBe(30);
    expect(globalSession.outputTokens).toBe(13);
    expect(globalSession.toolCallCount).toBe(1);
  });
});
