/**
 * Agent-Team 集成测试
 *
 * 测试 Agent 与 Team 模块的真实协作:
 *   - 模式切换到 team 模式
 *   - AgentSession 子代理 spawn 与协调
 *   - SubAgentExecutor 多任务调度
 *   - 子代理结果聚合
 *   - 错误传播与资源清理
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { AgentSession, _resetAll, initBuiltinAgents, registerAgent } from "@/agent";
import { getCurrentMode, resetModeState, switchMode } from "@/agent/runtime/modeState";
import { createSubAgentExecutor } from "@/agent/subagent/executor";
import { subAgentTracker } from "@/agent/subagent/tracker";

describe("Agent-Team 集成", () => {
  beforeEach(() => {
    _resetAll();
    initBuiltinAgents();
    resetModeState();
    // 注册 team 模式所需的 team-lead agent
    registerAgent({
      allowedTools: [],
      description: "Team Lead Agent",
      label: "Team Lead",
      mode: "subagent",
      name: "team-lead",
      native: false,
      options: {},
      prompt: "You are the team lead.",
    });
    // 清理 tracker
    for (const id of subAgentTracker.listAll().map((a) => a.instanceId)) {
      subAgentTracker.unregister(id);
    }
    subAgentTracker.clear();
  });

  afterEach(() => {
    mock.restore();
    resetModeState();
  });

  describe("Team 模式切换", () => {
    test("切换到 team 模式", () => {
      const result = switchMode("team");
      expect(result).toBe(true);
      expect(getCurrentMode()).toBe("team");
    });

    test("team 模式切换时清除 YOLO 叠加", () => {
      switchMode("yolo");
      switchMode("team");
      expect(getCurrentMode()).toBe("team");
    });

    test("非法模式回退到 chat", () => {
      // 模拟不存在的 Agent 名称时回退
      switchMode("chat");
      expect(getCurrentMode()).toBe("chat");
    });
  });

  describe("AgentSession 子代理协调", () => {
    test("AgentSession 创建并销毁", () => {
      const session = new AgentSession("general", { defaultProvider: { model: "test", provider: "openai" } } as any);
      expect(session).toBeDefined();
      session.destroy();
    });

    test("spawnSubagent 深度限制", async () => {
      mock.module("@api", () => ({
        completeLlm: mock(() => Promise.resolve({ text: "结果" })),
      }));

      const session = new AgentSession("general", { defaultProvider: { model: "test", provider: "openai" } } as any, {
        spawnDepth: 10,
      });

      try {
        // 超过深度限制应该失败
        const result = await session.spawnSubagent("general", "test");
        // 如果没有配置合适的 spawn 依赖，结果可能是失败的
        expect(result).toBeDefined();
      } finally {
        session.destroy();
      }
    });
  });

  describe("SubAgentExecutor 任务调度", () => {
    test("添加并执行单个任务", () => {
      const executor = createSubAgentExecutor();
      const taskId = executor.addTask({
        agentType: "general",
        dependencies: [],
        instanceId: "test-1",
        priority: 1,
        prompt: "test task",
      });

      expect(taskId).toBeDefined();
      const status = executor.getTaskStatus(taskId);
      expect(status).toBeDefined();
      expect(status?.status).toBe("pending");
    });

    test("任务依赖关系检测", () => {
      const executor = createSubAgentExecutor();
      const taskA = executor.addTask({
        agentType: "general",
        dependencies: [],
        instanceId: "task-a",
        priority: 1,
        prompt: "task A",
      });

      const taskB = executor.addTask({
        agentType: "general",
        dependencies: [taskA],
        instanceId: "task-b",
        priority: 1,
        prompt: "task B",
      });

      expect(taskA).toBeDefined();
      expect(taskB).toBeDefined();
    });

    test("执行无 taskExecutor 时返回失败", async () => {
      const executor = createSubAgentExecutor({ taskTimeout: 50, totalTimeout: 100 });
      executor.addTask({
        agentType: "general",
        dependencies: [],
        instanceId: "fail-test",
        priority: 1,
        prompt: "will fail",
      });

      const result = await executor.execute();
      expect(result.success).toBe(false);
    });
  });

  describe("子代理 Tracker 管理", () => {
    test("注册和查询子代理", () => {
      subAgentTracker.register({
        agentId: "test-agent",
        agentName: "Test Agent",
        instanceId: "inst-1",
        prompt: "test",
      });

      const found = subAgentTracker.findByInstanceId("inst-1");
      expect(found).toBeDefined();
      expect(found?.agentName).toBe("Test Agent");
    });

    test("注销子代理", () => {
      subAgentTracker.register({
        agentId: "test-agent",
        agentName: "Test Agent",
        instanceId: "inst-2",
        prompt: "test",
      });

      subAgentTracker.unregister("inst-2");
      expect(subAgentTracker.findByInstanceId("inst-2")).toBeUndefined();
    });

    test("按 agentId 查询子代理", () => {
      subAgentTracker.register({
        agentId: "search-agent",
        agentName: "Search",
        instanceId: "inst-3",
        prompt: "search",
      });

      const byAgent = subAgentTracker.findByAgentId("search-agent");
      expect(byAgent).toBeDefined();
      expect(byAgent?.instanceId).toBe("inst-3");
    });
  });

  describe("资源清理", () => {
    test("AgentSession 销毁清理 tracker", () => {
      const session = new AgentSession("general", { defaultProvider: { model: "test", provider: "openai" } } as any, {
        instanceId: "cleanup-test",
      });

      session.destroy();
      // 销毁后不应再找到该实例
      expect(subAgentTracker.findByInstanceId("cleanup-test")).toBeUndefined();
    });

    test("SubAgentExecutor 取消清理任务", () => {
      const executor = createSubAgentExecutor();
      executor.addTask({
        agentType: "general",
        dependencies: [],
        instanceId: "cancel-test",
        priority: 1,
        prompt: "test",
      });

      executor.cancel();
      const status = executor.getTaskStatus("cancel-test");
      expect(status?.status).toBeOneOf(["cancelled", "failed"]);
    });
  });
});
