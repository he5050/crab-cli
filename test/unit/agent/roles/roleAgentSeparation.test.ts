/**
 * 角色与 agent 分离测试。
 *
 * 测试目标:
 *   - 验证 role(角色)层与 agent(智能体)层的事件流与状态互相隔离
 *
 * 测试用例:
 *   - 角色切换不会污染 agent 状态
 *   - globalBus 上角色与 agent 事件的订阅互不干扰
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { globalBus } from "@/bus";
import { AppEvent } from "@/bus";
import { readSettings } from "@/config/settings/unifiedSettings";
import {
  type AgentInfo,
  _resetAll,
  getActiveAgent,
  getActiveAgentName,
  registerAgent,
  setActiveAgent,
} from "@/agent/core/manager";
import { applyRolePickerAction, buildRolePickerOptions } from "@/ui/components/rolePickerModel";

const originalCwd = process.cwd();
let tempProject: string | undefined;

function setupProject() {
  tempProject = fs.mkdtempSync(path.join(os.tmpdir(), "crab-role-agent-separation-"));
  const crabDir = path.join(tempProject, ".crab");
  fs.mkdirSync(crabDir, { recursive: true });
  fs.writeFileSync(path.join(crabDir, "ROLE.md"), "# Active Project Role", "utf8");
  fs.writeFileSync(path.join(crabDir, "ROLE-abc123.md"), "# Review Project Role", "utf8");
  process.chdir(tempProject);
}

function setupAgent() {
  const agent: AgentInfo = {
    allowedTools: ["filesystem-read"],
    description: "Agent used to verify role separation",
    label: "Separation Agent",
    mode: "primary",
    model: { modelID: "gpt-4o", providerID: "openai" },
    name: "separation-agent",
    options: {},
    prompt: "# Agent Prompt",
    steps: 9,
  };
  registerAgent(agent);
  registerAgent({
    ...agent,
    allowedTools: ["filesystem-write"],
    label: "Second Agent",
    model: { modelID: "claude-sonnet-4", providerID: "anthropic" },
    name: "second-agent",
    steps: 3,
  });
  expect(setActiveAgent(agent.name)).toBe(true);
}

describe("Role / Agent separation", () => {
  beforeEach(() => {
    _resetAll();
    setupProject();
    setupAgent();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    _resetAll();
    if (tempProject) {
      fs.rmSync(tempProject, { force: true, recursive: true });
      tempProject = undefined;
    }
  });

  test("RolePicker 选项来从 ROLE.md 文件, 不 Agent 注册表", () => {
    const options = buildRolePickerOptions({
      includeCreateActions: false,
      includeGlobal: false,
      projectRoot: tempProject,
    });

    expect(options).toHaveLength(2);
    expect(options.map((option) => option.title)).toEqual(["project / ROLE-abc123.md", "project / ROLE.md"]);
    expect(options.some((option) => option.keywords?.includes("separation-agent"))).toBe(false);
    expect(options.some((option) => option.current)).toBe(true);
  });

  test("selecting a Role updates role settings and publishes RoleChanged without changing active Agent", async () => {
    const events: { roleId: string | null; previousRoleId: string | null }[] = [];
    const unsub = globalBus.subscribe(AppEvent.RoleChanged, (event) => {
      events.push({
        previousRoleId: event.properties.previousRoleId,
        roleId: event.properties.roleId,
      });
    });

    const target = buildRolePickerOptions({
      includeCreateActions: false,
      includeGlobal: false,
      projectRoot: tempProject,
    }).find((option) => option.title.includes("ROLE-abc123.md"));

    expect(target).toBeDefined();
    const result = await applyRolePickerAction(target!.value, tempProject);
    const settings = readSettings("project", tempProject);

    expect(result.success).toBe(true);
    expect(settings.role?.activeRoleId).toBe("abc123");
    expect(getActiveAgentName()).toBe("separation-agent");
    expect(getActiveAgent()?.allowedTools).toEqual(["filesystem-read"]);
    expect(getActiveAgent()?.model).toEqual({ modelID: "gpt-4o", providerID: "openai" });
    expect(getActiveAgent()?.steps).toBe(9);
    expect(events).toEqual([{ previousRoleId: "active", roleId: "abc123" }]);
    unsub();
  });

  test("switching Agent changes executable Agent state but does not mutate Role settings", async () => {
    const target = buildRolePickerOptions({
      includeCreateActions: false,
      includeGlobal: false,
      projectRoot: tempProject,
    }).find((option) => option.title.includes("ROLE-abc123.md"));

    expect(target).toBeDefined();
    await applyRolePickerAction(target!.value, tempProject);

    expect(setActiveAgent("second-agent")).toBe(true);
    const settings = readSettings("project", tempProject);

    expect(getActiveAgentName()).toBe("second-agent");
    expect(getActiveAgent()?.allowedTools).toEqual(["filesystem-write"]);
    expect(getActiveAgent()?.model).toEqual({ modelID: "claude-sonnet-4", providerID: "anthropic" });
    expect(getActiveAgent()?.steps).toBe(3);
    expect(settings.role?.activeRoleId).toBe("abc123");
  });

  test("creating a project Role creates ROLE.md and still does not change active Agent", async () => {
    fs.rmSync(path.join(tempProject!, ".crab"), { force: true, recursive: true });

    const result = await applyRolePickerAction({ location: "project", type: "create" }, tempProject);

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(tempProject!, ".crab", "ROLE.md"))).toBe(true);
    expect(getActiveAgentName()).toBe("separation-agent");
  });
});
