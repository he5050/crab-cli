/**
 * [测试目标] Agent Manager — 注册、查询、状态管理。
 *
 * 测试用例:
 *   - registerAgent 注册单个 Agent
 *   - unregisterAgent 注销 Agent 并重置活跃状态
 *   - getAgent / listAgents / hasAgent 查询功能
 *   - listAgentsByMode / listPrimaryAgents / listSubagents 过滤功能
 *   - setActiveAgent / getActiveAgent 活跃 Agent 切换
 *   - setAgentStatus / getAgentStatus 状态管理
 *   - initBuiltinAgents 内置 Agent 初始化
 *   - _resetAll 测试清理
 */
import { afterEach, describe, expect, test, mock } from "bun:test";
import {
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
  resetAllAgentStatus,
  setActiveAgent,
  setAgentStatus,
  unregisterAgent,
  type AgentInfo,
  type AgentMode,
} from "@/agent/core";
import { globalBus, type EventBus } from "@/bus";
import { AppEvent } from "@/bus";

afterEach(() => {
  _resetAll();
});

describe("Agent Manager - 注册与查询", () => {
  test("registerAgent 注册单个 Agent", () => {
    const agent: AgentInfo = {
      name: "test-agent",
      label: "Test Agent",
      description: "A test agent",
      mode: "primary",
      prompt: "You are a test agent",
      options: {},
    };
    registerAgent(agent);

    expect(hasAgent("test-agent")).toBe(true);
    expect(getAgent("test-agent")).toEqual(agent);
  });

  test("registerAgent 拒绝空名称", () => {
    const agent: AgentInfo = {
      name: "",
      label: "Empty",
      description: "Should be rejected",
      mode: "primary",
      prompt: "test",
      options: {},
    };
    registerAgent(agent);

    expect(hasAgent("")).toBe(false);
    expect(getAgent("")).toBeUndefined();
  });

  test("unregisterAgent 注销 Agent", () => {
    const agent: AgentInfo = {
      name: "to-delete",
      label: "To Delete",
      description: "Will be deleted",
      mode: "primary",
      prompt: "test",
      options: {},
    };
    registerAgent(agent);
    expect(hasAgent("to-delete")).toBe(true);

    const result = unregisterAgent("to-delete");
    expect(result).toBe(true);
    expect(hasAgent("to-delete")).toBe(false);
  });

  test("unregisterAgent 注销不存在的 Agent 返回 false", () => {
    const result = unregisterAgent("nonexistent");
    expect(result).toBe(false);
  });

  test("listAgents 返回所有已注册 Agent", () => {
    registerAgent({ name: "a", label: "A", description: "", mode: "primary", prompt: "", options: {} });
    registerAgent({ name: "b", label: "B", description: "", mode: "subagent", prompt: "", options: {} });

    const agents = listAgents();
    expect(agents).toHaveLength(2);
    expect(agents.map((a) => a.name)).toContain("a");
    expect(agents.map((a) => a.name)).toContain("b");
  });

  test("hasAgent 检查存在性", () => {
    registerAgent({ name: "exists", label: "", description: "", mode: "primary", prompt: "", options: {} });
    expect(hasAgent("exists")).toBe(true);
    expect(hasAgent("missing")).toBe(false);
  });
});

