/**
 * 快照增量模式测试。
 *
 * 测试用例:
 *   - Full 模式: 创建、恢复、列表、删除
 *   - Incremental 模式: 创建增量快照、链式恢复、断裂基链处理
 *   - diffSnapshots: 差异对比与错误处理
 *   - 消息格式归一化: {role, content, timestamp} -> MessageRecord
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSnapshot, deleteSnapshot, diffSnapshots, listSnapshots, restoreSnapshot } from "@/session";
import type { MessageRecord } from "@/session/type";

// ─── 辅助工具 ─────────────────────────────────────────────────

const SESSION_ID = "sess-incremental-test";

/** 创建唯一的 sessionId，避免与其他测试冲突 */
function uniqueSessionId(label: string): string {
  return `${SESSION_ID}-${label}-${Date.now()}`;
}

/** 构造 MessageRecord 消息 */
function makeMessageRecord(id: string, role: "user" | "assistant", content: string, sessionId: string): MessageRecord {
  return {
    id,
    parts: [{ content, type: "text" }],
    role,
    sessionId,
    createdAt: Date.now(),
  };
}

/** 构造简单消息（{role, content, timestamp} 格式） */
function makeSimpleMessage(role: "user" | "assistant", content: string) {
  return { role, content, timestamp: Date.now() };
}

// 用于追踪测试中创建的快照 ID，便于 afterEach 统一清理
const createdSnapshotIds: string[] = [];

beforeEach(() => {
  createdSnapshotIds.length = 0;
});

afterEach(async () => {
  // 清理本测试中创建的所有快照文件
  for (const id of createdSnapshotIds) {
    try {
      await deleteSnapshot(id);
    } catch {
      // 忽略清理失败
    }
  }
});

// ─── Full 模式测试 ────────────────────────────────────────────

describe("快照 Full 模式", () => {
  test("createSnapshot 创建快照并正确存储", async () => {
    const sessionId = uniqueSessionId("full-create");
    const messages = [
      makeMessageRecord("msg_full_1", "user", "hello", sessionId),
      makeMessageRecord("msg_full_2", "assistant", "hi there", sessionId),
    ];

    const snap = await createSnapshot(sessionId, messages, "full 快照");
    createdSnapshotIds.push(snap.id);

    // 验证返回的元数据
    expect(snap.id).toMatch(/^snap_/);
    expect(snap.label).toBe("full 快照");
    expect(snap.sessionId).toBe(sessionId);
    expect(snap.messageCount).toBe(2);
    expect(snap.mode).toBe("full");
    expect(snap.baseSnapshotId).toBeUndefined();

    // 验证 messages 完整存储
    expect(snap.messages).toHaveLength(2);
    expect(snap.messages[0].id).toBe("msg_full_1");
    expect(snap.messages[0].parts[0].content).toBe("hello");
  });

  test("restoreSnapshot 恢复 full 快照，验证消息匹配", async () => {
    const sessionId = uniqueSessionId("full-restore");
    const messages = [
      makeMessageRecord("msg_restore_1", "user", "你好", sessionId),
      makeMessageRecord("msg_restore_2", "assistant", "你好呀", sessionId),
      makeMessageRecord("msg_restore_3", "user", "再见", sessionId),
    ];

    const snap = await createSnapshot(sessionId, messages, "待恢复快照");
    createdSnapshotIds.push(snap.id);

    const restored = await restoreSnapshot(snap.id);
    expect(restored).not.toBeNull();
    expect(restored!.id).toBe(snap.id);
    expect(restored!.sessionId).toBe(sessionId);
    expect(restored!.messages).toHaveLength(3);
    expect(restored!.mode).toBe("full");

    // 逐条验证消息内容
    for (let i = 0; i < messages.length; i++) {
      expect(restored!.messages[i].id).toBe(messages[i].id);
      expect(restored!.messages[i].role).toBe(messages[i].role);
      expect(restored!.messages[i].parts[0].content).toBe(messages[i].parts[0].content);
    }
  });

  test("listSnapshots 按 sessionId 过滤", async () => {
    const sessionId = uniqueSessionId("full-list");

    // 为同一 session 创建两个快照
    const snap1 = await createSnapshot(sessionId, [makeMessageRecord("msg_l1", "user", "a", sessionId)], "列表快照1");
    const snap2 = await createSnapshot(sessionId, [makeMessageRecord("msg_l2", "user", "b", sessionId)], "列表快照2");
    createdSnapshotIds.push(snap1.id, snap2.id);

    // 查询该 session 的快照
    const list = await listSnapshots(sessionId);
    expect(list.length).toBeGreaterThanOrEqual(2);

    const ids = list.map((s) => s.id);
    expect(ids).toContain(snap1.id);
    expect(ids).toContain(snap2.id);

    // 使用不同 sessionId 查询，不应包含上述快照
    const otherList = await listSnapshots("nonexistent-session-id");
    const otherIds = otherList.map((s) => s.id);
    expect(otherIds).not.toContain(snap1.id);
    expect(otherIds).not.toContain(snap2.id);
  });

  test("deleteSnapshot 删除快照后无法恢复", async () => {
    const sessionId = uniqueSessionId("full-delete");
    const snap = await createSnapshot(sessionId, [makeMessageRecord("msg_del_1", "user", "del me", sessionId)]);
    createdSnapshotIds.push(snap.id); // 即使删除了也不影响 afterEach

    const ok = await deleteSnapshot(snap.id);
    expect(ok).toBe(true);

    // 删除后恢复应返回 null
    const restored = await restoreSnapshot(snap.id);
    expect(restored).toBeNull();
  });
});

