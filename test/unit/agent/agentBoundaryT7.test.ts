/**
 * T7 现有测试边界补充 — agent-manager ⚠️ 项。
 *
 * 补充覆盖:
 *   - listAgentsByMode("all")
 *   - setActiveAgent 事件验证
 *   - 重复注册覆盖
 *   - hidden agent 过滤
 *   - subAgentTracker 生命周期
 */
import { beforeEach, describe, expect, test } from "bun:test";
import {
  _resetAll,
  getActiveAgentName,
  getAgent,
  initBuiltinAgents,
  listAgentsByMode,
  listPrimaryAgents,
  registerAgent,
  setActiveAgent,
  unregisterAgent,
} from "@/agent";
import { subAgentTracker } from "@/agent/subagent/tracker";
import type { AgentInfo } from "@/agent";

const testAgent = {
  description: "T7 boundary test",
  mode: "all",
  name: "t7-test-agent",
  prompt: "test",
} as any;

describe("T7 agent-manager 边界补充", () => {
  beforeEach(() => {
    _resetAll();
    initBuiltinAgents();
    setActiveAgent("general");
  });

  describe("listAgentsByMode 边界", () => {
    test("'all' 返回全部 agent", () => {
      const all = listAgentsByMode("all");
      expect(all.length).toBeGreaterThan(0);
      // 应包含内置 general
      expect(all.some((a) => a.name === "general")).toBe(true);
    });

    test("mode='primary' 只含 primary 和 all", () => {
      registerAgent({ ...testAgent, mode: "primary", name: "t7-primary" });
      registerAgent({ ...testAgent, mode: "subagent", name: "t7-sub" });
      registerAgent({ ...testAgent, mode: "all", name: "t7-both" });

      const result = listAgentsByMode("primary");
      const names = result.map((a) => a.name);
      expect(names).toContain("t7-primary");
      expect(names).toContain("t7-both");
      expect(names).not.toContain("t7-sub");
    });

    test("mode='subagent' 只含 subagent 和 all", () => {
      registerAgent({ ...testAgent, mode: "primary", name: "t7-primary2" });
      registerAgent({ ...testAgent, mode: "subagent", name: "t7-sub2" });

      const result = listAgentsByMode("subagent");
      const names = result.map((a) => a.name);
      expect(names).toContain("t7-sub2");
      expect(names).not.toContain("t7-primary2");
    });
  });

  describe("setActiveAgent 边界", () => {
    test("切换后 getActiveAgentName 更新", () => {
      registerAgent(testAgent);
      setActiveAgent("t7-test-agent");
      expect(getActiveAgentName()).toBe("t7-test-agent");
    });

    test("切回默认 agent 成功", () => {
      registerAgent(testAgent);
      setActiveAgent("t7-test-agent");
      const result = setActiveAgent("general");
      expect(result).toBe(true);
      expect(getActiveAgentName()).toBe("general");
    });

    test("空字符串 agent 名返回 false", () => {
      expect(setActiveAgent("")).toBe(false);
    });
  });

  describe("已隐藏代理", () => {
    test("hidden 不出现在 listPrimaryAgents", () => {
      registerAgent({ ...testAgent, hidden: true, mode: "primary", name: "t7-hidden" });
      const primaries = listPrimaryAgents();
      expect(primaries.find((a) => a.name === "t7-hidden")).toBeUndefined();
    });
  });

  describe("重复注册", () => {
    test("覆盖已注册的同名 agent", () => {
      registerAgent({ ...testAgent, description: "v1" });
      registerAgent({ ...testAgent, description: "v2" });
      expect(getAgent("t7-test-agent")?.description).toBe("v2");
    });
  });
});

