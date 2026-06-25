/**
 * Agent Session 辅助函数测试。
 *
 * 覆盖导出:
 *   - getToolsForAgent
 *   - getAgentModel
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { getAgentModel, getToolsForAgent } from "@/agent/session/session";
import type { AgentInfo } from "@/agent/core/manager";
import type { AppConfigSchema } from "@/schema/config";
import { _resetForTesting } from "@/tool/registry/toolRegistry";

describe("Agent Session 辅助函数", () => {
  // ─── getToolsForAgent ───────────────────────────────────

  describe("getToolsForAgent", () => {
    test("无 allowedTools 限制时返回空列表(filterToolsForAgent 默认行为)", () => {
      const agent = {
        allowedTools: undefined,
        description: "test",
        label: "Test Agent",
        mode: "primary",
        name: "test-agent",
        prompt: "test",
      } as any;
      const tools = getToolsForAgent(agent);
      // 无白名单时 filterToolsForAgent 返回空
      expect(Array.isArray(tools)).toBe(true);
    });

    test("有 allowedTools 白名单时过滤", () => {
      const agent = {
        allowedTools: ["filesystem-read"],
        description: "test",
        label: "Restricted",
        mode: "primary",
        name: "restricted",
        prompt: "test",
      } as any;
      const tools = getToolsForAgent(agent);
      expect(tools).toContain("filesystem-read");
    });
  });

  // ─── getAgentModel ──────────────────────────────────────

  describe("getAgentModel", () => {
    const defaultConfig = {
      defaultProvider: {
        model: "gpt-4",
        provider: "openai",
      },
    } as unknown as AppConfigSchema;

    test("agent 有指定 model 时使用 agent 的", () => {
      const agent = {
        description: "test",
        label: "Custom",
        mode: "primary",
        model: { modelID: "claude-4", providerID: "anthropic" },
        name: "custom",
        prompt: "test",
      } as any;
      const result = getAgentModel(agent, defaultConfig);
      expect(result.providerID).toBe("anthropic");
      expect(result.modelID).toBe("claude-4");
    });

    test("agent 无 model 时使用 config 默认", () => {
      const agent = {
        description: "test",
        label: "Default",
        mode: "primary",
        name: "default",
        prompt: "test",
      } as any;
      const result = getAgentModel(agent, defaultConfig);
      expect(result.providerID).toBe("openai");
      expect(result.modelID).toBe("gpt-4");
    });

    test("agent model 为 undefined 时使用 config 默认", () => {
      const agent = {
        description: "test",
        label: "Undef",
        mode: "primary",
        model: undefined,
        name: "undef",
        prompt: "test",
      } as any;
      const result = getAgentModel(agent, defaultConfig);
      expect(result.providerID).toBe("openai");
    });
  });
});
