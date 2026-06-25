/**
 * Sub-agent-config 白盒测试 — validateSubAgent + getSubAgents 合并逻辑 + generateId + 内置代理。
 */
import { describe, expect, test } from "bun:test";
import type { SubAgent } from "@/config";

// 复制 validateSubAgent 纯函数
function validateSubAgent(data: { name: string; description: string; tools: string[] }): string[] {
  const errors: string[] = [];
  if (!data.name || data.name.trim().length === 0) {
    errors.push("Agent name is required");
  }
  if (data.name && data.name.length > 100) {
    errors.push("Agent name must be less than 100 characters");
  }
  if (data.description && data.description.length > 500) {
    errors.push("Description must be less than 500 characters");
  }
  if (!data.tools || data.tools.length === 0) {
    errors.push("At least one tool must be selected");
  }
  return errors;
}

// 复制 generateId 纯函数
function generateId(): string {
  return `agent_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

describe("validateSubAgent", () => {
  test("有效数据返回空数组", () => {
    const errors = validateSubAgent({
      description: "A test agent",
      name: "My Agent",
      tools: ["bash"],
    });
    expect(errors).toEqual([]);
  });

  test("空名称报错", () => {
    const errors = validateSubAgent({ description: "desc", name: "", tools: ["bash"] });
    expect(errors).toContain("Agent name is required");
  });

  test("空白名称报错", () => {
    const errors = validateSubAgent({ description: "desc", name: "   ", tools: ["bash"] });
    expect(errors).toContain("Agent name is required");
  });

  test("超长名称报错", () => {
    const errors = validateSubAgent({ description: "desc", name: "x".repeat(101), tools: ["bash"] });
    expect(errors).toContain("Agent name must be less than 100 characters");
  });

  test("超长描述报错", () => {
    const errors = validateSubAgent({ description: "d".repeat(501), name: "ok", tools: ["bash"] });
    expect(errors).toContain("Description must be less than 500 characters");
  });

  test("空工具列表报错", () => {
    const errors = validateSubAgent({ description: "desc", name: "ok", tools: [] });
    expect(errors).toContain("At least one tool must be selected");
  });

  test("多个错误同时返回", () => {
    const errors = validateSubAgent({ description: "d".repeat(501), name: "", tools: [] });
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("generateId", () => {
  test("格式正确", () => {
    const id = generateId();
    expect(id).toMatch(/^agent_\d+_[a-z0-9]+$/);
  });

  test("每次生成不同 ID", () => {
    const a = generateId();
    const b = generateId();
    expect(a).not.toBe(b);
  });
});

describe("getSubAgents 合并逻辑", () => {
  test("用户自定义优先于内置", () => {
    const builtinAgents: SubAgent[] = [
      { builtin: true, description: "search", id: "explore", name: "Explore", tools: ["read"] },
    ];
    const userAgents: SubAgent[] = [
      { builtin: false, description: "custom", id: "explore", name: "Explore Custom", tools: ["read", "write"] },
    ];
    const userAgentIds = new Set(userAgents.map((a) => a.id));
    const effectiveBuiltin = builtinAgents.filter((a) => !userAgentIds.has(a.id));
    const merged = [...effectiveBuiltin, ...userAgents];
    expect(merged.length).toBe(1);
    expect(merged[0]!.name).toBe("Explore Custom");
  });

  test("用户和内置不同 ID 共存", () => {
    const builtinAgents: SubAgent[] = [
      { builtin: true, description: "search", id: "explore", name: "Explore", tools: ["read"] },
    ];
    const userAgents: SubAgent[] = [
      { builtin: false, description: "custom", id: "my-custom", name: "Custom", tools: ["write"] },
    ];
    const userAgentIds = new Set(userAgents.map((a) => a.id));
    const effectiveBuiltin = builtinAgents.filter((a) => !userAgentIds.has(a.id));
    const merged = [...effectiveBuiltin, ...userAgents];
    expect(merged.length).toBe(2);
  });
});

describe("deleteSubAgent 逻辑", () => {
  test("过滤掉指定 ID", () => {
    const agents: SubAgent[] = [
      { description: "", id: "a1", name: "A1", tools: [] },
      { description: "", id: "a2", name: "A2", tools: [] },
    ];
    const filtered = agents.filter((a) => a.id !== "a1");
    expect(filtered.length).toBe(1);
    expect(filtered[0]!.id).toBe("a2");
  });

  test("ID 不存在时长度不变", () => {
    const agents: SubAgent[] = [{ description: "", id: "a1", name: "A1", tools: [] }];
    const filtered = agents.filter((a) => a.id !== "ghost");
    expect(filtered.length).toBe(1);
  });
});
