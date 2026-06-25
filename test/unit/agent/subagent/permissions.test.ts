/**
 * [测试目标] Subagent Permissions — 工具过滤、权限隔离、安全检查。
 *
 * 测试用例:
 *   - filterToolsForAgent 工具白名单过滤)精确匹配、前缀匹配、无白名单)
 *   - isToolAllowedForAgent 单工具权限检查
 *   - buildSubagentPermissions 子代理权限规则生成
 *   - isPermissionAllowedForSubagent 权限类别检查
 *   - validateSubagentSecurity 安全检查
 */
import { describe, expect, test } from "bun:test";
import { evaluate } from "@/permission";
import type { AgentInfo } from "@/agent/core";
import {
  buildSubagentPermissions,
  filterToolsForAgent,
  isPermissionAllowedForSubagent,
  isToolAllowedForAgent,
  validateSubagentSecurity,
} from "@/agent/subagent/permissions";

function makeAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    name: "test-agent",
    label: "Test Agent",
    description: "",
    mode: "subagent",
    prompt: "",
    options: {},
    ...overrides,
  };
}

describe("filterToolsForAgent", () => {
  const allTools = [
    "filesystem-read",
    "filesystem-write",
    "filesystem-delete",
    "bash-execute",
    "web-search",
    "edit-replace",
  ];

  test("无白名单时允许所有工具", () => {
    const agent = makeAgent({ allowedTools: undefined });
    const result = filterToolsForAgent(allTools, agent);
    expect(result).toEqual(["filesystem-read", "filesystem-write", "filesystem-delete", "web-search", "edit-replace"]);
  });

  test("精确匹配白名单", () => {
    const agent = makeAgent({ allowedTools: ["filesystem-read", "web-search"] });
    const result = filterToolsForAgent(allTools, agent);
    expect(result).toEqual(["filesystem-read", "web-search"]);
  });

  test("前缀匹配白名单", () => {
    const agent = makeAgent({ allowedTools: ["filesystem-"] });
    const result = filterToolsForAgent(allTools, agent);
    expect(result).toEqual(["filesystem-read", "filesystem-write", "filesystem-delete"]);
  });

  test("混合精确和前缀匹配", () => {
    const agent = makeAgent({ allowedTools: ["filesystem-", "web-search"] });
    const result = filterToolsForAgent(allTools, agent);
    expect(result).toEqual(["filesystem-read", "filesystem-write", "filesystem-delete", "web-search"]);
  });

  test("白名单为空时拒绝所有工具", () => {
    const agent = makeAgent({ allowedTools: [] });
    const result = filterToolsForAgent(allTools, agent);
    expect(result).toEqual([]);
  });

  test("白名单包含不存在的工具名不影响结果", () => {
    const agent = makeAgent({ allowedTools: ["nonexistent-", "filesystem-read"] });
    const result = filterToolsForAgent(allTools, agent);
    expect(result).toEqual(["filesystem-read"]);
  });
});

describe("isToolAllowedForAgent", () => {
  test("无白名单时允许任意工具", () => {
    const agent = makeAgent({ allowedTools: undefined });
    expect(isToolAllowedForAgent("any-tool", agent)).toBe(true);
  });

  test("精确匹配允许", () => {
    const agent = makeAgent({ allowedTools: ["filesystem-read"] });
    expect(isToolAllowedForAgent("filesystem-read", agent)).toBe(true);
    expect(isToolAllowedForAgent("bash-execute", agent)).toBe(false);
  });

  test("前缀匹配允许", () => {
    const agent = makeAgent({ allowedTools: ["edit-"] });
    expect(isToolAllowedForAgent("edit-replace", agent)).toBe(true);
    expect(isToolAllowedForAgent("edit-undo", agent)).toBe(true);
    expect(isToolAllowedForAgent("filesystem-read", agent)).toBe(false);
  });
});

