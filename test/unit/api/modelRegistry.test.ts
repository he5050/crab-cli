/**
 * P3-6: modelRegistry searchModels 边缘用例与能力查询测试
 *
 * 测试目标:
 * - searchModels 按模型 ID 子串匹配
 * - searchModels 大小写不敏感
 * - searchModels 空查询返回所有模型
 * - searchModels 无匹配返回空数组
 * - listModelsByProvider 按 providerId 过滤
 * - getModelCapabilities 对已知模型返回覆盖能力
 * - getModelCapabilities 对未知模型返回默认能力
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { searchModels, getModelCapabilities, listModelsByProvider } from "@/api/core/modelRegistry";

beforeEach(() => {
  mock.module("@/api/core/provider", () => ({
    listConfiguredProviders: () => ["openai", "anthropic"],
    getProviderModels: (_cfg: any, providerId: string) => {
      if (providerId === "openai") return ["gpt-4o", "gpt-4o-mini", "o1-mini"];
      if (providerId === "anthropic") return ["claude-3-5-sonnet-latest", "claude-3-opus-latest"];
      return [];
    },
    createProvider: () => {},
    getProviderConfig: () => ({}),
    getDefaultModelId: () => "gpt-4o",
    clearProviderCache: () => {},
    resolveRequestMethod: () => "chat",
  }));
});

const mockConfig = {
  defaultProvider: { provider: "openai", model: "gpt-4o" },
  providerConfig: {
    openai: { apiKey: "k", baseURL: "https://api.openai.com", requestMethod: "chat" },
    anthropic: { apiKey: "k", baseURL: "https://api.anthropic.com", requestMethod: "chat" },
  },
} as any;

describe("searchModels", () => {
  test("按模型 ID 子串匹配", () => {
    const results = searchModels(mockConfig, "gpt");
    const ids = results.map((m) => m.id);
    expect(ids).toContain("gpt-4o");
    expect(ids).toContain("gpt-4o-mini");
    expect(ids).not.toContain("o1-mini");
  });

  test("大小写不敏感", () => {
    const results = searchModels(mockConfig, "GPT-4O");
    const ids = results.map((m) => m.id);
    expect(ids).toContain("gpt-4o");
    expect(ids).toContain("gpt-4o-mini");
  });

  test("空查询返回所有模型", () => {
    const results = searchModels(mockConfig, "");
    expect(results.length).toBe(5);
  });

  test("无匹配返回空数组", () => {
    const results = searchModels(mockConfig, "nonexistent");
    expect(results).toEqual([]);
  });
});

describe("listModelsByProvider", () => {
  test("按 providerId 过滤", () => {
    const models = listModelsByProvider(mockConfig, "openai");
    expect(models.length).toBe(3);
    expect(models.every((m) => m.providerId === "openai")).toBe(true);
  });

  test("不存在的 provider 返回空数组", () => {
    const models = listModelsByProvider(mockConfig, "google");
    expect(models).toEqual([]);
  });
});

describe("getModelCapabilities", () => {
  test("对已知模型返回覆盖能力", () => {
    const caps = getModelCapabilities("o1-mini");
    expect(caps.reasoning).toBe(true);
    expect(caps.tools).toBe(false);
    expect(caps.vision).toBe(false);
    expect(caps.jsonMode).toBe(false);
  });

  test("对未知模型返回默认能力", () => {
    const caps = getModelCapabilities("unknown-model");
    expect(caps.vision).toBe(true);
    expect(caps.tools).toBe(true);
    expect(caps.reasoning).toBe(true);
    expect(caps.jsonMode).toBe(true);
  });
});