// ─── Incremental 模式测试 ─────────────────────────────────────

describe("快照 Incremental 模式", () => {
  test("createSnapshot 增量模式仅存储变更消息", async () => {
    const sessionId = uniqueSessionId("inc-basic");

    // 1. 创建 full 基础快照（3 条消息）
    const baseMessages = [
      makeMessageRecord("msg_inc_1", "user", "消息1", sessionId),
      makeMessageRecord("msg_inc_2", "assistant", "消息2", sessionId),
      makeMessageRecord("msg_inc_3", "user", "消息3", sessionId),
    ];
    const baseSnap = await createSnapshot(sessionId, baseMessages, "基础快照");
    createdSnapshotIds.push(baseSnap.id);

    // 2. 创建增量快照: 保留 msg_inc_1(无变更), 修改 msg_inc_2(内容变更), 新增 msg_inc_4
    const updatedMessages = [
      makeMessageRecord("msg_inc_1", "user", "消息1", sessionId), // 无变更，不应出现在增量数据中
      makeMessageRecord("msg_inc_2", "assistant", "消息2-已修改", sessionId), // 内容变更
      makeMessageRecord("msg_inc_4", "assistant", "消息4-新增", sessionId), // 新增
    ];
    const incSnap = await createSnapshot(sessionId, updatedMessages, "增量快照", {
      baseSnapshotId: baseSnap.id,
    });
    createdSnapshotIds.push(incSnap.id);

    // 验证增量快照元数据
    expect(incSnap.mode).toBe("incremental");
    expect(incSnap.baseSnapshotId).toBe(baseSnap.id);
    expect(incSnap.messageCount).toBe(updatedMessages.length); // 总消息数 = 3

    // 验证增量快照只包含变更消息 (msg_inc_2 变更 + msg_inc_4 新增 = 2条)
    // msg_inc_1 未变更，不应出现在增量数据的 messages 中
    expect(incSnap.messages.length).toBeLessThanOrEqual(updatedMessages.length);
    expect(incSnap.messages.length).toBeLessThan(baseMessages.length);

    // 确保变更消息和新增消息在增量数据中
    const incIds = incSnap.messages.map((m) => m.id);
    expect(incIds).toContain("msg_inc_2"); // 变更消息
    expect(incIds).toContain("msg_inc_4"); // 新增消息
  });

  test("restoreSnapshot 解析增量快照为完整消息集", async () => {
    const sessionId = uniqueSessionId("inc-restore");

    // 1. Full 基础快照
    const baseMessages = [
      makeMessageRecord("msg_ir_1", "user", "base-1", sessionId),
      makeMessageRecord("msg_ir_2", "assistant", "base-2", sessionId),
    ];
    const baseSnap = await createSnapshot(sessionId, baseMessages, "基础");
    createdSnapshotIds.push(baseSnap.id);

    // 2. 增量快照: 新增 msg_ir_3，修改 msg_ir_2
    const incMessages = [
      makeMessageRecord("msg_ir_1", "user", "base-1", sessionId),
      makeMessageRecord("msg_ir_2", "assistant", "base-2-modified", sessionId),
      makeMessageRecord("msg_ir_3", "user", "new-3", sessionId),
    ];
    const incSnap = await createSnapshot(sessionId, incMessages, "增量", { baseSnapshotId: baseSnap.id });
    createdSnapshotIds.push(incSnap.id);

    // 3. 恢复增量快照，应得到完整的消息集
    const restored = await restoreSnapshot(incSnap.id);
    expect(restored).not.toBeNull();
    expect(restored!.id).toBe(incSnap.id);
    expect(restored!.mode).toBe("incremental");

    // 恢复后应有 3 条完整消息
    expect(restored!.messages).toHaveLength(3);

    const msgMap = new Map(restored!.messages.map((m) => [m.id, m]));

    // msg_ir_1 应保留原始内容（未变更）
    expect(msgMap.get("msg_ir_1")!.parts[0].content).toBe("base-1");

    // msg_ir_2 应包含修改后的内容
    expect(msgMap.get("msg_ir_2")!.parts[0].content).toBe("base-2-modified");

    // msg_ir_3 应为新增消息
    expect(msgMap.get("msg_ir_3")!.parts[0].content).toBe("new-3");
  });

  test("三级链式快照 (full -> incremental -> incremental)，恢复最终快照包含所有消息", async () => {
    const sessionId = uniqueSessionId("inc-chain3");

    // 第 1 级: Full 快照（3 条消息）
    const level1Messages = [
      makeMessageRecord("msg_ch1", "user", "L1-msg1", sessionId),
      makeMessageRecord("msg_ch2", "assistant", "L1-msg2", sessionId),
      makeMessageRecord("msg_ch3", "user", "L1-msg3", sessionId),
    ];
    const snap1 = await createSnapshot(sessionId, level1Messages, "L1-full");
    createdSnapshotIds.push(snap1.id);

    // 第 2 级: Incremental 快照，基于 snap1（修改 msg_ch2，新增 msg_ch4）
    const level2Messages = [
      makeMessageRecord("msg_ch1", "user", "L1-msg1", sessionId),
      makeMessageRecord("msg_ch2", "assistant", "L2-msg2-modified", sessionId),
      makeMessageRecord("msg_ch3", "user", "L1-msg3", sessionId),
      makeMessageRecord("msg_ch4", "assistant", "L2-msg4-new", sessionId),
    ];
    const snap2 = await createSnapshot(sessionId, level2Messages, "L2-inc", { baseSnapshotId: snap1.id });
    createdSnapshotIds.push(snap2.id);

    // 第 3 级: Incremental 快照，基于 snap2（修改 msg_ch3，新增 msg_ch5）
    const level3Messages = [
      makeMessageRecord("msg_ch1", "user", "L1-msg1", sessionId),
      makeMessageRecord("msg_ch2", "assistant", "L2-msg2-modified", sessionId),
      makeMessageRecord("msg_ch3", "user", "L3-msg3-modified", sessionId),
      makeMessageRecord("msg_ch4", "assistant", "L2-msg4-new", sessionId),
      makeMessageRecord("msg_ch5", "user", "L3-msg5-new", sessionId),
    ];
    const snap3 = await createSnapshot(sessionId, level3Messages, "L3-inc", { baseSnapshotId: snap2.id });
    createdSnapshotIds.push(snap3.id);

    // 恢复第 3 级快照（应递归解析完整链）
    const restored = await restoreSnapshot(snap3.id);
    expect(restored).not.toBeNull();
    expect(restored!.id).toBe(snap3.id);
    expect(restored!.messages).toHaveLength(5);

    const msgMap = new Map(restored!.messages.map((m) => [m.id, m]));

    // 验证每条消息的最终内容
    expect(msgMap.get("msg_ch1")!.parts[0].content).toBe("L1-msg1"); // 原始未变
    expect(msgMap.get("msg_ch2")!.parts[0].content).toBe("L2-msg2-modified"); // L2 修改
    expect(msgMap.get("msg_ch3")!.parts[0].content).toBe("L3-msg3-modified"); // L3 修改
    expect(msgMap.get("msg_ch4")!.parts[0].content).toBe("L2-msg4-new"); // L2 新增
    expect(msgMap.get("msg_ch5")!.parts[0].content).toBe("L3-msg5-new"); // L3 新增
  });

  test("restoreSnapshot 基链断裂时返回 null", async () => {
    const sessionId = uniqueSessionId("inc-broken");

    // 创建一个增量快照，指向一个不存在的 baseSnapshotId
    const messages = [makeMessageRecord("msg_broken_1", "user", "broken chain", sessionId)];
    const incSnap = await createSnapshot(sessionId, messages, "断裂快照", {
      baseSnapshotId: "snap_nonexistent_base_000",
    });
    createdSnapshotIds.push(incSnap.id);

    // 恢复时应返回 null，因为 base 不可读
    const restored = await restoreSnapshot(incSnap.id);
    expect(restored).toBeNull();
  });
});

