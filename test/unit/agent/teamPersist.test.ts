/**
 * Team-persist 白盒测试 — 团队 CRUD + 成员管理 + 生命周期。
 *
 * 使用临时目录作为 projectDir，避免依赖真实项目。
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  addMember,
  createTeam,
  deleteTeamData,
  disbandTeam,
  findMemberByName,
  getActiveMembers,
  getActiveTeam,
  getMember,
  getTeam,
  removeMember,
  updateMember,
  updateTeam,
} from "@/agent/team";

/**
 * 使用 /var/tmp 而非 os.tmpdir()，因为后者在 VM 挂载点下，
 * getProjectCrabDir 会向上查找到 ~/.crab 导致路径冲突。
 */
const TEST_TMP_BASE = "/var/tmp/crab-test-persist";

let tmpDir: string;

beforeEach(() => {
  mkdirSync(TEST_TMP_BASE, { recursive: true });
  tmpDir = mkdtempSync(join(TEST_TMP_BASE, "team-"));
});

afterEach(() => {
  try {
    rmSync(tmpDir, { force: true, recursive: true });
  } catch {}
});

describe("createTeam", () => {
  test("创建团队并返回配置", () => {
    const team = createTeam("alpha", "lead-001", tmpDir);
    expect(team.name).toBe("alpha");
    expect(team.leadInstanceId).toBe("lead-001");
    expect(team.status).toBe("active");
    expect(team.members).toEqual([]);
  });

  test("重复创建同名的团队抛出异常", () => {
    createTeam("alpha", "lead-001", tmpDir);
    expect(() => createTeam("alpha", "lead-002", tmpDir)).toThrow("already exists");
  });
});

describe("getTeam", () => {
  test("不存在的团队返回 null", () => {
    expect(getTeam("nonexistent", tmpDir)).toBeNull();
  });

  test("获取已创建的团队", () => {
    createTeam("alpha", "lead-001", tmpDir);
    const team = getTeam("alpha", tmpDir);
    expect(team).not.toBeNull();
    expect(team!.name).toBe("alpha");
  });
});

describe("getActiveTeam", () => {
  test("无活跃团队返回 null", () => {
    expect(getActiveTeam(tmpDir)).toBeNull();
  });

  test("返回活跃团队", () => {
    createTeam("alpha", "lead-001", tmpDir);
    const active = getActiveTeam(tmpDir);
    expect(active).not.toBeNull();
    expect(active!.name).toBe("alpha");
  });

  test("已解散的团队不算活跃", () => {
    createTeam("alpha", "lead-001", tmpDir);
    disbandTeam("alpha", tmpDir);
    expect(getActiveTeam(tmpDir)).toBeNull();
  });
});

describe("updateTeam", () => {
  test("更新不存在的团队返回 null", () => {
    expect(updateTeam("ghost", { status: "cleanup" }, tmpDir)).toBeNull();
  });

  test("更新团队状态", () => {
    createTeam("alpha", "lead-001", tmpDir);
    const updated = updateTeam("alpha", { status: "cleanup" }, tmpDir);
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("cleanup");
  });

  test("name 不可被覆盖", () => {
    createTeam("alpha", "lead-001", tmpDir);
    const updated = updateTeam("alpha", { name: "beta" } as any, tmpDir);
    expect(updated!.name).toBe("alpha");
  });
});

describe("addMember", () => {
  test("添加成员到团队", () => {
    createTeam("alpha", "lead-001", tmpDir);
    const member = addMember("alpha", "agent-1", "/tmp/wt1", "coder", tmpDir);
    expect(member.name).toBe("agent-1");
    expect(member.role).toBe("coder");
    expect(member.status).toBe("pending");
    expect(member.worktreePath).toBe("/tmp/wt1");
  });

  test("添加到不存在的团队抛出异常", () => {
    expect(() => addMember("ghost", "agent-1", "/tmp/wt1", undefined, tmpDir)).toThrow("not found");
  });

  test("添加到已解散的团队抛出异常", () => {
    createTeam("alpha", "lead-001", tmpDir);
    disbandTeam("alpha", tmpDir);
    expect(() => addMember("alpha", "agent-1", "/tmp/wt1", undefined, tmpDir)).toThrow("not active");
  });
});