describe("Agent Manager - 按模式过滤", () => {
  test("listAgentsByMode('primary') 返回 primary 和 all 模式", () => {
    registerAgent({ name: "p", label: "", description: "", mode: "primary", prompt: "", options: {} });
    registerAgent({ name: "s", label: "", description: "", mode: "subagent", prompt: "", options: {} });
    registerAgent({ name: "a", label: "", description: "", mode: "all", prompt: "", options: {} });

    const primary = listAgentsByMode("primary");
    expect(primary).toHaveLength(2);
    expect(primary.map((a) => a.name)).toContain("p");
    expect(primary.map((a) => a.name)).toContain("a");
  });

  test("listAgentsByMode('subagent') 返回 subagent 和 all 模式", () => {
    registerAgent({ name: "p", label: "", description: "", mode: "primary", prompt: "", options: {} });
    registerAgent({ name: "s", label: "", description: "", mode: "subagent", prompt: "", options: {} });
    registerAgent({ name: "a", label: "", description: "", mode: "all", prompt: "", options: {} });

    const sub = listAgentsByMode("subagent");
    expect(sub).toHaveLength(2);
    expect(sub.map((a) => a.name)).toContain("s");
    expect(sub.map((a) => a.name)).toContain("a");
  });

  test("listAgentsByMode('all') 返回所有 Agent", () => {
    registerAgent({ name: "p", label: "", description: "", mode: "primary", prompt: "", options: {} });
    registerAgent({ name: "s", label: "", description: "", mode: "subagent", prompt: "", options: {} });

    const all = listAgentsByMode("all");
    expect(all).toHaveLength(2);
  });

  test("listPrimaryAgents 排除 hidden Agent 并按活跃优先排序", () => {
    registerAgent({
      name: "hidden",
      label: "",
      description: "",
      mode: "primary",
      prompt: "",
      options: {},
      hidden: true,
    });
    registerAgent({ name: "visible", label: "", description: "", mode: "primary", prompt: "", options: {} });
    registerAgent({ name: "active", label: "", description: "", mode: "primary", prompt: "", options: {} });

    setActiveAgent("active");

    const primary = listPrimaryAgents();
    expect(primary).toHaveLength(2);
    expect(primary[0]?.name).toBe("active");
    expect(primary.map((a) => a.name)).not.toContain("hidden");
  });

  test("listSubagents 返回 subagent 和 all 模式", () => {
    registerAgent({ name: "p", label: "", description: "", mode: "primary", prompt: "", options: {} });
    registerAgent({ name: "s", label: "", description: "", mode: "subagent", prompt: "", options: {} });
    registerAgent({ name: "a", label: "", description: "", mode: "all", prompt: "", options: {} });

    const subs = listSubagents();
    expect(subs).toHaveLength(2);
    expect(subs.map((a) => a.name)).toContain("s");
    expect(subs.map((a) => a.name)).toContain("a");
  });
});

describe("Agent Manager - 活跃 Agent 切换", () => {
  test("setActiveAgent 切换活跃 Agent", () => {
    registerAgent({ name: "a", label: "A", description: "", mode: "primary", prompt: "", options: {} });
    registerAgent({ name: "b", label: "B", description: "", mode: "primary", prompt: "", options: {} });

    expect(getActiveAgentName()).toBe("general");

    const result = setActiveAgent("a");
    expect(result).toBe(true);
    expect(getActiveAgentName()).toBe("a");
  });

  test("setActiveAgent 切换不存在的 Agent 返回 false", () => {
    const result = setActiveAgent("nonexistent");
    expect(result).toBe(false);
  });

  test("getActiveAgent 返回活跃 Agent 定义", () => {
    const agent: AgentInfo = {
      name: "active",
      label: "Active",
      description: "The active one",
      mode: "primary",
      prompt: "test",
      options: {},
    };
    registerAgent(agent);
    setActiveAgent("active");

    const active = getActiveAgent();
    expect(active).toEqual(agent);
  });

  test("getActiveAgent 在无活跃设置时 fallback 到 general 或首个 primary", () => {
    registerAgent({ name: "general", label: "General", description: "", mode: "all", prompt: "", options: {} });

    const active = getActiveAgent();
    expect(active?.name).toBe("general");
  });

  test("unregisterAgent 注销当前活跃 Agent 时重置活跃状态", () => {
    registerAgent({ name: "active", label: "", description: "", mode: "primary", prompt: "", options: {} });
    setActiveAgent("active");
    expect(getActiveAgentName()).toBe("active");

    unregisterAgent("active");
    expect(getActiveAgentName()).toBe("general");
  });
});

describe("Agent Manager - 状态管理", () => {
  test("setAgentStatus 设置 Agent 状态", () => {
    registerAgent({ name: "agent", label: "", description: "", mode: "primary", prompt: "", options: {} });

    expect(getAgentStatus("agent")).toBe("idle");

    const result = setAgentStatus("agent", "running");
    expect(result).toBe(true);
    expect(getAgentStatus("agent")).toBe("running");
  });

  test("setAgentStatus 设置相同状态返回 false", () => {
    registerAgent({ name: "agent", label: "", description: "", mode: "primary", prompt: "", options: {} });

    setAgentStatus("agent", "idle");
    const result = setAgentStatus("agent", "idle");
    expect(result).toBe(false);
  });

  test("resetAllAgentStatus 重置所有状态为 idle", () => {
    registerAgent({ name: "a", label: "", description: "", mode: "primary", prompt: "", options: {} });
    registerAgent({ name: "b", label: "", description: "", mode: "primary", prompt: "", options: {} });

    setAgentStatus("a", "running");
    setAgentStatus("b", "error");

    resetAllAgentStatus();

    expect(getAgentStatus("a")).toBe("idle");
    expect(getAgentStatus("b")).toBe("idle");
  });

  test("getAgentStatus 对未注册 Agent 返回 idle", () => {
    expect(getAgentStatus("unknown")).toBe("idle");
  });
});

