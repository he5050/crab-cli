/**
 * 审批存储测试。
 *
 * 测试用例:
 *   - 审批记录存储
 *   - 审批查询
 *   - 审批过期处理
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { closeDb, initDb, resetDb } from "@/db";
import {
  cleanExpired,
  clearAllApprovals,
  deleteApproval,
  getAllApprovals,
  getApproval,
  saveApproval,
} from "@/permission/store/approvalStore";
import { cleanupTestDir, createGlobalTmpTestDir } from "../../helpers/testPaths";

let testDir: string;
let testDbPath: string;

beforeEach(() => {
  testDir = createGlobalTmpTestDir("crab-test-approval-");
  testDbPath = join(testDir, "test.db");
  resetDb();
  initDb(testDbPath);
});

afterEach(() => {
  closeDb();
  resetDb();
  cleanupTestDir(testDir);
});

describe("ApprovalStore (unified DB)", () => {
  test("保存与获取审批", () => {
    saveApproval({
      decision: "allow",
      expiresAt: null,
      pattern: "ls",
      permission: "bash",
      sessionId: "test-session",
      timestamp: Date.now(),
    });

    const record = getApproval("bash", "ls");
    expect(record).not.toBeNull();
    expect(record!.permission).toBe("bash");
    expect(record!.pattern).toBe("ls");
    expect(record!.decision).toBe("allow");
    expect(record!.sessionId).toBe("test-session");
  });

  test("get non-existent approval returns null", () => {
    const record = getApproval("bash", "nonexistent");
    expect(record).toBeNull();
  });

  test("expired approval is not returned", () => {
    const pastTime = Date.now() - 60_000;
    saveApproval({
      decision: "allow",
      expiresAt: pastTime + 30_000,
      pattern: "rm",
      permission: "bash",
      sessionId: "test-session",
      timestamp: pastTime,
    });

    const record = getApproval("bash", "rm");
    expect(record).toBeNull();
  });

  test("无 expiresAt 的审批永不过期", () => {
    const pastTime = Date.now() - 86_400_000;
    saveApproval({
      decision: "allow",
      expiresAt: null,
      pattern: "cat",
      permission: "bash",
      sessionId: "test-session",
      timestamp: pastTime,
    });

    const record = getApproval("bash", "cat");
    expect(record).not.toBeNull();
    expect(record!.decision).toBe("allow");
  });

  test("删除审批", () => {
    saveApproval({
      decision: "allow",
      expiresAt: null,
      pattern: "echo",
      permission: "bash",
      sessionId: "test-session",
      timestamp: Date.now(),
    });

    const record = getApproval("bash", "echo");
    expect(record).not.toBeNull();

    deleteApproval(record!.id);
    const afterDelete = getApproval("bash", "echo");
    expect(afterDelete).toBeNull();
  });

  test("清空所有审批", () => {
    saveApproval({
      decision: "allow",
      expiresAt: null,
      pattern: "cmd1",
      permission: "bash",
      sessionId: "s1",
      timestamp: Date.now(),
    });
    saveApproval({
      decision: "deny",
      expiresAt: null,
      pattern: "cmd2",
      permission: "bash",
      sessionId: "s2",
      timestamp: Date.now(),
    });

    expect(getAllApprovals()).toHaveLength(2);
    clearAllApprovals();
    expect(getAllApprovals()).toHaveLength(0);
  });

  test("获取全部审批通过会话", () => {
    saveApproval({
      decision: "allow",
      expiresAt: null,
      pattern: "cmd1",
      permission: "bash",
      sessionId: "s1",
      timestamp: Date.now(),
    });
    saveApproval({
      decision: "deny",
      expiresAt: null,
      pattern: "cmd2",
      permission: "bash",
      sessionId: "s2",
      timestamp: Date.now(),
    });

    const s1Approvals = getAllApprovals("s1");
    expect(s1Approvals).toHaveLength(1);
    expect(s1Approvals[0]!.sessionId).toBe("s1");

    const allApprovals = getAllApprovals();
    expect(allApprovals).toHaveLength(2);
  });

  test("清理过期审批", () => {
    const now = Date.now();
    saveApproval({
      decision: "allow",
      expiresAt: now - 50_000,
      pattern: "expired",
      permission: "bash",
      sessionId: "s1",
      timestamp: now - 100_000,
    });
    saveApproval({
      decision: "allow",
      expiresAt: now + 50_000,
      pattern: "valid",
      permission: "bash",
      sessionId: "s1",
      timestamp: now,
    });
    saveApproval({
      decision: "allow",
      expiresAt: null,
      pattern: "permanent",
      permission: "bash",
      sessionId: "s1",
      timestamp: now,
    });

    const cleaned = cleanExpired();
    expect(cleaned).toBe(1);
    expect(getAllApprovals()).toHaveLength(2);
  });

  test("latest approval is returned when multiple exist", () => {
    const now = Date.now();
    saveApproval({
      decision: "deny",
      expiresAt: null,
      pattern: "cmd",
      permission: "bash",
      sessionId: "s1",
      timestamp: now - 1000,
    });
    saveApproval({
      decision: "allow",
      expiresAt: null,
      pattern: "cmd",
      permission: "bash",
      sessionId: "s1",
      timestamp: now,
    });

    const record = getApproval("bash", "cmd");
    expect(record).not.toBeNull();
    expect(record!.decision).toBe("allow");
  });

  test("deny approval is persisted", () => {
    saveApproval({
      decision: "deny",
      expiresAt: null,
      pattern: "rm -rf",
      permission: "bash",
      sessionId: "s1",
      timestamp: Date.now(),
    });

    const record = getApproval("bash", "rm -rf");
    expect(record).not.toBeNull();
    expect(record!.decision).toBe("deny");
  });

  test("approvals 表与 sessions/messages 共存", () => {
    // 验证审批记录和会话记录可以在同一数据库中共存
    const { createSession } = require("@session") as typeof import("@session");
    const msgModule = require("@session") as typeof import("@session");

    const s = createSession({ title: "共存测试" });
    msgModule.addTextMessage(s.id, "user", "你好");

    saveApproval({
      decision: "allow",
      expiresAt: null,
      pattern: "ls",
      permission: "bash",
      sessionId: s.id,
      timestamp: Date.now(),
    });

    const record = getApproval("bash", "ls");
    expect(record).not.toBeNull();
    expect(record!.sessionId).toBe(s.id);
  });
});
