/**
 * Agent 配置解析测试 — parseAgentConfigs, configToAgent, validateAgentConfig。
 *
 * 测试用例:
 *   - validateAgentConfig 通过有效配置
 *   - validateAgentConfig 空 ID 返回错误
 *   - validateAgentConfig 缺少必填字段返回错误
 *   - validateAgentConfig temperature 超范围返回错误
 *   - parseAgentConfigs 数组格式
 *   - parseAgentConfigs 对象格式 { roles: [...] }
 *   - parseAgentConfigs 无效输入返回空数组
 *   - parseAgentConfigs 过滤无效角色
 *   - configToAgent 使用默认值
 *   - configToAgent 保留所有字段
 *   - configToAgent 设置 native=false(custom agent)
 */
import { describe, expect, test } from "bun:test";
import { configToAgent, parseAgentConfigs, validateAgentConfig } from "@/config";

const validConfig = {
  availableTools: ["filesystem-read", "filesystem-write"],
  color: "blue",
  description: "用于开发测试",
  icon: "🛠",
  id: "custom-dev",
  maxSteps: 50,
  name: "自定义开发者",
  systemPrompt: "你是一个开发者。",
  tags: ["开发"],
  temperature: 0.7,
  topP: 0.9,
};

describe("validateAgentConfig", () => {
  test("有效配置通过验证", () => {
    const result = validateAgentConfig(validConfig);
    expect(result.ok).toBe(true);
  });

  test("空 id 返回错误", () => {
    const result = validateAgentConfig({ ...validConfig, id: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("id");
    }
  });

  test("缺少必填字段返回错误", () => {
    const result = validateAgentConfig({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeDefined();
    }
  });

  test("temperature 超范围返回错误", () => {
    const result = validateAgentConfig({ ...validConfig, temperature: 3 });
    expect(result.ok).toBe(false);
  });

  test("null 输入返回错误", () => {
    const result = validateAgentConfig(null);
    expect(result.ok).toBe(false);
  });
});

describe("parseAgentConfigs", () => {
  test("数组格式", () => {
    const result = parseAgentConfigs([validConfig]);
    expect(result.length).toBe(1);
    expect(result[0]!.id).toBe("custom-dev");
  });

  test("对象格式 { roles: [...] }", () => {
    const result = parseAgentConfigs({ roles: [validConfig] });
    expect(result.length).toBe(1);
  });

  test("无效输入返回空数组", () => {
    expect(parseAgentConfigs(null)).toEqual([]);
    expect(parseAgentConfigs("string")).toEqual([]);
    expect(parseAgentConfigs(123)).toEqual([]);
  });

  test("过滤无效角色", () => {
    const result = parseAgentConfigs([validConfig, { id: "", name: "" }]);
    expect(result.length).toBe(1);
  });

  test("空数组返回空数组", () => {
    expect(parseAgentConfigs([])).toEqual([]);
  });

  test("空对象 {} 返回空数组", () => {
    expect(parseAgentConfigs({})).toEqual([]);
  });
});

describe("configToAgent", () => {
  test("使用默认值填充可选字段", () => {
    const minimal = { id: "x", name: "X" };
    const agent = configToAgent(minimal);
    expect(agent.name).toBe("x");
    expect(agent.label).toBe("X");
    expect(agent.prompt).toBe("你是一位X。");
    expect(agent.icon).toBe("🤖");
    expect(agent.native).toBeUndefined();
  });

  test("保留所有提供的字段", () => {
    const agent = configToAgent(validConfig);
    expect(agent.name).toBe("custom-dev");
    expect(agent.label).toBe("自定义开发者");
    expect(agent.description).toBe("用于开发测试");
    expect(agent.allowedTools).toEqual(["filesystem-read", "filesystem-write"]);
    expect(agent.steps).toBe(50);
    expect(agent.temperature).toBe(0.7);
    expect(agent.topP).toBe(0.9);
  });
});
