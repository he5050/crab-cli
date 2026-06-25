/**
 * 会话快照测试。
 *
 * 测试用例:
 *   - 创建快照
 *   - 恢复快照
 *   - 列出快照
 *   - 删除快照
 *   - 快照差异对比
 */
import { describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import { createSnapshot, deleteSnapshot, diffSnapshots, listSnapshots, restoreSnapshot } from "@/session";
import type { MessageRecord } from "@/session/type";

const MOCK_MESSAGES = [
  { content: "hello", role: "user", timestamp: Date.now() - 1000 },
  { content: "hi there", role: "assistant", timestamp: Date.now() },
];

describe("会话快照 (snapshot)", () => {
  test("createSnapshot 创建快照并返回元数据", async () => {
    const snap = await createSnapshot("sess-test", MOCK_MESSAGES, "测试快照");
    expect(snap.id).toMatch(/^snap_/);
    expect(snap.label).toBe("测试快照");
    expect(snap.sessionId).toBe("sess-test");
    expect(snap.messageCount).toBe(2);
    expect(snap.messages).toHaveLength(2);
    await deleteSnapshot(snap.id);
  });

  test("restoreSnapshot 恢复已创建的快照", async () => {
    const snap = await createSnapshot("sess-restore", MOCK_MESSAGES);
    const restored = await restoreSnapshot(snap.id);
    expect(restored).not.toBeNull();
    expect(restored!.id).toBe(snap.id);
    expect(restored!.messages).toHaveLength(2);
    await deleteSnapshot(snap.id);
  });

  test("restoreSnapshot 对不存在的快照返回 null", async () => {
    const result = await restoreSnapshot("snap_nonexistent_000");
    expect(result).toBeNull();
  });

  test("listSnapshots 列出快照", async () => {
    const snap = await createSnapshot("sess-list", MOCK_MESSAGES, "列表测试");
    const list = await listSnapshots("sess-list");
    expect(list.length).toBeGreaterThanOrEqual(1);
    const found = list.find((s) => s.id === snap.id);
    expect(found).toBeDefined();
    expect(found!.label).toBe("列表测试");
    await deleteSnapshot(snap.id);
  });

  test("deleteSnapshot 删除快照", async () => {
    const snap = await createSnapshot("sess-del", MOCK_MESSAGES);
    const ok = await deleteSnapshot(snap.id);
    expect(ok).toBe(true);
    const restored = await restoreSnapshot(snap.id);
    expect(restored).toBeNull();
  });

  test("deleteSnapshot 对不存在的快照返回 false", async () => {
    const ok = await deleteSnapshot("snap_nonexistent_000");
    expect(ok).toBe(false);
  });

  test("diffSnapshots 对比两个快照", async () => {
    const baseTime = Date.now();
    const msgsA: MessageRecord[] = [
      {
        createdAt: baseTime,
        id: "msg_diff_user_1",
        parts: [{ content: "hello", type: "text" }],
        role: "user",
        sessionId: "sess-diff",
      },
    ];
    const msgsB: MessageRecord[] = [
      ...msgsA,
      {
        createdAt: baseTime + 1,
        id: "msg_diff_assistant_1",
        parts: [{ content: "world", type: "text" }],
        role: "assistant",
        sessionId: "sess-diff",
      },
    ];
    const snapA = await createSnapshot("sess-diff", msgsA, "A");
    const snapB = await createSnapshot("sess-diff", msgsB, "B");

    const diff = await diffSnapshots(snapA.id, snapB.id);
    expect(diff).not.toBeNull();
    expect(diff!.added).toBe(1);
    expect(diff!.removed).toBe(0);

    await deleteSnapshot(snapA.id);
    await deleteSnapshot(snapB.id);
  });

  test("diffSnapshots 对不存在的快照返回 null", async () => {
    const diff = await diffSnapshots("snap_no_a", "snap_no_b");
    expect(diff).toBeNull();
  });
});
