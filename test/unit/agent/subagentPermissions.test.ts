/**
 * 子代理权限测试。
 *
 * 测试用例:
 *   - 权限继承
 *   - 权限限制
 *   - 沙箱隔离
 */
import { describe, expect, test } from "bun:test";
import {
  buildSubagentPermissions,
  filterToolsForAgent,
  isPermissionAllowedForSubagent,
  isToolAllowedForAgent,
  validateSubagentSecurity,
} from "@/agent";
import type { AgentInfo } from "@/agent";

// ─── 测试用 Agent ────────────────────────────────────────────

const primaryAgent: AgentInfo = {
  description: "无工具白名单的主 Agent",
  label: "主 Agent",
  mode: "primary",
  name: "primary-test",
  options: {},
  prompt: "test",
};

const restrictedAgent: AgentInfo = {
  allowedTools: ["fs_read", "deepwiki_read_structure"],
  description: "有工具白名单的 Agent",
  label: "受限 Agent",
  mode: "subagent",
  name: "restricted-test",
  options: {},
  prompt: "test",
};

const noToolsAgent: AgentInfo = {
  allowedTools: [],
  description: "工具白名单为空的 Agent",
  label: "无工具 Agent",
  mode: "subagent",
  name: "no-tools-test",
  options: {},
  prompt: "test",
};

describe("子代理权限隔离", () => {
  // ─── 工具过滤 ──────────────────────────────────────────────

  test("无白名单的 Agent 允许所有工具", () => {
    const tools = ["read_file", "bash", "write_file", "deepwiki_search"];
    const filtered = filterToolsForAgent(tools, primaryAgent);
    expect(filtered).toEqual(tools);
  });

  test("有白名单的 Agent 只允许白名单中的工具", () => {
    const tools = ["fs_read", "bash", "write_file", "deepwiki_read_structure"];
    const filtered = filterToolsForAgent(tools, restrictedAgent);
    expect(filtered).toEqual(["fs_read", "deepwiki_read_structure"]);
  });

  test("空白名单的 Agent 不允许任何工具", () => {
    const tools = ["read_file", "bash"];
    const filtered = filterToolsForAgent(tools, noToolsAgent);
    expect(filtered).toEqual([]);
  });

  test("isToolAllowedForAgent 无白名单时返回 true", () => {
    expect(isToolAllowedForAgent("fs_read", primaryAgent)).toBe(true);
    expect(isToolAllowedForAgent("bash", primaryAgent)).toBe(true);
  });

  test("isToolAllowedForAgent 有白名单时检查是否在列表中", () => {
    expect(isToolAllowedForAgent("fs_read", restrictedAgent)).toBe(true);
    expect(isToolAllowedForAgent("bash", restrictedAgent)).toBe(false);
    expect(isToolAllowedForAgent("deepwiki_read_structure", restrictedAgent)).toBe(true);
  });

  // ─── 权限规则 ──────────────────────────────────────────────

  test("buildSubagentPermissions 包含拒绝规则", () => {
    const permissions = buildSubagentPermissions(restrictedAgent);
    // 应包含子代理拒绝规则
    const denyRules = permissions.filter((r) => r.action === "deny");
    expect(denyRules.length).toBeGreaterThan(0);
  });

  test("buildSubagentPermissions 自定义权限时优先使用", () => {
    const customPermAgent: AgentInfo = {
      ...restrictedAgent,
      permissions: [{ action: "allow" as const, pattern: "*", permission: "fs.read" }],
    };
    const permissions = buildSubagentPermissions(customPermAgent);
    // 应包含自定义规则 + 子代理拒绝规则
    const allowRules = permissions.filter((r) => r.action === "allow");
    const denyRules = permissions.filter((r) => r.action === "deny");
    expect(allowRules.length).toBeGreaterThan(0);
    expect(denyRules.length).toBeGreaterThan(0);
  });

  test("buildSubagentPermissions 继承父代理权限", () => {
    const parentPerms = [{ action: "allow" as const, pattern: "*", permission: "fs.read" }];
    const permissions = buildSubagentPermissions(restrictedAgent, parentPerms);
    const inheritRules = permissions.filter((r) => r.permission === "fs.read");
    expect(inheritRules.length).toBeGreaterThan(0);
  });

  // ─── 安全检查 ──────────────────────────────────────────────

  test("isPermissionAllowedForSubagent 正常权限允许", () => {
    expect(isPermissionAllowedForSubagent("fs.read")).toBe(true);
    expect(isPermissionAllowedForSubagent("web.fetch")).toBe(true);
  });

  test("isPermissionAllowedForSubagent 禁止危险权限", () => {
    expect(isPermissionAllowedForSubagent("config.write")).toBe(false);
    expect(isPermissionAllowedForSubagent("agent.manage")).toBe(false);
  });

  test("validateSubagentSecurity 安全的子代理通过验证", () => {
    const result = validateSubagentSecurity(restrictedAgent);
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBe(0);
  });

  test("validateSubagentSecurity 检测权限逃逸", () => {
    const dangerous: AgentInfo = {
      ...restrictedAgent,
      permissions: [{ action: "allow" as const, pattern: "*", permission: "agent.manage" }],
    };
    const result = validateSubagentSecurity(dangerous);
    expect(result.valid).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  test("validateSubagentSecurity compaction Agent 空白名单不警告", () => {
    const compaction: AgentInfo = {
      allowedTools: [],
      description: "压缩上下文",
      label: "压缩",
      mode: "subagent",
      name: "compaction",
      options: {},
      prompt: "压缩",
    };
    const result = validateSubagentSecurity(compaction);
    // Compaction 允许空白名单
    const emptyToolWarnings = result.warnings.filter((w) => w.includes("工具白名单为空"));
    expect(emptyToolWarnings.length).toBe(0);
  });
});