describe("updateMember", () => {
  test("更新成员状态", () => {
    createTeam("alpha", "lead-001", tmpDir);
    const member = addMember("alpha", "agent-1", "/tmp/wt1", undefined, tmpDir);
    const updated = updateMember("alpha", member.id, { instanceId: "inst-1", status: "active" }, tmpDir);
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("active");
    expect(updated!.instanceId).toBe("inst-1");
  });

  test("更新不存在的成员返回 null", () => {
    createTeam("alpha", "lead-001", tmpDir);
    expect(updateMember("alpha", "nonexistent", { status: "active" }, tmpDir)).toBeNull();
  });
});

describe("removeMember", () => {
  test("移除成员", () => {
    createTeam("alpha", "lead-001", tmpDir);
    const member = addMember("alpha", "agent-1", "/tmp/wt1", undefined, tmpDir);
    expect(removeMember("alpha", member.id, tmpDir)).toBe(true);
    expect(getMember("alpha", member.id, tmpDir)).toBeNull();
  });

  test("移除不存在的成员返回 false", () => {
    createTeam("alpha", "lead-001", tmpDir);
    expect(removeMember("alpha", "nonexistent", tmpDir)).toBe(false);
  });
});

describe("getMember", () => {
  test("获取成员", () => {
    createTeam("alpha", "lead-001", tmpDir);
    const member = addMember("alpha", "agent-1", "/tmp/wt1", undefined, tmpDir);
    const found = getMember("alpha", member.id, tmpDir);
    expect(found).not.toBeNull();
    expect(found!.name).toBe("agent-1");
  });

  test("团队不存在返回 null", () => {
    expect(getMember("ghost", "any", tmpDir)).toBeNull();
  });
});

describe("getActiveMembers", () => {
  test("只返回 active + pending 成员", () => {
    createTeam("alpha", "lead-001", tmpDir);
    const m1 = addMember("alpha", "a1", "/tmp/wt1", undefined, tmpDir);
    const m2 = addMember("alpha", "a2", "/tmp/wt2", undefined, tmpDir);
    updateMember("alpha", m2.id, { status: "shutdown" }, tmpDir);
    const active = getActiveMembers("alpha", tmpDir);
    expect(active.length).toBe(1);
    expect(active[0]!.id).toBe(m1.id);
  });

  test("团队不存在返回空数组", () => {
    expect(getActiveMembers("ghost", tmpDir)).toEqual([]);
  });
});

describe("findMemberByName", () => {
  test("按名称查找(大小写不敏感)", () => {
    createTeam("alpha", "lead-001", tmpDir);
    addMember("alpha", "Agent-X", "/tmp/wt1", undefined, tmpDir);
    const found = findMemberByName("alpha", "agent-x", tmpDir);
    expect(found).not.toBeNull();
    expect(found!.name).toBe("Agent-X");
  });

  test("不存在返回 null", () => {
    createTeam("alpha", "lead-001", tmpDir);
    expect(findMemberByName("alpha", "nonexistent", tmpDir)).toBeNull();
  });
});

describe("disbandTeam", () => {
  test("解散团队", () => {
    createTeam("alpha", "lead-001", tmpDir);
    addMember("alpha", "a1", "/tmp/wt1", undefined, tmpDir);
    expect(disbandTeam("alpha", tmpDir)).toBe(true);
    const team = getTeam("alpha", tmpDir);
    expect(team!.status).toBe("disbanded");
    expect(team!.members[0]!.status).toBe("shutdown");
  });

  test("不存在的团队返回 false", () => {
    expect(disbandTeam("ghost", tmpDir)).toBe(false);
  });
});

describe("deleteTeamData", () => {
  test("删除团队数据", () => {
    createTeam("alpha", "lead-001", tmpDir);
    expect(deleteTeamData("alpha", tmpDir)).toBe(true);
    expect(getTeam("alpha", tmpDir)).toBeNull();
  });

  test("不存在的团队返回 false", () => {
    expect(deleteTeamData("ghost", tmpDir)).toBe(false);
  });
});
