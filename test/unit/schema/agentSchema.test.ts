/**
 * Agent Schema 测试。
 *
 * 测试用例:
 *   - AgentMode 枚举值
 *   - AgentModel 结构验证
 *   - AgentName refine（旧内置名拒绝 + 空名拒绝）
 *   - AgentDefinition 最小/完整定义
 *   - AgentDefinition 默认值与边界
 */
import { describe, expect, test } from "bun:test";
import { AgentDefinition, AgentMode, AgentModel } from "@/schema/agent";

describe("Agent Schema", () => {
  describe("AgentMode 枚举", () => {
    test("三种合法模式", () => {
      expect(AgentMode.safeParse("primary").success).toBe(true);
      expect(AgentMode.safeParse("subagent").success).toBe(true);
      expect(AgentMode.safeParse("all").success).toBe(true);
    });

    test("拒绝非法模式（含 hidden）", () => {
      expect(AgentMode.safeParse("invalid").success).toBe(false);
      expect(AgentMode.safeParse("hidden").success).toBe(false);
      expect(AgentMode.safeParse("").success).toBe(false);
    });
  });

  describe("AgentModel", () => {
    test("合法模型定义", () => {
      const model = { modelID: "gpt-4o", providerID: "openai" };
      expect(AgentModel.safeParse(model).success).toBe(true);
    });

    test("拒绝缺少字段", () => {
      expect(AgentModel.safeParse({ modelID: "gpt-4o" }).success).toBe(false);
      expect(AgentModel.safeParse({ providerID: "openai" }).success).toBe(false);
    });

    test("允许空字符串 ID（运行时由 provider 校验）", () => {
      expect(AgentModel.safeParse({ modelID: "", providerID: "" }).success).toBe(true);
    });
  });

  describe("AgentName refine", () => {
    test("拒绝空名称", () => {
      const agent = { mode: "primary" as const, name: "", permission: [] };
      expect(AgentDefinition.safeParse(agent).success).toBe(false);
    });

    test.each(["coder", "architect", "reviewer", "planner"])("拒绝旧内置 agent 名称: %s", (name) => {
      const agent = { mode: "subagent" as const, name, permission: [] };
      expect(AgentDefinition.safeParse(agent).success).toBe(false);
    });

    test("允许非保留自定义 agent 名称", () => {
      const agent = { mode: "subagent" as const, name: "migration-helper", permission: [] };
      expect(AgentDefinition.safeParse(agent).success).toBe(true);
    });

    test("允许内置非保留名称（explore/plan/general/review/qa/debug/security/docs）", () => {
      const builtins = ["explore", "plan", "general", "review", "qa", "debug", "security", "docs"];
      for (const name of builtins) {
        const agent = { mode: "primary" as const, name, permission: [] };
        expect(AgentDefinition.safeParse(agent).success).toBe(true);
      }
    });
  });

  describe("AgentDefinition", () => {
    test("最小定义验证通过", () => {
      const agent = { mode: "primary" as const, name: "general", permission: [] };
      expect(AgentDefinition.safeParse(agent).success).toBe(true);
    });

    test("完整定义验证通过", () => {
      const agent = {
        description: "代码编写助手",
        mode: "primary" as const,
        model: { modelID: "gpt-4o", providerID: "openai" },
        name: "general",
        options: { max_turns: 10 },
        permission: [{ action: "allow" as const, pattern: "git *", permission: "bash" }],
        prompt: "你是一个代码编写助手",
      };
      expect(AgentDefinition.safeParse(agent).success).toBe(true);
    });

    test("拒绝缺少必填字段", () => {
      expect(AgentDefinition.safeParse({ name: "test" }).success).toBe(false);
      expect(AgentDefinition.safeParse({ mode: "primary", permission: [] }).success).toBe(false);
    });

    test("options 默认空对象", () => {
      const parsed = AgentDefinition.parse({ mode: "primary", name: "test", permission: [] });
      expect(parsed.options).toEqual({});
    });

    test("permission 支持多条规则", () => {
      const agent = {
        mode: "primary" as const,
        name: "test",
        permission: [
          { action: "allow" as const, pattern: "git *", permission: "bash" },
          { action: "deny" as const, pattern: "rm -rf *", permission: "bash" },
        ],
      };
      const result = AgentDefinition.safeParse(agent);
      expect(result.success).toBe(true);
    });

    test("description 和 prompt 可选", () => {
      const agent = { mode: "subagent" as const, name: "minimal", permission: [] };
      const parsed = AgentDefinition.parse(agent);
      expect(parsed.description).toBeUndefined();
      expect(parsed.prompt).toBeUndefined();
    });

    test("model 可选", () => {
      const agent = { mode: "primary" as const, name: "no-model", permission: [] };
      const parsed = AgentDefinition.parse(agent);
      expect(parsed.model).toBeUndefined();
    });
  });
});
