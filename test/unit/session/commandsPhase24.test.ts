/**
 * Phase 24 命令测试。
 *
 * 测试用例:
 *   - /share 命令注册
 *   - /snapshot 命令注册
 *   - /summarize 命令注册
 *   - 命令分类和属性
 */
import { afterEach, describe, expect, mock, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAppCommands } from "@/commandPalette/appCommands";
import { getCommandRegistry } from "@/commandPalette/registry";
import { globalBus } from "@/bus";
import { AppEvent } from "@/bus";
import type { CompactionBranchPoint } from "@/tool/rollback/branchPoints";

afterEach(() => {
  mock.restore();
});

describe("Phase 24 命令注册", () => {
  const deps = {
    back: () => {},
    navigate: () => {},
    requestExit: () => {},
  };

  test("/share 命令已注册", () => {
    const commands = createAppCommands(deps);
    const share = commands.find((c) => c.name === "session.share");
    expect(share).toBeDefined();
    expect(share!.slashName).toBe("share");
    expect(share!.category).toContain("会话");
  });

  test("/snapshot 命令已注册", () => {
    const commands = createAppCommands(deps);
    const snapshot = commands.find((c) => c.name === "session.snapshot");
    expect(snapshot).toBeDefined();
    expect(snapshot!.slashName).toBe("snapshot");
    expect(snapshot!.category).toContain("会话");
  });

  test("/summarize 命令已注册", () => {
    const commands = createAppCommands(deps);
    const summarize = commands.find((c) => c.name === "session.summarize");
    expect(summarize).toBeDefined();
    expect(summarize!.slashName).toBe("summarize");
    expect(summarize!.category).toContain("会话");
  });

  test("/rollback 命令已注册", () => {
    const commands = createAppCommands({
      ...deps,
      getCurrentSessionId: () => "ses_phase24",
      showToast: () => {},
    } as any);
    const rollback = commands.find((c) => c.name === "session.rollback");
    expect(rollback).toBeDefined();
    expect(rollback!.slashName).toBe("rollback");
    expect(rollback!.category).toContain("会话");
  });

  test("Phase 24 命令均为 suggested", () => {
    const commands = createAppCommands(deps);
    const phase24 = commands.filter(
      (c) =>
        c.name === "session.share" ||
        c.name === "session.snapshot" ||
        c.name === "session.summarize" ||
        c.name === "session.rollback",
    );
    expect(phase24).toHaveLength(4);
    for (const cmd of phase24) {
      if (cmd.name !== "session.rollback") {
        expect(cmd.suggested).toBe(true);
      }
    }
  });

  test("/snapshot create 与 /rollback restore 走 checkpoint 后端", async () => {
    const createCheckpoint = mock(() => ({
      createdAt: Date.now(),
      id: "chk_12345678",
      label: "checkpoint-label",
      messageIndex: 3,
      sessionId: "ses_phase24",
      snapshot: [],
    }));
    const getCheckpoint = mock(() => ({
      createdAt: Date.now(),
      id: "chk_12345678",
      label: "checkpoint-label",
      messageIndex: 3,
      sessionId: "ses_phase24",
      snapshot: [],
    }));
    const restoreCheckpoint = mock(() => []);
    const listCheckpoints = mock(() => []);
    const deleteCheckpoint = mock(() => true);
    const compareCheckpoints = mock(() => ({ added: 1, modified: 0, removed: 0, total1: 1, total2: 2 }));

    const toasts: string[] = [];
    const commands = createAppCommands({
      ...deps,
      getCurrentSessionId: () => "ses_phase24",
      sessionApi: {
        compareCheckpoints,
        createCheckpoint,
        deleteCheckpoint,
        getCheckpoint,
        listCheckpoints,
        restoreCheckpoint,
      },
      showToast: (msg: string) => toasts.push(msg),
    } as any);

    const snapshot = commands.find((c) => c.name === "session.snapshot")!;
    const rollback = commands.find((c) => c.name === "session.rollback")!;

    await snapshot.run("create checkpoint-label");
    await rollback.run("chk_12345678");

    expect(createCheckpoint).toHaveBeenCalledWith("ses_phase24", "checkpoint-label");
    expect(getCheckpoint).toHaveBeenCalledWith("chk_12345678");
    expect(restoreCheckpoint).toHaveBeenCalledWith("chk_12345678");
    expect(toasts.some((msg) => msg.includes("快照已创建"))).toBe(true);
    expect(toasts.some((msg) => msg.includes("已回滚到检查点"))).toBe(true);
  });

  test("/rollback 列表输出包含压缩分支点的 fork/replace 可执行命令", async () => {
    const listCheckpoints = mock(() => [
      {
        createdAt: Date.now(),
        id: "chk_phase24_rollback",
        label: "manual-checkpoint",
        messageIndex: 3,
        sessionId: "ses_phase24",
        snapshot: [],
      },
    ]);
    const branchPoint: CompactionBranchPoint = {
      afterState: { messages: [{ content: "summary", role: "system" }], summary: "summary" },
      beforeState: { messages: [{ content: "before", role: "user" }], rollbackEntries: [], splitIndex: 0 },
      compactionIndex: 1,
      id: "bp_phase24_rollback",
      metadata: {
        compressionRatio: 0.4,
        originalSessionId: "ses_phase24",
        preCompressionCheckpointId: "chk_pre_phase24",
        totalTokensAfter: 40,
        totalTokensBefore: 100,
      },
      sessionId: "ses_phase24",
      timestamp: Date.now(),
    };
    const listRollableBranchPoints = mock(async () => [branchPoint]);
    const rollbackToBranchPoint = mock(async () => undefined);

    const toasts: string[] = [];
    const commands = createAppCommands({
      ...deps,
      getCurrentSessionId: () => "ses_phase24",
      rollbackApi: {
        listRollableBranchPoints,
        rollbackToBranchPoint,
      },
      sessionApi: {
        getCheckpoint: mock(() => null),
        listCheckpoints,
        restoreCheckpoint: mock(() => null),
      },
      showToast: (msg: string) => toasts.push(msg),
    } as any);

    const rollback = commands.find((c) => c.name === "session.rollback")!;

    await rollback.run();
    await rollback.run("branch");

    expect(listRollableBranchPoints).toHaveBeenCalledWith("ses_phase24");
    expect(toasts.some((msg) => msg.includes("可恢复点:"))).toBe(true);
    expect(toasts.some((msg) => msg.includes("checkpoint chk_phase24_"))).toBe(true);
    expect(toasts.some((msg) => msg.includes("ratio=40%"))).toBe(true);
    expect(toasts.some((msg) => msg.includes("/rollback branch bp_phase24_rollback fork"))).toBe(true);
    expect(toasts.some((msg) => msg.includes("/rollback branch bp_phase24_rollback replace"))).toBe(true);
    expect(rollbackToBranchPoint).not.toHaveBeenCalled();
  });

  test("/share 使用当前会话历史而不是空数组", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "crab-share-test-"));
    const originalXdg = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = tempDir;
    const commands = createAppCommands({
      ...deps,
      getConversationHistory: () => [
        { content: "分享这段会话", role: "user" },
        { content: "好的，开始分享。", role: "assistant" },
      ],
      getCurrentSessionId: () => undefined,
      showToast: () => {},
    } as any);

    const share = commands.find((c) => c.name === "session.share")!;
    const events: { sessionId: string; format: string; path: string }[] = [];
    const unsub = globalBus.subscribe(AppEvent.SessionShared, (evt) => {
      events.push(evt.properties);
    });
    try {
      await share.run("json");
      expect(events).toHaveLength(1);
      expect(events[0]!.format).toBe("json");
      expect(fs.existsSync(events[0]!.path)).toBe(true);
      const exported = JSON.parse(fs.readFileSync(events[0]!.path, "utf8"));
      expect(exported.messageCount).toBe(2);
    } finally {
      unsub();
      process.env.XDG_DATA_HOME = originalXdg;
      fs.rmSync(tempDir, { force: true, recursive: true });
    }
  });

  test("/summarize 使用当前会话历史生成摘要", async () => {
    const commands = createAppCommands({
      ...deps,
      getConfig: () => ({ defaultProvider: { model: "test", provider: "test" }, providerConfig: {} }),
      getConversationHistory: () => [
        { content: "总结一下", role: "user" },
        { content: "这里是上下文", role: "assistant" },
      ],
      getCurrentSessionId: () => undefined,
      showToast: () => {},
    } as any);

    const summarize = commands.find((c) => c.name === "session.summarize")!;
    const events: { charCount: number; messageCount: number }[] = [];
    const unsub = globalBus.subscribe(AppEvent.SessionSummarized, (evt) => {
      events.push(evt.properties);
    });
    try {
      await summarize.run();
      expect(events).toHaveLength(1);
      expect(events[0]!.messageCount).toBe(2);
      expect(events[0]!.charCount).toBeGreaterThan(0);
    } finally {
      unsub();
    }
  });
});