describe("Agent Manager - initBuiltinAgents", () => {
  test("initBuiltinAgents 初始化内置 Agent 并设置默认活跃", () => {
    initBuiltinAgents();

    const agents = listAgents();
    expect(agents.length).toBeGreaterThan(0);

    const active = getActiveAgent();
    expect(active).toBeDefined();
  });

  test("initBuiltinAgents 幂等性 — 多次调用只初始化一次", () => {
    initBuiltinAgents();
    const count1 = listAgents().length;

    initBuiltinAgents();
    const count2 = listAgents().length;

    expect(count1).toBe(count2);
  });
});

describe("Agent Manager - 事件发布(P3)", () => {
  test("setActiveAgent 发布 agentSelected 事件", () => {
    registerAgent({ name: "a", label: "A", description: "", mode: "primary", prompt: "", options: {} });

    const events: unknown[] = [];
    const unsub = globalBus.subscribe(AppEvent.AgentSelected, (e) => events.push(e.properties));
    setActiveAgent("a");
    globalBus.flushSync();
    unsub();

    expect(events).toHaveLength(1);
    const evt = events[0] as { agentName: string; previousAgent: string };
    expect(evt.agentName).toBe("a");
  });

  test("setActiveAgent 切换失败发布 Toast 错误事件", () => {
    const events: { message: string; variant: string }[] = [];
    const unsub = globalBus.subscribe(AppEvent.Toast, (e) => events.push(e.properties as never));
    setActiveAgent("nonexistent");
    globalBus.flushSync();
    unsub();

    expect(events).toHaveLength(1);
    expect(events[0]!.variant).toBe("error");
    expect(events[0]!.message).toContain("不存在");
  });

  test("setAgentStatus 发布 agentStatusChanged 事件", () => {
    registerAgent({ name: "s", label: "", description: "", mode: "primary", prompt: "", options: {} });

    const events: unknown[] = [];
    const unsub = globalBus.subscribe(AppEvent.AgentStatusChanged, (e) => events.push(e.properties));
    setAgentStatus("s", "running");
    globalBus.flushSync();
    unsub();

    expect(events).toHaveLength(1);
    const evt = events[0] as { agentName: string; status: string; previousStatus: string };
    expect(evt.agentName).toBe("s");
    expect(evt.status).toBe("running");
    expect(evt.previousStatus).toBe("idle");
  });

  test("setAgentStatus 相同状态不发布事件", () => {
    registerAgent({ name: "s", label: "", description: "", mode: "primary", prompt: "", options: {} });

    const events: unknown[] = [];
    const unsub = globalBus.subscribe(AppEvent.AgentStatusChanged, (e) => events.push(e.properties));
    setAgentStatus("s", "idle"); // already idle
    unsub();

    expect(events).toHaveLength(0);
  });

  test("listAgentsByMode('all') 包含 mode=all 的 Agent", () => {
    registerAgent({ name: "p", label: "", description: "", mode: "primary", prompt: "", options: {} });
    registerAgent({ name: "a", label: "", description: "", mode: "all", prompt: "", options: {} });

    const result = listAgentsByMode("all");
    expect(result).toHaveLength(2);
  });
});

describe("Agent Manager - _resetAll", () => {
  test("_resetAll 清理所有状态", () => {
    registerAgent({ name: "test", label: "", description: "", mode: "primary", prompt: "", options: {} });
    setActiveAgent("test");
    setAgentStatus("test", "running");

    _resetAll();

    expect(listAgents()).toHaveLength(0);
    expect(hasAgent("test")).toBe(false);
    expect(getActiveAgentName()).toBe("general");
    expect(getAgentStatus("test")).toBe("idle");
  });
});
