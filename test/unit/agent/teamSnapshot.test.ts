/**
 * Team-snapshot 白盒测试 — 团队创建/队友生成事件记录和回滚。
 *
 * 使用临时目录作为 projectDir。
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  clearAllTeamSnapshots,
  deleteTeamSnapshotsByTeamName,
  deleteTeamSnapshotsFromIndex,
  getTeamEventsToRollback,
  getTeamRollbackCount,
  hasTeamToRollback,
  recordMemberSpawned,
  recordTeamCreated,
} from "@/agent/team";

/**
 * 使用 /var/tmp 而非 os.tmpdir()，避免 VM 挂载点下的 .crab 被向上查找到。
 */
const TEST_TMP_BASE = "/var/tmp/crab-test-snapshot";

let tmpDir: string;

beforeEach(() => {
  mkdirSync(TEST_TMP_BASE, { recursive: true });
  tmpDir = mkdtempSync(join(TEST_TMP_BASE, "snap-"));
});

afterEach(() => {
  try {
    rmSync(tmpDir, { force: true, recursive: true });
  } catch {}
});

describe("recordTeamCreated + getTeamEventsToRollback", () => {
  test("记录团队创建事件并可查询", () => {
    recordTeamCreated("proj-1", "sess-1", 5, "alpha", tmpDir);
    const events = getTeamEventsToRollback("proj-1", "sess-1", 5, tmpDir);
    expect(events.length).toBe(1);
    expect(events[0]!.type).toBe("team_created");
    expect(events[0]!.teamName).toBe("alpha");
  });

  test("相同事件不重复记录", () => {
    recordTeamCreated("proj-1", "sess-1", 5, "alpha", tmpDir);
    recordTeamCreated("proj-1", "sess-1", 5, "alpha", tmpDir);
    const events = getTeamEventsToRollback("proj-1", "sess-1", 5, tmpDir);
    expect(events.length).toBe(1);
  });

  test("不同 messageIndex 的不同事件", () => {
    recordTeamCreated("proj-1", "sess-1", 5, "alpha", tmpDir);
    recordTeamCreated("proj-1", "sess-1", 10, "beta", tmpDir);
    const events = getTeamEventsToRollback("proj-1", "sess-1", 5, tmpDir);
    expect(events.length).toBe(2);
  });

  test("targetIndex 过滤只返回 >= 的事件", () => {
    recordTeamCreated("proj-1", "sess-1", 3, "alpha", tmpDir);
    recordTeamCreated("proj-1", "sess-1", 7, "beta", tmpDir);
    const events = getTeamEventsToRollback("proj-1", "sess-1", 7, tmpDir);
    expect(events.length).toBe(1);
    expect(events[0]!.teamName).toBe("beta");
  });
});

describe("recordMemberSpawned", () => {
  test("记录队友生成事件", () => {
    recordTeamCreated("proj-1", "sess-1", 5, "alpha", tmpDir);
    recordMemberSpawned("proj-1", "sess-1", 6, "alpha", "m1", "agent-1", "/tmp/wt1", tmpDir);
    const events = getTeamEventsToRollback("proj-1", "sess-1", 5, tmpDir);
    expect(events.length).toBe(2);
    const event = events[1]!;
    expect(event.type).toBe("member_spawned");
    if (event.type === "member_spawned") {
      expect(event.memberName).toBe("agent-1");
    }
  });

  test("多次记录不同队友", () => {
    recordMemberSpawned("proj-1", "sess-1", 5, "alpha", "m1", "a1", "/wt1", tmpDir);
    recordMemberSpawned("proj-1", "sess-1", 5, "alpha", "m2", "a2", "/wt2", tmpDir);
    const events = getTeamEventsToRollback("proj-1", "sess-1", 5, tmpDir);
    expect(events.length).toBe(2);
  });
});

describe("hasTeamToRollback", () => {
  test("有事件返回 true", () => {
    recordTeamCreated("proj-1", "sess-1", 5, "alpha", tmpDir);
    expect(hasTeamToRollback("proj-1", "sess-1", 5, tmpDir)).toBe(true);
  });

  test("无事件返回 false", () => {
    expect(hasTeamToRollback("proj-1", "sess-1", 5, tmpDir)).toBe(false);
  });
});

describe("getTeamRollbackCount", () => {
  test("只计算 member_spawned 事件", () => {
    recordTeamCreated("proj-1", "sess-1", 5, "alpha", tmpDir);
    recordMemberSpawned("proj-1", "sess-1", 6, "alpha", "m1", "a1", "/wt1", tmpDir);
    recordMemberSpawned("proj-1", "sess-1", 7, "alpha", "m2", "a2", "/wt2", tmpDir);
    expect(getTeamRollbackCount("proj-1", "sess-1", 5, tmpDir)).toBe(2);
  });

  test("无事件返回 0", () => {
    expect(getTeamRollbackCount("proj-1", "sess-1", 5, tmpDir)).toBe(0);
  });
});

describe("deleteTeamSnapshotsFromIndex", () => {
  test("删除指定 index 之后的记录", () => {
    recordTeamCreated("proj-1", "sess-1", 3, "alpha", tmpDir);
    recordMemberSpawned("proj-1", "sess-1", 5, "alpha", "m1", "a1", "/wt1", tmpDir);
    deleteTeamSnapshotsFromIndex("proj-1", "sess-1", 5, tmpDir);
    const events = getTeamEventsToRollback("proj-1", "sess-1", 3, tmpDir);
    // Index 3 的保留, index >= 5 的被删除
    expect(events.length).toBe(1);
    expect(events[0]!.type).toBe("team_created");
  });
});

describe("deleteTeamSnapshotsByTeamName", () => {
  test("删除指定 team 的事件", () => {
    recordTeamCreated("proj-1", "sess-1", 5, "alpha", tmpDir);
    recordTeamCreated("proj-1", "sess-1", 6, "beta", tmpDir);
    deleteTeamSnapshotsByTeamName("proj-1", "sess-1", "alpha", tmpDir);
    const events = getTeamEventsToRollback("proj-1", "sess-1", 5, tmpDir);
    expect(events.length).toBe(1);
    expect(events[0]!.teamName).toBe("beta");
  });
});

describe("clearAllTeamSnapshots", () => {
  test("清空 session 所有快照", () => {
    recordTeamCreated("proj-1", "sess-1", 5, "alpha", tmpDir);
    recordMemberSpawned("proj-1", "sess-1", 6, "alpha", "m1", "a1", "/wt1", tmpDir);
    clearAllTeamSnapshots("proj-1", "sess-1", tmpDir);
    expect(hasTeamToRollback("proj-1", "sess-1", 5, tmpDir)).toBe(false);
  });

  test("不影响其他 session", () => {
    recordTeamCreated("proj-1", "sess-1", 5, "alpha", tmpDir);
    recordTeamCreated("proj-1", "sess-2", 5, "beta", tmpDir);
    clearAllTeamSnapshots("proj-1", "sess-1", tmpDir);
    expect(hasTeamToRollback("proj-1", "sess-1", 5, tmpDir)).toBe(false);
    expect(hasTeamToRollback("proj-1", "sess-2", 5, tmpDir)).toBe(true);
  });
});