// ─── diffSnapshots 测试 ────────────────────────────────────────

describe("diffSnapshots 差异对比", () => {
  test("正确对比两个快照的 added/removed/changed", async () => {
    const sessionId = uniqueSessionId("diff-basic");
    const baseTime = Date.now();

    // 快照 A: 2 条消息
    const msgsA: MessageRecord[] = [
      {
        id: "msg_da_1",
        role: "user",
        sessionId,
        parts: [{ content: "消息A1", type: "text" }],
        createdAt: baseTime,
      },
      {
        id: "msg_da_2",
        role: "assistant",
        sessionId,
        parts: [{ content: "消息A2", type: "text" }],
        createdAt: baseTime + 1,
      },
    ];

    // 快照 B: 保留 msg_da_1, 修改 msg_da_2, 新增 msg_da_3, 缺少 msg_da_2（被删除后新增msg_da_2变更为新内容）
    const msgsB: MessageRecord[] = [
      {
        id: "msg_da_1",
        role: "user",
        sessionId,
        parts: [{ content: "消息A1", type: "text" }],
        createdAt: baseTime,
      },
      {
        id: "msg_da_2",
        role: "assistant",
        sessionId,
        parts: [{ content: "消息A2-已修改", type: "text" }],
        createdAt: baseTime + 1,
      },
      {
        id: "msg_da_3",
        role: "user",
        sessionId,
        parts: [{ content: "消息A3-新增", type: "text" }],
        createdAt: baseTime + 2,
      },
    ];

    const snapA = await createSnapshot(sessionId, msgsA, "diff-A");
    const snapB = await createSnapshot(sessionId, msgsB, "diff-B");
    createdSnapshotIds.push(snapA.id, snapB.id);

    const diff = await diffSnapshots(snapA.id, snapB.id);
    expect(diff).not.toBeNull();
    expect(diff!.added).toBe(1); // msg_da_3 新增
    expect(diff!.removed).toBe(0); // 没有被删除的消息（A 的所有 ID 在 B 中都存在）
    expect(diff!.changed).toBe(1); // msg_da_2 内容变更
    expect(diff!.changedIds).toContain("msg_da_2");
  });

  test("diffSnapshots 对不存在的快照返回 null", async () => {
    const diff1 = await diffSnapshots("snap_noexist_a", "snap_noexist_b");
    expect(diff1).toBeNull();

    // 一个存在一个不存在
    const sessionId = uniqueSessionId("diff-partial");
    const snap = await createSnapshot(sessionId, [makeMessageRecord("msg_dp_1", "user", "x", sessionId)]);
    createdSnapshotIds.push(snap.id);

    const diff2 = await diffSnapshots(snap.id, "snap_noexist_z");
    expect(diff2).toBeNull();
  });
});