describe("T7 subAgentTracker 生命周期", () => {
  beforeEach(() => {
    subAgentTracker.clear();
  });

  test("register 后 isRunning 返回 true", () => {
    subAgentTracker.register({
      agentId: "test",
      agentName: "tester",
      instanceId: "t7-tracker-1",
      prompt: "test prompt",
    });

    expect(subAgentTracker.isRunning("t7-tracker-1")).toBe(true);
    expect(subAgentTracker.size).toBeGreaterThan(0);
  });

  test("unregister 后 isRunning 返回 false", () => {
    subAgentTracker.register({
      agentId: "test",
      agentName: "remover",
      instanceId: "t7-tracker-2",
    });

    subAgentTracker.unregister("t7-tracker-2");
    expect(subAgentTracker.isRunning("t7-tracker-2")).toBe(false);
  });

  test("listener 接收 registered/unregistered 事件", () => {
    const events: string[] = [];
    const unsub = subAgentTracker.subscribe((evt) => {
      events.push(evt.type);
    });

    subAgentTracker.register({
      agentId: "test",
      agentName: "listener-test",
      instanceId: "t7-tracker-3",
    });

    subAgentTracker.unregister("t7-tracker-3");
    unsub();

    expect(events).toContain("registered");
    expect(events).toContain("unregistered");
  });

  test("injectMessage 添加到队列", () => {
    subAgentTracker.register({
      agentId: "test",
      agentName: "msg-test",
      instanceId: "t7-tracker-4",
    });

    const result = subAgentTracker.injectMessage("t7-tracker-4", "hello from T7");
    expect(result).toBe(true);

    // 验证消息可以被取出
    const msgs = subAgentTracker.dequeueMessages("t7-tracker-4");
    expect(msgs).toContain("hello from T7");
  });

  test("injectMessage 对未注册的 instanceId 返回 false", () => {
    const result = subAgentTracker.injectMessage("nonexistent", "msg");
    expect(result).toBe(false);
  });

  test("abortAll 终止所有运行中的 agent", () => {
    const controller = new AbortController();
    subAgentTracker.register({
      abortController: controller,
      agentId: "test",
      agentName: "abort-test",
      instanceId: "t7-tracker-5",
    });

    subAgentTracker.abortAll();
    expect(controller.signal.aborted).toBe(true);
  });

  test("listRunning 返回已注册的 agent", () => {
    subAgentTracker.register({
      agentId: "test",
      agentName: "run-test",
      instanceId: "t7-tracker-6",
    });

    const running = subAgentTracker.listRunning();
    expect(running.some((a) => a.instanceId === "t7-tracker-6")).toBe(true);
  });

  test("listRunning 返回正确的字段", () => {
    subAgentTracker.register({
      agentId: "test-agent-id",
      agentName: "field-test",
      instanceId: "t7-tracker-7",
      prompt: "test prompt",
    });

    const running = subAgentTracker.listRunning();
    const entry = running.find((a) => a.instanceId === "t7-tracker-7");
    expect(entry).toBeDefined();
    expect(entry!.agentId).toBe("test-agent-id");
    expect(entry!.agentName).toBe("field-test");
    expect(entry!.startedAt).toBeInstanceOf(Date);
  });

  test("sendInterAgentMessage 成功传递", () => {
    subAgentTracker.register({
      agentId: "sender",
      agentName: "Sender",
      instanceId: "t7-from",
    });
    subAgentTracker.register({
      agentId: "receiver",
      agentName: "Receiver",
      instanceId: "t7-to",
    });

    const result = subAgentTracker.sendInterAgentMessage("t7-from", "t7-to", "hello");
    expect(result).toBe(true);

    const msgs = subAgentTracker.dequeueInterAgentMessages("t7-to");
    expect(msgs.length).toBe(1);
    expect(msgs[0]!.content).toBe("hello");
    expect(msgs[0]!.fromAgentName).toBe("Sender");
  });

  test("clear 清空所有追踪", () => {
    subAgentTracker.register({
      agentId: "test",
      agentName: "clear-test",
      instanceId: "t7-clear-test",
    });
    expect(subAgentTracker.size).toBeGreaterThan(0);

    subAgentTracker.clear();
    expect(subAgentTracker.size).toBe(0);
    expect(subAgentTracker.listRunning()).toEqual([]);
  });

  test("getRuntimeState 提供统一运行态快照", () => {
    subAgentTracker.register({
      agentId: "agent-a",
      agentName: "Agent A",
      instanceId: "t7-runtime-a",
    });
    subAgentTracker.register({
      agentId: "agent-b",
      agentName: "Agent B",
      instanceId: "t7-runtime-b",
    });
    subAgentTracker.injectMessage("t7-runtime-a", "hello");

    const runtimeState = subAgentTracker.getRuntimeState();
    expect(runtimeState.runningAgents).toHaveLength(2);
    expect(runtimeState.totalQueuedMessages).toBe(1);
    expect(runtimeState.orphanedResultCount).toBe(0);
    expect(runtimeState.hasSpawnedResults).toBe(false);
  });
});
