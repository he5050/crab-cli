/**
 * SubAgentResolver AI 路径测试。
 *
 * 测试目标:
 *   - 验证 subAgentResolver 在 AI 返回 JSON 时的解析与字段归一化
 *
 * 测试用例:
 *   - 使用 AI 返回的 JSON 结果并归一化非法字段
 */
// @ts-nocheck
import { beforeEach, describe, expect, mock, test } from "bun:test";

describe("subAgentResolver AI 路径", () => {
  beforeEach(() => {
    mock.restore();
  });

  test("使用 AI JSON 结果与规范化无效字段", async () => {
    const mod = await import("@/agent/subagent/resolver.ts");
    mod.__setSubAgentResolverDepsForTesting({
      completeLlm: async () => ({
        text: '{"needsSubAgent":true,"agentType":"ghost-agent","confidence":0.91,"taskDescription":"inspect repo","requiredTools":["codebase-search"],"complexity":99,"priority":"urgent","reason":"llm"}',
      }),
    });
    const result = await mod.resolveSubAgent(
      "请帮我分析这个仓库",
      "ctx",
      { confidenceThreshold: 0.99, useAI: true },
      { defaultProvider: { model: "test-model" } },
    );

    expect(result.needsSubAgent).toBe(true);
    expect(result.agentType).toBe("none");
    expect(result.complexity).toBe(10);
    expect(result.priority).toBe("medium");
    expect(result.requiredTools).toEqual(["codebase-search"]);
  });

  test("回退回至默认当 AI 返回无效 JSON", async () => {
    const mod = await import("@/agent/subagent/resolver.ts");
    mod.__setSubAgentResolverDepsForTesting({
      completeLlm: async () => ({ text: "not-json-response" }),
    });
    const result = await mod.resolveSubAgent(
      "普通问题",
      "",
      { confidenceThreshold: 0.99, useAI: true },
      { defaultProvider: { model: "test-model" } },
    );

    expect(result.needsSubAgent).toBe(false);
    expect(result.agentType).toBe("none");
    expect(result.reason).toContain("无法确定");
  });

  test("keeps keyword match when AI says no but quick match found an agent", async () => {
    const mod = await import("@/agent/subagent/resolver.ts");
    mod.__setSubAgentResolverDepsForTesting({
      completeLlm: async () => ({
        text: '{"needsSubAgent":false,"agentType":"none","confidence":0.2,"taskDescription":"x","requiredTools":[],"complexity":1,"priority":"low","reason":"no"}',
      }),
    });
    const result = await mod.resolveSubAgent(
      "请 review 一下这段代码并做安全审计",
      "",
      { confidenceThreshold: 0.99, useAI: true },
      { defaultProvider: { model: "test-model" } },
    );

    expect(result.needsSubAgent).toBe(true);
    expect(result.agentType).toBe("security");
    expect(result.reason).toContain("关键词匹配");
  });

  test("loads config lazily when llmConfig is omitted", async () => {
    const completeLlm = mock(async () => ({
      text: '{"needsSubAgent":true,"agentType":"docs","confidence":0.75,"taskDescription":"summarize","requiredTools":[],"complexity":3,"priority":"low","reason":"loaded config"}',
    }));
    const mod = await import("@/agent/subagent/resolver.ts");
    mod.__setSubAgentResolverDepsForTesting({
      completeLlm,
      loadConfig: async () => ({ defaultProvider: { model: "loaded-model" } }) as any,
    });
    const result = await mod.resolveSubAgent("请帮我总结一下", "", {
      availableAgents: ["docs"],
      confidenceThreshold: 0.99,
      useAI: true,
    });

    expect(result.needsSubAgent).toBe(true);
    expect(result.agentType).toBe("docs");
    expect(completeLlm).toHaveBeenCalled();
  });

  test("covers keyword tool inference, complexity and priority estimation branches", async () => {
    const mod = await import("@/agent/subagent/resolver.ts");
    mod.__setSubAgentResolverDepsForTesting({
      completeLlm: async () => ({ text: "" }),
    });

    const critical = await mod.resolveSubAgent("紧急 crash 需要实现新的代码生成流程并修复问题", "", {
      availableAgents: ["general", "plan", "explore"],
      confidenceThreshold: 0.2,
      useAI: false,
    });
    expect(critical.agentType).toBe("general");
    expect(critical.requiredTools).toContain("filesystem-write");
    expect(critical.priority).toBe("critical");
    expect(critical.complexity).toBe(2);

    const high = await mod.resolveSubAgent("重要 architecture design for service layering", "", {
      availableAgents: ["plan"],
      confidenceThreshold: 0.2,
      useAI: false,
    });
    expect(high.agentType).toBe("plan");
    expect(high.requiredTools).toContain("codebase-search");
    expect(high.priority).toBe("high");

    const low = await mod.resolveSubAgent(`${"可选 later explore repository structure ".repeat(20)}`, "", {
      availableAgents: ["explore"],
      confidenceThreshold: 0.2,
      useAI: false,
    });
    expect(low.agentType).toBe("explore");
    expect(low.priority).toBe("low");
    expect(low.complexity).toBe(8);
  });

  test("返回默认结果当懒配置加载中失败与无关键词匹配存在", async () => {
    const mod = await import("@/agent/subagent/resolver.ts");
    mod.__setSubAgentResolverDepsForTesting({
      completeLlm: async () => ({ text: "" }),
      loadConfig: async () => {
        throw new Error("config unavailable");
      },
    });
    const result = await mod.resolveSubAgent("plain greeting", "", {
      availableAgents: ["docs"],
      confidenceThreshold: 0.99,
      useAI: true,
    });

    expect(result.needsSubAgent).toBe(false);
    expect(result.agentType).toBe("none");
    expect(result.reason).toContain("无法确定");
  });

  test("includes registered custom subagents in deterministic routing", async () => {
    const manager = await import("@/agent/core/manager");
    manager._resetAll();
    manager.registerAgent({
      allowedTools: ["grep"],
      description: "合规检查专用子代理",
      keywords: ["合规", "compliance"],
      label: "Compliance Custom",
      mode: "subagent",
      name: "compliance-custom",
      options: {},
      prompt: "合规检查",
    });

    const mod = await import("@/agent/subagent/resolver.ts");
    mod.__resetSubAgentResolverDepsForTesting();
    const result = await mod.resolveSubAgent("请做一次合规检查", "", { confidenceThreshold: 0.2, useAI: false });

    expect(result.needsSubAgent).toBe(true);
    expect(result.agentType).toBe("compliance-custom");
    expect(result.requiredTools).toEqual(["grep"]);

    manager.unregisterAgent("compliance-custom");
  });
});
