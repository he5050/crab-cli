// @ts-nocheck
/**
 * Agent 状态持久化测试。
 *
 * 覆盖导出:
 *   - saveAgentState
 *   - loadAgentState
 *   - clearAgentState
 *   - findRecoverableSessions
 *   - cleanupExpiredStates
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getRawDb, initDb, resetDb } from "@/db/index";
import { cleanupTestDir, createGlobalTmpTestDir } from "../../helpers/testPaths";
import { join } from "node:path";
import {
  cleanupExpiredStates,
  clearAgentState,
  findRecoverableSessions,
  loadAgentState,
  saveAgentState,
} from "@/agent/core/state";

function insertSession(id: string, opts: Record<string, unknown> = {}) {
  const rawDb = getRawDb()!;
  const now = Date.now();
  rawDb.run(
    `INSERT INTO sessions (id, title, status, agent_state_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      opts.title ?? "Test Session",
      opts.status ?? "active",
      opts.agentStateJson ?? null,
      opts.createdAt ?? now,
      opts.updatedAt ?? now,
    ],
  );
}

function createMockState(overrides: Record<string, unknown> = {}) {
  return {
    activeSkillContext: "coding",
    allowedTools: ["bash", "read"],
    modelId: "gpt-4o",
    providerId: "openai",
    recentToolCalls: [{ args: '{"command":"ls"}', toolName: "bash" }],
    recoveredFrom: false,
    sessionActiveSkills: ["fix-bug"],
    sessionAllowedExternalTools: ["apifox_export_openapi"],
    sessionDiscoveredSkills: ["gsd-verify-work"],
    sessionLoadedSkills: ["write-test"],
    systemPrompt: "You are a helpful assistant.",
    temperature: 0.7,
    topP: 1,
    ...overrides,
  };
}

describe("Agent 状态持久化", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = createGlobalTmpTestDir("crab-agent-state-test-");
    dbPath = join(tempDir, "test.db");
    resetDb();
    initDb(dbPath);
  });

  afterEach(() => {
    resetDb();
    try {
      cleanupTestDir(tempDir);
    } catch {}
  });

  describe("saveAgentState", () => {
    test("保存状态到 DB", () => {
      const sessionId = "ses_save_test";
      insertSession(sessionId);

      const state = createMockState();
      saveAgentState(sessionId, state);

      const rawDb = getRawDb()!;
      const row = rawDb.query("SELECT agent_state_json FROM sessions WHERE id = ?").get(sessionId) as any;
      expect(row).toBeDefined();
      expect(row.agent_state_json).toBeDefined();

      const parsed = JSON.parse(row.agent_state_json);
      expect(parsed.modelId).toBe("gpt-4o");
      expect(parsed.systemPrompt).toBe("You are a helpful assistant.");
      expect(parsed.sessionDiscoveredSkills).toEqual(["gsd-verify-work"]);
      expect(parsed.sessionActiveSkills).toEqual(["fix-bug"]);
      expect(parsed.sessionLoadedSkills).toEqual(["write-test"]);
      expect(parsed.sessionAllowedExternalTools).toEqual(["apifox_export_openapi"]);
      expect(parsed.savedAt).toBeGreaterThan(0);
    });

    test("自动设置 savedAt 时间戳", () => {
      const sessionId = "ses_save_timestamp";
      insertSession(sessionId);

      const before = Date.now();
      saveAgentState(sessionId, createMockState());
      const after = Date.now();

      const rawDb = getRawDb()!;
      const row = rawDb.query("SELECT agent_state_json FROM sessions WHERE id = ?").get(sessionId) as any;
      const parsed = JSON.parse(row.agent_state_json);
      expect(parsed.savedAt).toBeGreaterThanOrEqual(before);
      expect(parsed.savedAt).toBeLessThanOrEqual(after);
    });

    test("更新 updatedAt", () => {
      const sessionId = "ses_save_updated";
      const oldTime = Date.now() - 100_000;
      insertSession(sessionId, { updatedAt: oldTime });

      saveAgentState(sessionId, createMockState());

      const rawDb = getRawDb()!;
      const row = rawDb.query("SELECT updated_at FROM sessions WHERE id = ?").get(sessionId) as any;
      expect(row.updated_at).toBeGreaterThan(oldTime);
    });

    test("会话不存在时静默跳过", () => {
      const state = createMockState();
      expect(() => saveAgentState("ses_nonexistent", state)).not.toThrow();
    });
  });

  describe("loadAgentState", () => {
    test("加载已保存的状态", () => {
      const sessionId = "ses_load_test";
      const state = createMockState();
      insertSession(sessionId, {
        agentStateJson: JSON.stringify({ ...state, savedAt: Date.now() }),
      });

      const loaded = loadAgentState(sessionId);
      expect(loaded).not.toBeNull();
      expect(loaded!.modelId).toBe("gpt-4o");
      expect(loaded!.systemPrompt).toBe("You are a helpful assistant.");
      expect(loaded!.recentToolCalls).toHaveLength(1);
    });

    test("会话无状态返回 null", () => {
      insertSession("ses_no_state");

      const loaded = loadAgentState("ses_no_state");
      expect(loaded).toBeNull();
    });

    test("会话不存在返回 null", () => {
      const loaded = loadAgentState("ses_ghost");
      expect(loaded).toBeNull();
    });

    test("过期状态返回 null", () => {
      const sessionId = "ses_expired";
      const expiredState = createMockState({ savedAt: Date.now() - 25 * 60 * 60 * 1000 });
      insertSession(sessionId, {
        agentStateJson: JSON.stringify(expiredState),
      });

      const loaded = loadAgentState(sessionId);
      expect(loaded).toBeNull();
    });

    test("未过期状态正常返回", () => {
      const sessionId = "ses_fresh";
      const freshState = createMockState({ savedAt: Date.now() - 60 * 1000 });
      insertSession(sessionId, {
        agentStateJson: JSON.stringify(freshState),
      });

      const loaded = loadAgentState(sessionId);
      expect(loaded).not.toBeNull();
      expect(loaded!.modelId).toBe("gpt-4o");
    });
  });

  describe("clearAgentState", () => {
    test("清除已保存的状态", () => {
      const sessionId = "ses_clear_test";
      insertSession(sessionId, {
        agentStateJson: JSON.stringify(createMockState()),
      });

      clearAgentState(sessionId);

      const rawDb = getRawDb()!;
      const row = rawDb.query("SELECT agent_state_json FROM sessions WHERE id = ?").get(sessionId) as any;
      expect(row.agent_state_json).toBeNull();
    });

    test("清除不存在的会话不报错", () => {
      expect(() => clearAgentState("ses_clear_ghost")).not.toThrow();
    });
  });

  describe("findRecoverableSessions", () => {
    test("返回 active + 有状态的会话", () => {
      const sessionId = "ses_recoverable";
      insertSession(sessionId, {
        agentStateJson: JSON.stringify(createMockState()),
        status: "active",
      });

      const list = findRecoverableSessions();
      const found = list.find((r) => r.sessionId === sessionId);
      expect(found).toBeDefined();
      expect(found!.status).toBe("active");
    });

    test("返回 paused + 有状态的会话", () => {
      const sessionId = "ses_paused_recover";
      insertSession(sessionId, {
        agentStateJson: JSON.stringify(createMockState()),
        status: "paused",
      });

      const list = findRecoverableSessions();
      const found = list.find((r) => r.sessionId === sessionId);
      expect(found).toBeDefined();
      expect(found!.status).toBe("paused");
    });

    test("排除 completed 状态", () => {
      insertSession("ses_completed", {
        agentStateJson: JSON.stringify(createMockState()),
        status: "completed",
      });

      const list = findRecoverableSessions();
      const found = list.find((r) => r.sessionId === "ses_completed");
      expect(found).toBeUndefined();
    });

    test("排除无状态的会话", () => {
      insertSession("ses_no_json", { status: "active" });

      const list = findRecoverableSessions();
      const found = list.find((r) => r.sessionId === "ses_no_json");
      expect(found).toBeUndefined();
    });

    test("排除过期会话", () => {
      const sessionId = "ses_old";
      insertSession(sessionId, {
        agentStateJson: JSON.stringify(createMockState()),
        status: "active",
        updatedAt: Date.now() - 25 * 60 * 60 * 1000,
      });

      const list = findRecoverableSessions();
      const found = list.find((r) => r.sessionId === sessionId);
      expect(found).toBeUndefined();
    });

    test("排除无效 JSON 的会话", () => {
      insertSession("ses_bad_json", {
        agentStateJson: "not-valid-json{{{",
        status: "active",
      });

      const list = findRecoverableSessions();
      const found = list.find((r) => r.sessionId === "ses_bad_json");
      expect(found).toBeUndefined();
    });

    test("返回字段包含 sessionId、title、savedAt、status", () => {
      insertSession("ses_fields", {
        agentStateJson: JSON.stringify(createMockState()),
        status: "active",
        title: "My Agent Task",
      });

      const list = findRecoverableSessions();
      const found = list.find((r) => r.sessionId === "ses_fields");
      expect(found).toBeDefined();
      expect(found!.title).toBe("My Agent Task");
      expect(found!.savedAt).toBeGreaterThan(0);
      expect(found!.status).toBe("active");
      expect(found).not.toHaveProperty("agentStateJson");
    });
  });

  describe("cleanupExpiredStates", () => {
    test("清理过期会话并返回计数", () => {
      insertSession("ses_expire_1", {
        agentStateJson: JSON.stringify(createMockState()),
        status: "active",
        updatedAt: Date.now() - 25 * 60 * 60 * 1000,
      });
      insertSession("ses_expire_2", {
        agentStateJson: JSON.stringify(createMockState()),
        status: "paused",
        updatedAt: Date.now() - 48 * 60 * 60 * 1000,
      });

      const cleaned = cleanupExpiredStates();
      expect(cleaned).toBe(2);

      const rawDb = getRawDb()!;
      const r1 = rawDb.query("SELECT status, agent_state_json FROM sessions WHERE id = ?").get("ses_expire_1") as any;
      expect(r1.status).toBe("completed");
      expect(r1.agent_state_json).toBeNull();

      const r2 = rawDb.query("SELECT status, agent_state_json FROM sessions WHERE id = ?").get("ses_expire_2") as any;
      expect(r2.status).toBe("completed");
      expect(r2.agent_state_json).toBeNull();
    });

    test("不清理未过期会话", () => {
      insertSession("ses_fresh_cleanup", {
        agentStateJson: JSON.stringify(createMockState()),
        status: "active",
      });

      const cleaned = cleanupExpiredStates();
      expect(cleaned).toBe(0);

      const rawDb = getRawDb()!;
      const row = rawDb.query("SELECT status FROM sessions WHERE id = ?").get("ses_fresh_cleanup") as any;
      expect(row.status).toBe("active");
    });

    test("不清理无 agent_state_json 的会话", () => {
      insertSession("ses_no_json_cleanup", {
        status: "active",
        updatedAt: Date.now() - 30 * 60 * 60 * 1000,
      });

      const cleaned = cleanupExpiredStates();
      expect(cleaned).toBe(0);
    });

    test("不清理 completed 状态的会话", () => {
      insertSession("ses_already_done", {
        agentStateJson: JSON.stringify(createMockState()),
        status: "completed",
        updatedAt: Date.now() - 30 * 60 * 60 * 1000,
      });

      const cleaned = cleanupExpiredStates();
      expect(cleaned).toBe(0);
    });

    test("无过期记录时返回 0", () => {
      const cleaned = cleanupExpiredStates();
      expect(cleaned).toBe(0);
    });
  });

  describe("恢复流程集成", () => {
    test("启动检测→弹窗→恢复→清除完整流程", () => {
      // 1. 创建可恢复会话
      const sessionId = "ses_integration_recovery";
      insertSession(sessionId, {
        agentStateJson: JSON.stringify({
          ...createMockState(),
          recentToolCalls: [
            { args: '{"command":"ls"}', toolName: "bash" },
            { args: '{"command":"ls"}', toolName: "bash" },
            { args: '{"command":"ls"}', toolName: "bash" },
            { args: '{"command":"ls"}', toolName: "bash" },
            { args: '{"command":"ls"}', toolName: "bash" },
          ],
        }),
        status: "active",
        title: "Recovery Test Session",
      });

      // 2. findRecoverableSessions 应该找到它
      const recoverable = findRecoverableSessions();
      const found = recoverable.find((r) => r.sessionId === sessionId);
      expect(found).toBeDefined();
      expect(found!.title).toBe("Recovery Test Session");
      expect(found!.status).toBe("active");

      // 3. loadAgentState 应该返回完整状态
      const loaded = loadAgentState(sessionId);
      expect(loaded).not.toBeNull();
      expect(loaded!.recentToolCalls).toHaveLength(5);
      expect(loaded!.modelId).toBe("gpt-4o");
      expect(loaded!.systemPrompt).toBe("You are a helpful assistant.");

      // 4. clearAgentState 清除后不应再被检测到
      clearAgentState(sessionId);
      const afterClear = findRecoverableSessions();
      const afterFound = afterClear.find((r) => r.sessionId === sessionId);
      expect(afterFound).toBeUndefined();
    });

    test("跳过恢复应清除所有可恢复状态", () => {
      const sid1 = "ses_skip_1";
      const sid2 = "ses_skip_2";
      insertSession(sid1, {
        agentStateJson: JSON.stringify(createMockState()),
        status: "active",
        title: "Skip Test 1",
      });
      insertSession(sid2, {
        agentStateJson: JSON.stringify(createMockState()),
        status: "paused",
        title: "Skip Test 2",
      });

      const before = findRecoverableSessions();
      expect(before).toHaveLength(2);

      // 模拟"跳过全部":清除所有
      for (const s of before) {
        clearAgentState(s.sessionId);
      }

      const after = findRecoverableSessions();
      expect(after).toHaveLength(0);
    });
  });

  describe("/pause + /resume 联合恢复流程", () => {
    test("/pause 后会话应可被 findRecoverableSessions 检测到", () => {
      const sessionId = "ses_pause_recoverable";
      insertSession(sessionId, {
        agentStateJson: JSON.stringify(createMockState()),
        status: "paused",
        title: "Paused Session",
      });

      const recoverable = findRecoverableSessions();
      const found = recoverable.find((r) => r.sessionId === sessionId);
      expect(found).toBeDefined();
      expect(found!.status).toBe("paused");
      expect(found!.title).toBe("Paused Session");
    });

    test("/pause 模拟:保存状态 + 设置 paused → 检测 → 恢复 → 清除", () => {
      const sessionId = "ses_pause_roundtrip";
      insertSession(sessionId, { status: "active", title: "Round Trip Test" });

      // 1. 模拟 ConversationHandler 保存状态(/pause 前)
      const state = createMockState({
        activeSkillContext: "debugging",
        recentToolCalls: [
          { args: '{"command":"ls -la"}', toolName: "bash" },
          { args: '{"file":"/tmp/test"}', toolName: "read" },
        ],
      });
      saveAgentState(sessionId, state);

      // 2. 模拟 /pause:设置状态为 paused
      const rawDb = getRawDb()!;
      rawDb.run("UPDATE sessions SET status = ? WHERE id = ?", ["paused", sessionId]);

      // 3. findRecoverableSessions 应能找到
      const recoverable = findRecoverableSessions();
      const found = recoverable.find((r) => r.sessionId === sessionId);
      expect(found).toBeDefined();
      expect(found!.status).toBe("paused");

      // 4. loadAgentState 应返回完整状态
      const loaded = loadAgentState(sessionId);
      expect(loaded).not.toBeNull();
      expect(loaded!.recentToolCalls).toHaveLength(2);
      expect(loaded!.activeSkillContext).toBe("debugging");
      expect(loaded!.sessionDiscoveredSkills).toEqual(["gsd-verify-work"]);
      expect(loaded!.sessionActiveSkills).toEqual(["fix-bug"]);
      expect(loaded!.sessionLoadedSkills).toEqual(["write-test"]);
      expect(loaded!.sessionAllowedExternalTools).toEqual(["apifox_export_openapi"]);
      expect(loaded!.recoveredFrom).toBe(false);

      // 5. 模拟恢复:clearAgentState
      clearAgentState(sessionId);

      // 6. 恢复后不应再被检测到
      const afterRecovery = findRecoverableSessions();
      expect(afterRecovery.find((r) => r.sessionId === sessionId)).toBeUndefined();
    });

    test("/resume 清除状态后，会话不应再出现在恢复列表中", () => {
      const sid1 = "ses_resume_1";
      const sid2 = "ses_resume_2";

      insertSession(sid1, {
        agentStateJson: JSON.stringify(createMockState()),
        status: "paused",
        title: "Resume Target",
      });
      insertSession(sid2, {
        agentStateJson: JSON.stringify(createMockState()),
        status: "active",
        title: "Active Session",
      });

      // 模拟 /resume sid1:清除状态
      clearAgentState(sid1);

      const remaining = findRecoverableSessions();
      expect(remaining.find((r) => r.sessionId === sid1)).toBeUndefined();
      // Sid2 应仍在
      expect(remaining.find((r) => r.sessionId === sid2)).toBeDefined();
    });

    test("多个会话部分恢复:恢复一个不影响其他", () => {
      const sid1 = "ses_multi_1";
      const sid2 = "ses_multi_2";
      const sid3 = "ses_multi_3";

      insertSession(sid1, {
        agentStateJson: JSON.stringify(createMockState({ modelId: "gpt-4o" })),
        status: "paused",
        title: "Multi 1",
      });
      insertSession(sid2, {
        agentStateJson: JSON.stringify(createMockState({ modelId: "claude-3" })),
        status: "active",
        title: "Multi 2",
      });
      insertSession(sid3, {
        agentStateJson: JSON.stringify(createMockState({ modelId: "gemini-pro" })),
        status: "paused",
        title: "Multi 3",
      });

      // 恢复 sid2
      clearAgentState(sid2);

      const remaining = findRecoverableSessions();
      expect(remaining).toHaveLength(2);
      expect(remaining.find((r) => r.sessionId === sid1)).toBeDefined();
      expect(remaining.find((r) => r.sessionId === sid2)).toBeUndefined();
      expect(remaining.find((r) => r.sessionId === sid3)).toBeDefined();

      // 清除全部
      for (const s of remaining) {
        clearAgentState(s.sessionId);
      }
      expect(findRecoverableSessions()).toHaveLength(0);
    });

    test("崩溃恢复场景:active 状态会话未清除 agent_state", () => {
      const sessionId = "ses_crash_recovery";
      insertSession(sessionId, {
        agentStateJson: JSON.stringify(
          createMockState({
            recentToolCalls: Array(10).fill({ args: '{"command":"ls"}', toolName: "bash" }),
          }),
        ),
        status: "active",
        title: "Crashed During Execution",
      });

      // 崩溃后重启:findRecoverableSessions 应能找到
      const recoverable = findRecoverableSessions();
      const found = recoverable.find((r) => r.sessionId === sessionId);
      expect(found).toBeDefined();

      // 状态中应有 doom loop 检测所需的 recentToolCalls
      const loaded = loadAgentState(sessionId);
      expect(loaded!.recentToolCalls).toHaveLength(10);
    });
  });
});
