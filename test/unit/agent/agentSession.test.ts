/**
 * Agent 会话测试。
 *
 * 测试用例:
 *   - Agent 启动
 *   - 消息路由
 *   - 状态同步
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { AgentSession, type AgentSessionResult, getAgentModel, getToolsForAgent } from "@/agent/session/session";
import {
  type AgentInfo,
  _resetAll,
  getAgent,
  initBuiltinAgents,
  registerAgent,
  setActiveAgent,
  unregisterAgent,
} from "@/agent";
import type { AppConfigSchema } from "@/schema/config";

// ─── 测试配置 ────────────────────────────────────────────────

const mockConfig: AppConfigSchema = {
  agents: [],
  customHeaders: {},
  defaultProvider: {
    model: "gpt-4",
    provider: "openai",
  },
  devMode: false,
  maxContextTokens: 200_000,
  maxSpawnDepth: 3,
  permissions: [],
  profile: "default",
  providerConfig: {},
  proxy: { browserDebugPort: 9222, enabled: false, port: 7890, searchEngine: "duckduckgo" },
  sensitiveCommands: { commands: [], enabled: true },
  theme: "dark",
  toolResultTokenLimitPercent: 30,
} as unknown as AppConfigSchema;

const testAgent: AgentInfo = {
  description: "用于测试 AgentSession",
  label: "会话测试",
  mode: "primary",
  name: "session-test",
  options: {},
  prompt: "你是一个测试 Agent。",
};

describe("Agent Session", () => {
  beforeEach(() => {
    _resetAll();
    initBuiltinAgents();
    registerAgent(testAgent);
    setActiveAgent("general");
  });

  // ─── 创建 ──────────────────────────────────────────────────

  test("创建 AgentSession 成功", () => {
    const session = new AgentSession("session-test", mockConfig);
    expect(session.getAgentName()).toBe("session-test");
    expect(session.getStatus()).toBe("idle");
    session.destroy();
  });

  test("创建不存在的 Agent 抛出错误", () => {
    expect(() => new AgentSession("nonexistent", mockConfig)).toThrow("Agent 未找到");
  });

  test("getAgentInfo 返回正确的 Agent 定义", () => {
    const session = new AgentSession("session-test", mockConfig);
    const info = session.getAgentInfo();
    expect(info.name).toBe("session-test");
    expect(info.mode).toBe("primary");
    session.destroy();
  });

  test("getHandler 返回 ConversationHandler", () => {
    const session = new AgentSession("session-test", mockConfig);
    const handler = session.getHandler();
    expect(handler).toBeDefined();
    expect(typeof handler.sendMessage).toBe("function");
    session.destroy();
  });

  test("getMessages 初始为空数组", () => {
    const session = new AgentSession("session-test", mockConfig);
    const messages = session.getMessages();
    expect(Array.isArray(messages)).toBe(true);
    expect(messages.length).toBe(0);
    session.destroy();
  });

  test("getSubagentTasks 初始为空数组", () => {
    const session = new AgentSession("session-test", mockConfig);
    const tasks = session.getSubagentTasks();
    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks.length).toBe(0);
    session.destroy();
  });

  // ─── 生命周期 ──────────────────────────────────────────────

  test("clearHistory 清空对话历史", () => {
    const session = new AgentSession("session-test", mockConfig);
    session.clearHistory();
    expect(session.getMessages().length).toBe(0);
    session.destroy();
  });

  test("destroy 后状态为 idle", () => {
    const session = new AgentSession("session-test", mockConfig);
    session.destroy();
    expect(session.getStatus()).toBe("idle");
  });

  // ─── 工具函数 ──────────────────────────────────────────────

  test("getToolsForAgent 无白名单返回所有工具", () => {
    const agent = getAgent("session-test")!;
    const tools = getToolsForAgent(agent);
    expect(Array.isArray(tools)).toBe(true);
    // 应至少包含内置工具
    expect(tools.length).toBeGreaterThan(0);
  });

  test("getToolsForAgent 有白名单返回过滤后的工具", () => {
    const restricted: AgentInfo = {
      allowedTools: ["filesystem-read"],
      description: "受限 Agent",
      label: "受限",
      mode: "subagent",
      name: "restricted-session",
      options: {},
      prompt: "test",
    };
    const tools = getToolsForAgent(restricted);
    expect(tools).toEqual(["filesystem-read"]);
  });

  test("getAgentModel 使用 Agent 自定义模型", () => {
    const agentWithModel: AgentInfo = {
      description: "有自定义模型的 Agent",
      label: "模型测试",
      mode: "primary",
      model: { modelID: "claude-4", providerID: "anthropic" },
      name: "model-test",
      options: {},
      prompt: "test",
    };
    const model = getAgentModel(agentWithModel, mockConfig);
    expect(model.providerID).toBe("anthropic");
    expect(model.modelID).toBe("claude-4");
  });

  test("getAgentModel 无自定义模型使用全局默认", () => {
    const agent = getAgent("session-test")!;
    const model = getAgentModel(agent, mockConfig);
    expect(model.providerID).toBe("openai");
    expect(model.modelID).toBe("gpt-4");
  });

  // ─── Spawn 深度和安全保护 ──────────────────────────────────

  test("spawnSubagent 拒绝 spawn 同类型 Agent(self-spawn 保护)", async () => {
    const session = new AgentSession("session-test", mockConfig);
    const result = await session.spawnSubagent("session-test", "test prompt");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("不允许 spawn 同类型的子代理");
    expect(session.getSubagentTasks().length).toBe(0);
    session.destroy();
  });

  test("spawnSubagent 深度限制阻止过度递归", async () => {
    // 创建一个处于最大深度的 session
    const session = new AgentSession("session-test", mockConfig, {
      spawnDepth: 3, // MAX_SPAWN_DEPTH = 3
    });

    // 注册一个目标 agent
    const targetAgent: AgentInfo = {
      description: "用于测试 spawn 限制",
      label: "Spawn 目标",
      mode: "subagent",
      name: "spawn-target",
      options: {},
      prompt: "test",
    };
    registerAgent(targetAgent);

    const result = await session.spawnSubagent("spawn-target", "test prompt");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("递归深度已达上限");
    expect(session.getSubagentTasks().length).toBe(0);

    unregisterAgent("spawn-target");
    session.destroy();
  });

  test("spawnSubagent 深度未达上限时允许 spawn", async () => {
    const session = new AgentSession("session-test", mockConfig, {
      spawnDepth: 2, // MAX_SPAWN_DEPTH = 3, 还差 1
    });

    // 注册一个目标 agent
    const targetAgent: AgentInfo = {
      description: "用于测试 spawn 允许",
      label: "Spawn OK",
      mode: "subagent",
      name: "spawn-ok",
      options: {},
      prompt: "test",
    };
    registerAgent(targetAgent);

    // 注意:spawnSubagent 会尝试创建 AgentSession 并调用 sendMessage
    // 由于没有真实的 LLM，sendMessage 会失败，但 spawn 本身不会被拦截
    const result = await session.spawnSubagent("spawn-ok", "test prompt");
    // Spawn 应该被允许(不会返回深度限制错误)
    expect(String(result.error ?? "")).not.toContain("递归深度已达上限");

    unregisterAgent("spawn-ok");
    session.destroy();
  });

  test("AgentSession 接受 spawnDepth 选项", () => {
    const session = new AgentSession("session-test", mockConfig, {
      spawnDepth: 2,
    });
    expect(session.getAgentName()).toBe("session-test");
    session.destroy();
  });
});
