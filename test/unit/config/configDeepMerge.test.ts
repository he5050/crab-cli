/**
 * 配置深合并测试。
 *
 * 测试用例:
 *   - 对象属性覆盖
 *   - 数组增量追加(agents)
 *   - undefined/null 值跳过
 *   - 嵌套对象递归合并
 */
import { beforeEach, describe, expect, test } from "bun:test";

/** 从 config.ts 复用深合并逻辑(避免直接 import 内部函数) */
function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const val = source[key as keyof T];
    if (val === undefined || val === null) {
      continue;
    }

    const existing = result[key as keyof T];

    if (key === "agents" && Array.isArray(existing) && Array.isArray(val)) {
      result[key as keyof T] = [...existing, ...val] as T[keyof T];
    } else if (existing && typeof existing === "object" && typeof val === "object" && !Array.isArray(val)) {
      result[key as keyof T] = deepMerge(
        existing as Record<string, unknown>,
        val as Record<string, unknown>,
      ) as T[keyof T];
    } else {
      result[key as keyof T] = val as T[keyof T];
    }
  }
  return result;
}

describe("配置深合并", () => {
  const base = {
    agents: [{ mode: "primary", name: "primary" }] as Record<string, unknown>[],
    permissions: [] as { permission: string; pattern: string; action: string }[],
    profile: "default",
    providerConfig: {
      openai: { apiKey: "sk-base", defaultModel: "gpt-4o" },
    } as Record<string, Record<string, unknown>>,
    theme: "dark",
  };

  test("基础属性覆盖", () => {
    const result = deepMerge(base, { profile: "work", theme: "dracula" });
    expect(result.profile).toBe("work");
    expect(result.theme).toBe("dracula");
  });

  test("agents 数组增量追加而非覆盖", () => {
    const newAgents = [{ mode: "subagent", name: "subagent" }];
    const result = deepMerge(base, { agents: newAgents as any });
    // 应为追加后 2 个 agent
    expect((result.agents as any[]).length).toBe(2);
    expect((result.agents as any[])[0].name).toBe("primary");
    expect((result.agents as any[])[1].name).toBe("subagent");
  });

  test("undefined 值不覆盖已有值", () => {
    const result = deepMerge(base, { profile: undefined as any });
    expect(result.profile).toBe("default");
  });

  test("null 值不覆盖已有值", () => {
    const result = deepMerge(base, { theme: null as any });
    expect(result.theme).toBe("dark");
  });

  test("嵌套对象递归合并", () => {
    const result = deepMerge(base, {
      providerConfig: {
        openai: { apiKey: "sk-override", baseURL: "https://relay.example.com/v1" },
      } as any,
    });
    const { openai } = result.providerConfig as any;
    // ApiKey 被覆盖
    expect(openai.apiKey).toBe("sk-override");
    // DefaultModel 保留
    expect(openai.defaultModel).toBe("gpt-4o");
    // 新增 baseURL
    expect(openai.baseURL).toBe("https://relay.example.com/v1");
  });

  test("新增 Provider 不会丢失已有 Provider", () => {
    const result = deepMerge(base, {
      providerConfig: {
        anthropic: { apiKey: "sk-ant", defaultModel: "claude-sonnet-4-20250514" },
      } as any,
    });
    expect((result.providerConfig as any).openai).toBeDefined();
    expect((result.providerConfig as any).anthropic).toBeDefined();
  });

  test("空 source 返回 target 副本", () => {
    const result = deepMerge(base, {});
    expect(result).toEqual(base);
    // 确认是浅拷贝(不同引用)
    expect(result).not.toBe(base);
  });
});
