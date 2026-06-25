/**
 * P2-6: 跨会话回滚闭环测试
 *
 * 覆盖:
 *   - 压缩分支点 replace 恢复当前会话消息
 *   - 压缩分支点 fork 创建新会话并恢复压缩前消息
 *   - 原始会话不存在时给出明确错误
 *   - compactSession 在压缩前创建 checkpoint
 */
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { cleanupTestDir, createGlobalTmpTestDir } from "../../helpers/testPaths";
import { DEFAULT_CONFIG } from "@/config";
import { defaultCompressor } from "@/compress/core/compressor";
import { compactSession } from "@/compress/core/compressService";
import { type CompactionBranchPoint, saveBranchPoint } from "@/tool/rollback/branchPoints";
import { rollbackToBranchPoint } from "@/tool/rollback/crossSession";
import { createSession, getSession, addTextMessage, getSessionMessages, getCheckpoint } from "@/session";

let testDir: string;
let testDbPath: string;
const repoRoot = process.cwd();

function cleanBranchPoints(projectDir = testDir): void {
  fs.rmSync(path.join(projectDir, ".crab", "branch-points"), { force: true, recursive: true });
}

function makeBranchPoint(sessionId: string, id = `bp-${sessionId}-test`): CompactionBranchPoint {
  return {
    afterState: {
      messages: [{ content: "[上下文压缩摘要]", role: "user" }],
      summary: "摘要",
    },
    beforeState: {
      compressedMessages: [{ content: "压缩前用户消息", role: "user" }],
      messages: [
        { content: "压缩前用户消息", role: "user" },
        { content: "压缩前助手回复", role: "assistant" },
      ],
      rollbackEntries: [],
      splitIndex: 1,
    },
    compactionIndex: 0,
    id,
    metadata: {
      compressionRatio: 0.2,
      originalSessionId: sessionId,
      preCompressionCheckpointId: "chk_pre_compression",
      totalTokensAfter: 20,
      totalTokensBefore: 100,
    },
    sessionId,
    timestamp: Date.now(),
  };
}

beforeEach(() => {
  testDir = createGlobalTmpTestDir("crab-cross-rollback-");
  testDbPath = path.join(testDir, "test.db");
  process.chdir(testDir);
  const db = require("@/db") as typeof import("@/db");
  db.resetDb();
  db.initDb(testDbPath);
  cleanBranchPoints();
});

afterEach(() => {
  mock.restore();
  const db = require("@/db") as typeof import("@/db");
  db.closeDb();
  cleanBranchPoints();
  process.chdir(repoRoot);
  cleanupTestDir(testDir);
});

describe("P2-6 cross-session rollback", () => {
  test("replace 会把当前会话恢复到压缩前完整消息", async () => {
    const session = createSession({ title: "replace-session" });
    addTextMessage(session.id, "user", "[上下文压缩摘要]");
    await saveBranchPoint(makeBranchPoint(session.id, "bp-replace"));

    const result = await rollbackToBranchPoint("bp-replace", "replace");

    expect(result.success).toBe(true);
    expect(result.targetSessionId).toBe(session.id);
    expect(result.restoredMessages.before).toBe(2);
    const messages = getSessionMessages(session.id);
    expect(messages).toHaveLength(2);
    expect((messages[0]!.parts[0] as { content: string }).content).toBe("压缩前用户消息");
    expect((messages[1]!.parts[0] as { content: string }).content).toBe("压缩前助手回复");
  });

  test("fork 会创建新会话并恢复压缩前消息，不覆盖原会话", async () => {
    const session = createSession({ title: "fork-session" });
    addTextMessage(session.id, "user", "[上下文压缩摘要]");
    await saveBranchPoint(makeBranchPoint(session.id, "bp-fork"));

    const result = await rollbackToBranchPoint("bp-fork", "fork");

    expect(result.success).toBe(true);
    expect(result.sourceSessionId).toBe(session.id);
    expect(result.targetSessionId).not.toBe(session.id);
    expect(getSession(result.targetSessionId)?.parentId).toBe(session.id);
    expect(getSessionMessages(session.id)).toHaveLength(1);
    const forkMessages = getSessionMessages(result.targetSessionId);
    expect(forkMessages).toHaveLength(2);
    expect((forkMessages[0]!.parts[0] as { content: string }).content).toBe("压缩前用户消息");
  });

  test("原始会话不存在时返回明确错误", async () => {
    await saveBranchPoint(makeBranchPoint("ses_missing_original", "bp-missing-session"));

    await expect(rollbackToBranchPoint("bp-missing-session", "replace")).rejects.toThrow("原始会话不存在");
  });

  test("compactSession 会在压缩前创建 checkpoint", async () => {
    const session = createSession({ title: "compact-checkpoint" });
    addTextMessage(session.id, "user", "消息1");
    addTextMessage(session.id, "assistant", "回复1");
    addTextMessage(session.id, "user", "消息2");
    addTextMessage(session.id, "assistant", "回复2");

    spyOn(defaultCompressor, "compressWithAI").mockResolvedValue({
      compressedTokens: 20,
      compressionRatio: 0.2,
      messagesRemoved: 2,
      originalTokens: 100,
      summary: "压缩摘要",
    } as any);

    const result = await compactSession(session.id, DEFAULT_CONFIG);

    expect(result.ok).toBe(true);
    expect(result.preCompressionCheckpointId).toMatch(/^chk_/);
    const checkpoint = getCheckpoint(result.preCompressionCheckpointId!);
    expect(checkpoint).not.toBeNull();
    expect(checkpoint!.label).toBe("pre-compression");
    expect(checkpoint!.snapshot).toHaveLength(4);
  });
});
