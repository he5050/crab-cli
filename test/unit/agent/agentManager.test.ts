/**
 * Agent 管理器测试。
 *
 * 测试用例:
 *   - Agent 创建
 *   - Agent 销毁
 *   - Agent 监控
 */
import { beforeEach, describe, expect, test } from "bun:test";
import {
  type AgentInfo,
  _resetAll,
  getActiveAgent,
  getActiveAgentName,
  getAgent,
  getAgentStatus,
  hasAgent,
  initBuiltinAgents,
  listAgents,
  listAgentsByMode,
  listPrimaryAgents,
  listSubagents,
  registerAgent,
  registerAgents,
  resetAllAgentStatus,
  setActiveAgent,
  setAgentStatus,
  unregisterAgent,
} from "@/agent";

// ─── 测试用 Agent 定义 ───────────────────────────────────────

const testAgent: AgentInfo = {
  description: "用于测试的 Agent",
  label: "测试 Agent",
  mode: "primary",
  name: "test-agent",
  options: {},
  prompt: "你是一个测试 Agent。",
};

const subAgent: AgentInfo = {
  allowedTools: ["read_file"],
  description: "用于测试的子代理",
  label: "测试子代理",
  mode: "subagent",
  name: "test-subagent",
  options: {},
  prompt: "你是一个测试子代理。",
};

const allModeAgent: AgentInfo = {
  description: "同时支持 primary 和 subagent 模式",
  label: "全模式 Agent",
  mode: "all",
  name: "test-all-mode",
  options: {},
  prompt: "你是一个全模式 Agent。",
};

