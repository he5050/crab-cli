/**
 * G-12 Team 工具拆分测试。
 *
 * 测试用例:
 *   - L3-T08: 15 个独立 Team MCP 工具均可注册
 *   - L3-T09: 原 `team` 单工具不再注册
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { teamTool, teamTools } from "@/tool/team";
import { _resetForTesting, getRegisteredTools } from "@/tool/registry/toolRegistry";

describe("G-12 Team 工具拆分", () => {
  beforeAll(() => {
    // 确保 registry 已初始化后检查
    getRegisteredTools();
  });

  afterAll(() => {
    _resetForTesting();
  });

  it("L3-T08: 16 个独立 Team 工具均有唯一 name 和 description", () => {
    expect(teamTools.length).toBe(16);

    const names = teamTools.map((t) => t.name);
    expect(names).toContain("team-spawn");
    expect(names).toContain("team-message");
    expect(names).toContain("team-broadcast");
    expect(names).toContain("team-shutdown");
    expect(names).toContain("team-wait");
    expect(names).toContain("team-list");
    expect(names).toContain("team-status");
    expect(names).toContain("team-create-task");
    expect(names).toContain("team-update-task");
    expect(names).toContain("team-list-tasks");
    expect(names).toContain("team-merge-work");
    expect(names).toContain("team-merge-all");
    expect(names).toContain("team-resolve-conflicts");
    expect(names).toContain("team-abort-merge");
    expect(names).toContain("team-approve-plan");
    expect(names).toContain("team-cleanup");

    // 所有 name 唯一
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);

    // 所有 description 非空
    for (const tool of teamTools) {
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it("L3-T09: teamTools 中的工具在注册表中", () => {
    const registered = getRegisteredTools();
    for (const tool of teamTools) {
      expect(registered[tool.name]).toBeDefined();
    }
  });

  it("L3-T09 补充: 原单体 team 工具名称为 team(向后兼容)", () => {
    expect(teamTool.name).toBe("team");
  });
});
