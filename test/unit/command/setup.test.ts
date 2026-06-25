/**
 * Setup 命令单元测试 — 覆盖纯函数和常量结构。
 *
 * 交互式流程（readline）因依赖 stdin/stdout mock 成本高，
 * 仅测试可提取的纯逻辑函数，保证核心校验逻辑正确。
 */
import { describe, expect, test } from "bun:test";
import { validateApiKeyFormat, validateChoice, PROVIDERS } from "@/command/config/setup";
import type { ProviderOption } from "@/command/type";

describe("validateApiKeyFormat", () => {
  test("OpenAI 有效 key — 标准 sk- 前缀", () => {
    expect(validateApiKeyFormat("openai", "sk-abc123def456ghi789jkl012")).toBeNull();
  });

  test("OpenAI 有效 key — sk-proj- 前缀", () => {
    expect(validateApiKeyFormat("openai", "sk-proj-abc123def456ghi789jkl012mno")).toBeNull();
  });

  test("OpenAI 无效 key — 缺少 sk- 前缀", () => {
    expect(validateApiKeyFormat("openai", "invalid-key")).not.toBeNull();
  });

  test("OpenAI 无效 key — 长度不足", () => {
    expect(validateApiKeyFormat("openai", "sk-short")).not.toBeNull();
  });

  test("Anthropic 有效 key", () => {
    expect(validateApiKeyFormat("anthropic", "sk-ant-abc123def456ghi789jkl")).toBeNull();
  });

  test("Anthropic 无效 key — 缺少 sk-ant- 前缀", () => {
    expect(validateApiKeyFormat("anthropic", "sk-abc123def456")).not.toBeNull();
  });

  test("Anthropic 无效 key — 长度不足", () => {
    expect(validateApiKeyFormat("anthropic", "sk-ant-short")).not.toBeNull();
  });

  test("Google 有效 key", () => {
    expect(validateApiKeyFormat("google", "AIzaSyA1B2C3D4E5F6G7H8I9J0")).toBeNull();
  });

  test("Google 无效 key — 缺少 AIza 前缀", () => {
    expect(validateApiKeyFormat("google", "invalid-key")).not.toBeNull();
  });

  test("Custom provider — 无格式校验，始终通过", () => {
    expect(validateApiKeyFormat("custom", "any-string-here")).toBeNull();
    expect(validateApiKeyFormat("custom", "")).toBeNull();
  });

  test("未知 provider — 无模式匹配，始终通过", () => {
    expect(validateApiKeyFormat("unknown_provider", "some-key")).toBeNull();
  });
});

describe("validateChoice", () => {
  test("有效选项 — 返回对应数字", () => {
    expect(validateChoice("1", 1, 4, 1)).toBe(1);
    expect(validateChoice("2", 1, 4, 1)).toBe(2);
    expect(validateChoice("4", 1, 4, 1)).toBe(4);
  });

  test("空字符串 — 返回 fallback", () => {
    expect(validateChoice("", 1, 4, 1)).toBe(1);
  });

  test("非数字输入 — 返回 fallback", () => {
    expect(validateChoice("abc", 1, 4, 1)).toBe(1);
  });

  test("超出范围 — 小于 min 返回 fallback", () => {
    expect(validateChoice("0", 1, 4, 1)).toBe(1);
    expect(validateChoice("-1", 1, 4, 1)).toBe(1);
  });

  test("超出范围 — 大于 max 返回 fallback", () => {
    expect(validateChoice("5", 1, 4, 1)).toBe(1);
    expect(validateChoice("99", 1, 4, 1)).toBe(1);
  });

  test("浮点数 — parseInt 截断后判断", () => {
    // "1.5" → parseInt → 1 → 有效
    expect(validateChoice("1.5", 1, 4, 1)).toBe(1);
    // "3.9" → parseInt → 3 → 有效
    expect(validateChoice("3.9", 1, 4, 1)).toBe(3);
  });

  test("自定义 fallback 值", () => {
    expect(validateChoice("x", 1, 3, 2)).toBe(2);
    expect(validateChoice("", 5, 10, 7)).toBe(7);
  });
});

describe("PROVIDERS 常量", () => {
  test("包含 4 个 Provider", () => {
    expect(PROVIDERS).toHaveLength(4);
  });

  test("每个 Provider 包含必需字段", () => {
    for (const p of PROVIDERS as ProviderOption[]) {
      expect(p.id).toBeDefined();
      expect(p.name).toBeDefined();
      expect(p.defaultModel).toBeDefined();
      expect(p.method).toBeDefined();
    }
  });

  test("Provider ID 无重复", () => {
    const ids = PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("包含预期的 Provider ID", () => {
    const ids = PROVIDERS.map((p) => p.id);
    expect(ids).toContain("openai");
    expect(ids).toContain("anthropic");
    expect(ids).toContain("google");
    expect(ids).toContain("custom");
  });

  test("每个 Provider 有非空的 defaultModel", () => {
    for (const p of PROVIDERS as ProviderOption[]) {
      expect(p.defaultModel.length).toBeGreaterThan(0);
    }
  });
});
