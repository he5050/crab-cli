/**
 * 配置助手测试。
 *
 * 测试用例:
 *   - 配置读取
 *   - 配置写入
 *   - 配置验证
 */
import { describe, expect, test } from "bun:test";
import { getDefaultModel, getEnvKey, getProvider, listProviders } from "@/config";
import { getDefaultTheme, getThemeDefinition, listThemes } from "@/config";
import { DEFAULT_PERMISSIONS, filterRulesByPermission, getDefaultPermissions } from "@/config";
import {
  listBuiltinAgentDefinitions,
  getBuiltinAgentDefinition,
  BUILTIN_AGENT_NAMES,
} from "@/config/agents/agentDefinitions";

describe("API 配置辅助", () => {
  test("getProvider 返回 openai 元信息", () => {
    const p = getProvider("openai");
    expect(p).toBeDefined();
    expect(p!.name).toBe("OpenAI");
    expect(p!.defaultModel).toBe("gpt-4o");
    expect(p!.models.length).toBeGreaterThan(0);
  });

  test("getProvider 返回 anthropic 元信息", () => {
    const p = getProvider("anthropic");
    expect(p).toBeDefined();
    expect(p!.name).toBe("Anthropic");
  });

  test("getProvider 未知返回 undefined", () => {
    expect(getProvider("unknown")).toBeUndefined();
  });

  test("listProviders 返回 5 个提供商", () => {
    const list = listProviders();
    expect(list.length).toBe(5);
  });

  test("getDefaultModel 各提供商返回默认模型", () => {
    expect(getDefaultModel("openai")).toBe("gpt-4o");
    expect(getDefaultModel("anthropic")).toBe("claude-sonnet-4-20250514");
    expect(getDefaultModel("google")).toBe("gemini-2.5-pro");
  });

  test("getEnvKey 返回正确的环境变量名", () => {
    expect(getEnvKey("openai")).toBe("OPENAI_API_KEY");
    expect(getEnvKey("anthropic")).toBe("ANTHROPIC_API_KEY");
  });
});

describe("主题配置辅助", () => {
  test("getThemeDefinition dark 返回 One Dark", () => {
    const t = getThemeDefinition("dark");
    expect(t.name).toBe("one-dark");
    expect(t.mode).toBe("dark");
  });

  test("getThemeDefinition light 返回 One Light", () => {
    const t = getThemeDefinition("light");
    expect(t.name).toBe("one-light");
    expect(t.mode).toBe("light");
  });

  test("getThemeDefinition dracula", () => {
    const t = getThemeDefinition("dracula");
    expect(t.name).toBe("dracula");
    expect(t.colors.primary).toBe("#bd93f9");
  });

  test("getThemeDefinition 未知返回默认 dark", () => {
    const t = getThemeDefinition("nonexistent");
    expect(t.mode).toBe("dark");
  });

  test("listThemes 返回至少 3 个主题", () => {
    expect(listThemes().length).toBeGreaterThanOrEqual(3);
  });

  test("getDefaultTheme 返回 opencode", () => {
    expect(getDefaultTheme()).toBe("opencode");
  });
});

describe("权限配置辅助", () => {
  test("getDefaultPermissions 返回非空规则集", () => {
    const rules = getDefaultPermissions();
    expect(rules.length).toBeGreaterThan(0);
  });

  test("默认规则包含 fs.read allow", () => {
    const rules = getDefaultPermissions();
    const readRule = rules.find((r) => r.permission === "fs.read");
    expect(readRule).toBeDefined();
    expect(readRule!.action).toBe("allow");
  });

  test("默认规则包含 bash ask", () => {
    const rules = getDefaultPermissions();
    const bashRule = rules.find((r) => r.permission === "bash" && r.pattern === "*");
    expect(bashRule).toBeDefined();
    expect(bashRule!.action).toBe("ask");
  });

  test("默认规则包含危险操作 deny", () => {
    const rules = getDefaultPermissions();
    const denyRules = rules.filter((r) => r.action === "deny");
    expect(denyRules.length).toBeGreaterThan(0);
  });

  test("filterRulesByPermission 按工具名过滤", () => {
    const bashRules = filterRulesByPermission(DEFAULT_PERMISSIONS, "bash");
    expect(bashRules.length).toBeGreaterThan(0);
    bashRules.forEach((r) => expect(r.permission).toBe("bash"));
  });

  test("getDefaultPermissions 返回副本(修改不影响原始)", () => {
    const a = getDefaultPermissions();
    const b = getDefaultPermissions();
    a.push({ action: "allow", pattern: "*", permission: "test" });
    expect(b.length).toBeLessThan(a.length);
  });

  test("规则包含 metadata 字段", () => {
    const rules = getDefaultPermissions();
    for (const rule of rules) {
      expect(rule.metadata).toBeDefined();
      expect(rule.metadata!.description).toBeDefined();
    }
  });
});

describe("Agent 配置辅助", () => {
  test("getBuiltinAgentDefinition 通用", () => {
    const agent = getBuiltinAgentDefinition("general");
    expect(agent).toBeDefined();
  });

  test("getBuiltinAgentDefinition 计划", () => {
    const agent = getBuiltinAgentDefinition("plan");
    expect(agent).toBeDefined();
  });

  test("getBuiltinAgentDefinition 审查", () => {
    const agent = getBuiltinAgentDefinition("review");
    expect(agent).toBeDefined();
  });

  test("getBuiltinAgentDefinition 未知返回 undefined", () => {
    expect(getBuiltinAgentDefinition("nonexistent")).toBeUndefined();
  });

  test("listBuiltinAgentDefinitions 返回 registry 内置 agent", () => {
    expect(listBuiltinAgentDefinitions().map((agent: { name: string }) => agent.name)).toEqual([
      ...BUILTIN_AGENT_NAMES,
    ]);
  });
});