describe("buildSubagentPermissions", () => {
  test("无自定义权限时继承父权限并添加拒绝规则", () => {
    const parentPermissions = [{ permission: "filesystem.*", pattern: "*", action: "allow" as const, metadata: {} }];

    const agent = makeAgent();
    const result = buildSubagentPermissions(agent, parentPermissions);

    expect(result).toHaveLength(3);
    expect(result.some((r) => r.permission === "config.write" && r.action === "deny")).toBe(true);
    expect(result.some((r) => r.permission === "agent.manage" && r.action === "deny")).toBe(true);
  });

  test("有自定义权限时合并并添加拒绝规则", () => {
    const agent = makeAgent({
      permissions: [{ permission: "custom.perm", pattern: "*", action: "allow" as const, metadata: {} }],
    });

    const result = buildSubagentPermissions(agent);

    expect(result.some((r) => r.permission === "custom.perm")).toBe(true);
    expect(result.some((r) => r.permission === "config.write" && r.action === "deny")).toBe(true);
    expect(result.some((r) => r.permission === "agent.manage" && r.action === "deny")).toBe(true);
  });

  test("无父权限时生成仅包含拒绝规则的规则集", () => {
    const agent = makeAgent();
    const result = buildSubagentPermissions(agent);

    expect(result).toHaveLength(2);
    expect(result.every((r) => r.action === "deny")).toBe(true);
  });

  test("子代理拒绝规则必须覆盖父级 allow", () => {
    const parentPermissions = [{ permission: "config.write", pattern: "*", action: "allow" as const, metadata: {} }];

    const result = buildSubagentPermissions(makeAgent(), parentPermissions);
    const decision = evaluate("config.write", "any.json", result);

    expect(decision.action).toBe("deny");
  });

  test("子代理拒绝规则必须覆盖自身自定义 allow", () => {
    const agent = makeAgent({
      permissions: [{ permission: "agent.manage", pattern: "*", action: "allow" as const, metadata: {} }],
    });

    const result = buildSubagentPermissions(agent);
    const decision = evaluate("agent.manage", "task", result);

    expect(decision.action).toBe("deny");
  });
});

describe("isPermissionAllowedForSubagent", () => {
  test("config.write 禁止", () => {
    expect(isPermissionAllowedForSubagent("config.write")).toBe(false);
  });

  test("agent.manage 禁止", () => {
    expect(isPermissionAllowedForSubagent("agent.manage")).toBe(false);
  });

  test("其他权限允许", () => {
    expect(isPermissionAllowedForSubagent("filesystem.read")).toBe(true);
    expect(isPermissionAllowedForSubagent("bash.execute")).toBe(true);
    expect(isPermissionAllowedForSubagent("unknown.perm")).toBe(true);
  });
});

describe("dangerous tool denylist", () => {
  test("无白名单时仍应剔除高风险 shell 工具", () => {
    const tools = ["filesystem-read", "terminal-execute", "bash-execute", "web-search"];
    const result = filterToolsForAgent(tools, makeAgent({ allowedTools: undefined }));
    expect(result).toEqual(["filesystem-read", "web-search"]);
  });

  test("白名单显式包含高风险 shell 工具时仍应拒绝", () => {
    const agent = makeAgent({ allowedTools: ["terminal-execute", "filesystem-read"] });
    const result = filterToolsForAgent(["terminal-execute", "filesystem-read"], agent);
    expect(result).toEqual(["filesystem-read"]);
    expect(isToolAllowedForAgent("terminal-execute", agent)).toBe(false);
  });
});

describe("validateSubagentSecurity", () => {
  test("正常子代理配置通过验证", () => {
    const agent = makeAgent({
      allowedTools: ["filesystem-read"],
    });

    const result = validateSubagentSecurity(agent);
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  test("子代理具有 agent.manage allow 规则时产生警告", () => {
    const agent = makeAgent({
      permissions: [{ permission: "agent.manage", pattern: "*", action: "allow" as const, metadata: {} }],
    });

    const result = validateSubagentSecurity(agent);
    expect(result.valid).toBe(false);
    expect(result.warnings.some((w) => w.includes("agent.manage"))).toBe(true);
  });

  test("子代理工具白名单为空时产生警告)非 compaction)", () => {
    const agent = makeAgent({
      allowedTools: [],
      mode: "subagent",
    });

    const result = validateSubagentSecurity(agent);
    expect(result.valid).toBe(false);
    expect(result.warnings.some((w) => w.includes("工具白名单为空"))).toBe(true);
  });

  test("compaction Agent 工具白名单为空不产生警告", () => {
    const agent = makeAgent({
      name: "compaction",
      allowedTools: [],
      mode: "subagent",
    });

    const result = validateSubagentSecurity(agent);
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  test("无 allowedTools 定义时不产生空警告", () => {
    const agent = makeAgent({
      allowedTools: undefined,
    });

    const result = validateSubagentSecurity(agent);
    expect(result.warnings.some((w) => w.includes("工具白名单为空"))).toBe(false);
  });
});