describe("Agent Manager", () => {
  beforeEach(() => {
    // 完全重置，避免测试间状态泄露
    _resetAll();
    initBuiltinAgents();
    setActiveAgent("general");
  });

  // ─── 注册 ──────────────────────────────────────────────────

  test("注册单个 Agent", () => {
    registerAgent(testAgent);
    expect(hasAgent("test-agent")).toBe(true);
    expect(getAgent("test-agent")).toBeDefined();
    expect(getAgent("test-agent")!.label).toBe("测试 Agent");
  });

  test("注册同名 Agent 会覆盖", () => {
    registerAgent(testAgent);
    const updated: AgentInfo = { ...testAgent, label: "更新后的 Agent" };
    registerAgent(updated);
    expect(getAgent("test-agent")!.label).toBe("更新后的 Agent");
  });

  test("注册空名称 Agent 失败", () => {
    const empty: AgentInfo = { ...testAgent, name: "" };
    registerAgent(empty);
    expect(hasAgent("")).toBe(false);
  });

  test("批量注册 Agent", () => {
    registerAgents([testAgent, subAgent, allModeAgent]);
    expect(hasAgent("test-agent")).toBe(true);
    expect(hasAgent("test-subagent")).toBe(true);
    expect(hasAgent("test-all-mode")).toBe(true);
  });

  test("注销 Agent", () => {
    registerAgent(testAgent);
    expect(hasAgent("test-agent")).toBe(true);
    const result = unregisterAgent("test-agent");
    expect(result).toBe(true);
    expect(hasAgent("test-agent")).toBe(false);
  });

  test("注销不存在的 Agent 返回 false", () => {
    const result = unregisterAgent("nonexistent");
    expect(result).toBe(false);
  });

  // ─── 查询 ──────────────────────────────────────────────────

  test("getAgent 返回正确的 Agent 定义", () => {
    registerAgent(testAgent);
    const agent = getAgent("test-agent")!;
    expect(agent.name).toBe("test-agent");
    expect(agent.mode).toBe("primary");
    expect(agent.prompt).toBe("你是一个测试 Agent。");
  });

  test("getAgent 对不存在的 Agent 返回 undefined", () => {
    expect(getAgent("nonexistent")).toBeUndefined();
  });

  test("listAgents 返回所有已注册 Agent", () => {
    const before = listAgents().length;
    registerAgent(testAgent);
    const after = listAgents();
    expect(after.length).toBe(before + 1);
    expect(after.some((a) => a.name === "test-agent")).toBe(true);
  });

  test("listAgentsByMode 过滤 primary", () => {
    registerAgents([testAgent, subAgent, allModeAgent]);
    const primaries = listAgentsByMode("primary");
    expect(primaries.every((a) => a.mode === "primary" || a.mode === "all")).toBe(true);
    expect(primaries.some((a) => a.name === "test-agent")).toBe(true);
    expect(primaries.some((a) => a.name === "test-all-mode")).toBe(true);
  });

  test("listAgentsByMode 过滤 subagent", () => {
    registerAgents([testAgent, subAgent, allModeAgent]);
    const subs = listAgentsByMode("subagent");
    expect(subs.every((a) => a.mode === "subagent" || a.mode === "all")).toBe(true);
    expect(subs.some((a) => a.name === "test-subagent")).toBe(true);
    expect(subs.some((a) => a.name === "test-all-mode")).toBe(true);
  });

  test("listPrimaryAgents 只返回 primary 和 all 模式", () => {
    registerAgents([testAgent, subAgent]);
    const primaries = listPrimaryAgents();
    expect(primaries.some((a) => a.name === "test-agent")).toBe(true);
    expect(primaries.some((a) => a.name === "test-subagent")).toBe(false);
  });

  test("listSubagents 只返回 subagent 和 all 模式", () => {
    registerAgents([testAgent, subAgent]);
    const subs = listSubagents();
    expect(subs.some((a) => a.name === "test-subagent")).toBe(true);
    expect(subs.some((a) => a.name === "test-agent")).toBe(false);
  });

  // ─── 内置 Agent ────────────────────────────────────────────

  test("内置 Agent 初始化", () => {
    expect(hasAgent("general")).toBe(true);
    expect(hasAgent("plan")).toBe(true);
    expect(hasAgent("review")).toBe(true);
    expect(hasAgent("explore")).toBe(true);
  });

  test("general 是 all 模式", () => {
    const general = getAgent("general")!;
    expect(general.mode).toBe("all");
    expect(general.label).toBe("General Agent");
  });

  test("review 是 subagent 模式", () => {
    const review = getAgent("review")!;
    expect(review.mode).toBe("subagent");
  });

  test("explore 有工具白名单", () => {
    const explore = getAgent("explore")!;
    expect(explore.allowedTools).toBeDefined();
    expect(explore.allowedTools!.length).toBeGreaterThan(0);
  });

  // ─── 活跃 Agent ───────────────────────────────────────────

  test("默认活跃 Agent 是 general", () => {
    expect(getActiveAgentName()).toBe("general");
  });

  test("setActiveAgent 切换活跃 Agent", () => {
    registerAgent(testAgent);
    const result = setActiveAgent("test-agent");
    expect(result).toBe(true);
    expect(getActiveAgentName()).toBe("test-agent");
  });

  test("setActiveAgent 对不存在的 Agent 返回 false", () => {
    const result = setActiveAgent("nonexistent");
    expect(result).toBe(false);
    expect(getActiveAgentName()).toBe("general");
  });

  test("getActiveAgent 返回当前活跃 Agent 定义", () => {
    const agent = getActiveAgent();
    expect(agent).toBeDefined();
    expect(agent!.name).toBe("general");
  });

  // ─── Agent 状态 ───────────────────────────────────────────

  test("初始 Agent 状态是 idle", () => {
    registerAgent(testAgent);
    expect(getAgentStatus("test-agent")).toBe("idle");
  });

  test("setAgentStatus 更新状态", () => {
    registerAgent(testAgent);
    const changed = setAgentStatus("test-agent", "thinking");
    expect(changed).toBe(true);
    expect(getAgentStatus("test-agent")).toBe("thinking");
  });

  test("setAgentStatus 相同状态返回 false", () => {
    registerAgent(testAgent);
    const changed = setAgentStatus("test-agent", "idle");
    expect(changed).toBe(false);
  });

  test("resetAllAgentStatus 重置所有状态", () => {
    registerAgent(testAgent);
    setAgentStatus("test-agent", "running");
    resetAllAgentStatus();
    expect(getAgentStatus("test-agent")).toBe("idle");
    expect(getAgentStatus("general")).toBe("idle");
  });

  test("未注册 Agent 的状态默认是 idle", () => {
    expect(getAgentStatus("nonexistent")).toBe("idle");
  });

  // ─── T7 边界补充 ──────────────────────────────────────────

  test("listAgentsByMode('all') 返回全部 Agent", () => {
    const all = listAgentsByMode("all");
    const baseCount = listAgents().length;
    expect(all.length).toBe(baseCount);
  });

  test("setActiveAgent 切换后发布 AgentSelected 事件", async () => {
    registerAgent(testAgent);
    const { globalBus } = await import("@/bus/core/eventBus");
    const { AppEvent } = await import("@/bus/events");

    let received: any = null;
    const unsub = globalBus.subscribe(AppEvent.AgentSelected, (evt: any) => {
      received = evt.properties;
    });

    setActiveAgent("test-agent");

    await new Promise((r) => setTimeout(r, 100));
    unsub();

    expect(received).not.toBeNull();
    expect(received.agentName).toBe("test-agent");
    expect(received.previousAgent).toBeDefined();
  });

  test("setActiveAgent 切换后再切回原 Agent 正常", () => {
    registerAgent(testAgent);
    setActiveAgent("test-agent");
    expect(getActiveAgentName()).toBe("test-agent");

    const result = setActiveAgent("general");
    expect(result).toBe(true);
    expect(getActiveAgentName()).toBe("general");
  });

  test("重复注册同名 Agent 覆盖定义", () => {
    registerAgent({ ...testAgent, description: "v1" });
    registerAgent({ ...testAgent, description: "v2" });

    const agent = getAgent("test-agent");
    expect(agent?.description).toBe("v2");
  });

  test("unregisterAgent 后 getAgent 返回 undefined", () => {
    registerAgent(testAgent);
    expect(getAgent("test-agent")).toBeDefined();

    unregisterAgent("test-agent");
    expect(getAgent("test-agent")).toBeUndefined();
  });

  test("hidden Agent 不出现在 listPrimaryAgents 中", () => {
    _resetAll();
    registerAgent({ ...testAgent, hidden: true, mode: "primary", name: "hidden-test" });
    const primaries = listPrimaryAgents();
    expect(primaries.find((a) => a.name === "hidden-test")).toBeUndefined();
  });
});
