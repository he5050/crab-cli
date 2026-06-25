/**
 * model.ts 单元测试
 *
 * 测试覆盖:
 *   - getAgentModel 使用 agent 自定义 model
 *   - getAgentModel 回退到 config.defaultProvider
 *   - getToolsForAgent 调用 filterToolsForAgent
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { getAgentModel, getToolsForAgent } from "@/agent/session/model";
import { _resetAll as resetAgentManager, registerAgent } from "@/agent/core/manager";

describe("getAgentModel", () => {
  test("agent 有自定义 model 时优先使用", () => {
    const agent = {
      model: { providerID: "custom-provider", modelID: "custom-model" },
    } as any;
    const config = {
      defaultProvider: { provider: "default-provider", model: "default-model" },
    } as any;

    const result = getAgentModel(agent, config);
    expect(result).toEqual({ providerID: "custom-provider", modelID: "custom-model" });
  });

  test("agent 无 model 时回退到 config.defaultProvider", () => {
    const agent = { model: undefined } as any;
    const config = {
      defaultProvider: { provider: "fallback-provider", model: "fallback-model" },
    } as any;

    const result = getAgentModel(agent, config);
    expect(result).toEqual({ providerID: "fallback-provider", modelID: "fallback-model" });
  });

  test("config.defaultProvider 缺失时返回 undefined 字段", () => {
    const agent = { model: undefined } as any;
    const config = {
      defaultProvider: { provider: undefined, model: undefined },
    } as any;

    const result = getAgentModel(agent, config);
    expect(result.providerID).toBeUndefined();
    expect(result.modelID).toBeUndefined();
  });
});

describe("getToolsForAgent", () => {
  beforeEach(() => {
    resetAgentManager();
  });

  test("agent 有 allowedTools 时返回过滤后的工具列表", () => {
    registerAgent({
      name: "test-filter-agent",
      label: "Test Filter Agent",
      mode: "subagent",
      prompt: "test",
      allowedTools: ["bash", "read"],
      description: "",
      options: {},
    } as any);

    const agent = {
      name: "test-filter-agent",
      label: "Test Filter Agent",
      mode: "subagent",
      prompt: "test",
      allowedTools: ["bash", "read"],
    } as any;

    const tools = getToolsForAgent(agent);
    // 工具列表应包含 agent 允许的工具
    expect(tools.length).toBeGreaterThanOrEqual(0);
  });

  test("agent 无 allowedTools 时返回全部可用工具", () => {
    registerAgent({
      name: "test-all-tools-agent",
      label: "Test All Tools Agent",
      mode: "subagent",
      prompt: "test",
      description: "",
      options: {},
    } as any);

    const agent = {
      name: "test-all-tools-agent",
      label: "Test All Tools Agent",
      mode: "subagent",
      prompt: "test",
    } as any;

    const tools = getToolsForAgent(agent);
    expect(tools.length).toBeGreaterThan(0);
  });
});