// ─── 消息归一化测试 ────────────────────────────────────────────

describe("消息格式归一化", () => {
  test("{role, content, timestamp} 消息被正确转换为 MessageRecord", async () => {
    const sessionId = uniqueSessionId("normalize");
    const simpleMessages = [
      { role: "user", content: "你好世界", timestamp: Date.now() },
      { role: "assistant", content: "世界你好", timestamp: Date.now() + 1000 },
    ];

    const snap = await createSnapshot(sessionId, simpleMessages, "归一化测试");
    createdSnapshotIds.push(snap.id);

    // 验证消息已被转换为 MessageRecord 格式
    expect(snap.messages).toHaveLength(2);

    const msg1 = snap.messages[0];
    expect(msg1.role).toBe("user");
    expect(msg1.parts).toHaveLength(1);
    expect(msg1.parts[0].type).toBe("text");
    expect(msg1.parts[0].content).toBe("你好世界");
    expect(msg1.sessionId).toBe(sessionId);
    expect(msg1.id).toMatch(/^msg_/);

    const msg2 = snap.messages[1];
    expect(msg2.role).toBe("assistant");
    expect(msg2.parts[0].content).toBe("世界你好");
    expect(msg2.id).toMatch(/^msg_/);

    // 恢复后也应保持归一化后的格式
    const restored = await restoreSnapshot(snap.id);
    expect(restored).not.toBeNull();
    expect(restored!.messages).toHaveLength(2);
    expect(restored!.messages[0].parts[0].content).toBe("你好世界");
    expect(restored!.messages[1].parts[0].content).toBe("世界你好");
  });

  test("MessageRecord 消息保持原样不重复转换", async () => {
    const sessionId = uniqueSessionId("passthrough");
    const record: MessageRecord = {
      id: "msg_passthrough_1",
      role: "user",
      sessionId,
      parts: [{ content: "保持原样", type: "text" }],
      createdAt: Date.now(),
    };

    const snap = await createSnapshot(sessionId, [record], "passthrough");
    createdSnapshotIds.push(snap.id);

    // 应保留原始 id，而不是生成新 id
    expect(snap.messages[0].id).toBe("msg_passthrough_1");
    expect(snap.messages[0].parts[0].content).toBe("保持原样");
  });
});
