/**
 * Provider 工厂测试。
 *
 * 测试用例:
 *   - Chat 模式
 *   - Responses 模式
 *   - Claude 模式
 *   - Gemini 模式
 *   - 缓存命中
 */
import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { AppConfigSchema } from "@/schema/config";
import {
  buildDerivedProviderConfig,
  buildInvalidProviderConfig,
  buildProviderConfigWithOverrides,
  hasLiveProviderConfig,
} from "../../helpers/realConfig";

// ─── 测试配置 ──────────────────────────────────────────────────

let CHAT_CONFIG: AppConfigSchema;
let RESPONSES_CONFIG: AppConfigSchema;
let CLAUDE_CONFIG: AppConfigSchema;
let GEMINI_CONFIG: AppConfigSchema;

// Top-level await 确保 skipIf 在模块加载时拿到正确的值
const hasRealProvider = await hasLiveProviderConfig();

beforeAll(async () => {
  CHAT_CONFIG = await buildDerivedProviderConfig({
    model: "test-model",
    providerId: "test",
    requestMethod: "chat",
  });
  CHAT_CONFIG.providerConfig.test = {
    ...CHAT_CONFIG.providerConfig.test!,
    modelList: ["test-model", "test-model-v2"],
  };

  RESPONSES_CONFIG = await buildDerivedProviderConfig({
    model: "gpt-4o",
    providerId: "openai",
    requestMethod: "responses",
  });

  CLAUDE_CONFIG = await buildDerivedProviderConfig({
    model: "claude-sonnet-4-20250514",
    providerId: "anthropic",
    requestMethod: "claude",
  });

  GEMINI_CONFIG = await buildDerivedProviderConfig({
    model: "gemini-2.0-flash",
    providerId: "google",
    requestMethod: "gemini",
  });
});

async function loadProviderModule() {
  // @ts-expect-error test-only cache busting for isolated module evaluation
  return import("@/api/core/provider.ts?provider-factory-test");
}

describe("Provider 工厂 — 基础查询", () => {
  test("listConfiguredProviders 返回所有配置的 Provider", async () => {
    const { listConfiguredProviders } = await loadProviderModule();
    const providers = listConfiguredProviders(CHAT_CONFIG);
    expect(providers).toContain("test");
  });

  test("getDefaultModelId 返回默认模型", async () => {
    const { getDefaultModelId } = await loadProviderModule();
    expect(getDefaultModelId(CHAT_CONFIG)).toBe("test-model");
  });

  test("getDefaultModelId 指定 Provider 返回其默认模型", async () => {
    const { getDefaultModelId } = await loadProviderModule();
    expect(getDefaultModelId(CHAT_CONFIG, "test")).toBe("test-model");
  });

  test("getDefaultModelId 未知 Provider 返回 gpt-4o 兜底", async () => {
    const { getDefaultModelId } = await loadProviderModule();
    expect(getDefaultModelId(CHAT_CONFIG, "nonexistent")).toBe("");
  });

  test("getProviderModels 返回模型列表", async () => {
    const { getProviderModels } = await loadProviderModule();
    const models = getProviderModels(CHAT_CONFIG, "test");
    expect(models).toEqual(["test-model", "test-model-v2"]);
  });

  test("getProviderModels 未配置 Provider 返回空数组", async () => {
    const { getProviderModels } = await loadProviderModule();
    expect(getProviderModels(CHAT_CONFIG, "nonexistent")).toEqual([]);
  });

  test("getProviderConfig 返回配置", async () => {
    const { getProviderConfig } = await loadProviderModule();
    const cfg = getProviderConfig(CHAT_CONFIG, "test");
    expect(cfg).toBeDefined();
    expect(cfg!.apiKey).toBe(CHAT_CONFIG.providerConfig.test!.apiKey);
    expect(cfg!.requestMethod).toBe("chat");
  });

  test("getProviderConfig 未配置返回 undefined", async () => {
    const { getProviderConfig } = await loadProviderModule();
    expect(getProviderConfig(CHAT_CONFIG, "nonexistent")).toBeUndefined();
  });

  test("模型级协议覆盖优先于 provider 默认协议", async () => {
    const { resolveRequestMethod } = await loadProviderModule();
    const config = await buildProviderConfigWithOverrides(
      {
        model: "claude-model",
        providerId: "mixed",
        requestMethod: "chat",
      },
      {
        modelRequestMethods: {
          "claude-model": "claude",
        },
      },
    );
    expect(resolveRequestMethod(config, "mixed", "claude-model")).toBe("claude");
    expect(resolveRequestMethod(config, "mixed", "other-model")).toBe("chat");
  });
});

// RequestMethod 路由和缓存测试需要真实 Provider SDK 实例，依赖 ~/.crab/config.json
describe.skipIf(!hasRealProvider)("Provider 工厂 — requestMethod 路由", () => {
  beforeEach(async () => {
    const { clearProviderCache } = await loadProviderModule();
    clearProviderCache();
  });

  test("chat 模式创建模型工厂", async () => {
    const { createProvider } = await loadProviderModule();
    const getModel = createProvider(CHAT_CONFIG, "test");
    expect(typeof getModel).toBe("function");
    const model = getModel("test-model");
    expect(model).toBeDefined();
  });

  test("responses 模式创建模型工厂", async () => {
    const { createProvider } = await loadProviderModule();
    const getModel = createProvider(RESPONSES_CONFIG, "openai");
    expect(typeof getModel).toBe("function");
    const model = getModel("gpt-4o");
    expect(model).toBeDefined();
  });

  test("claude 模式创建模型工厂", async () => {
    const { createProvider } = await loadProviderModule();
    const getModel = createProvider(CLAUDE_CONFIG, "anthropic");
    expect(typeof getModel).toBe("function");
    const model = getModel("claude-sonnet-4-20250514");
    expect(model).toBeDefined();
  });

  test("gemini 模式创建模型工厂", async () => {
    const { createProvider } = await loadProviderModule();
    const getModel = createProvider(GEMINI_CONFIG, "google");
    expect(typeof getModel).toBe("function");
    const model = getModel("gemini-2.0-flash");
    expect(model).toBeDefined();
  });

  test("模型级协议覆盖时按模型选择工厂", async () => {
    const { createProvider } = await loadProviderModule();
    const config = await buildProviderConfigWithOverrides(
      {
        model: "claude-model",
        providerId: "mixed",
        requestMethod: "chat",
      },
      {
        baseURL: "https://api.mixed.com/v1",
        modelRequestMethods: {
          "claude-model": "claude",
        },
      },
    );

    const getModel = createProvider(config, "mixed", "claude-model");
    expect(typeof getModel).toBe("function");
    expect(getModel("claude-model")).toBeDefined();
  });

  test("使用默认 Provider(不传 providerId)", async () => {
    const { createProvider } = await loadProviderModule();
    const getModel = createProvider(CHAT_CONFIG);
    expect(typeof getModel).toBe("function");
  });

  test("不存在的 Provider 抛错", async () => {
    const { createProvider } = await loadProviderModule();
    expect(() => createProvider(CHAT_CONFIG, "nonexistent")).toThrow("未配置 Provider");
  });

  test("chat 模式无 apiKey 和 baseURL 抛错", async () => {
    const { createProvider } = await loadProviderModule();
    const badConfig = await buildInvalidProviderConfig({
      model: "x",
      providerId: "bad",
      requestMethod: "chat",
      unset: ["apiKey", "baseURL"],
    });
    expect(() => createProvider(badConfig, "bad")).toThrow("需要配置 baseURL 或 apiKey");
  });

  test("claude 模式无 apiKey 抛错", async () => {
    const { createProvider } = await loadProviderModule();
    const badConfig = await buildInvalidProviderConfig({
      model: "x",
      providerId: "bad",
      requestMethod: "claude",
      unset: ["apiKey"],
    });
    expect(() => createProvider(badConfig, "bad")).toThrow("需要配置 apiKey");
  });

  test("gemini 模式无 apiKey 抛错", async () => {
    const { createProvider } = await loadProviderModule();
    const badConfig = await buildInvalidProviderConfig({
      model: "x",
      providerId: "bad",
      requestMethod: "gemini",
      unset: ["apiKey"],
    });
    expect(() => createProvider(badConfig, "bad")).toThrow("需要配置 apiKey");
  });
});

describe.skipIf(!hasRealProvider)("Provider 工厂 — 缓存", () => {
  beforeEach(async () => {
    const { clearProviderCache } = await loadProviderModule();
    clearProviderCache();
  });

  test("相同配置返回同一工厂实例", async () => {
    const { createProvider } = await loadProviderModule();
    const factory1 = createProvider(CHAT_CONFIG, "test");
    const factory2 = createProvider(CHAT_CONFIG, "test");
    expect(factory1).toBe(factory2);
  });

  test("clearProviderCache 后创建新实例", async () => {
    const { createProvider, clearProviderCache } = await loadProviderModule();
    const factory1 = createProvider(CHAT_CONFIG, "test");
    clearProviderCache();
    const factory2 = createProvider(CHAT_CONFIG, "test");
    expect(factory1).not.toBe(factory2);
  });

  test("不同 Provider 返回不同工厂", async () => {
    const { createProvider } = await loadProviderModule();
    const multiConfig = await buildDerivedProviderConfig({
      model: "m1",
      providerId: "a",
      requestMethod: "chat",
    });
    multiConfig.providerConfig.a = {
      ...multiConfig.providerConfig.a!,
      baseURL: "https://a.com/v1",
      defaultModel: "m1",
      modelList: ["m1"],
    };
    multiConfig.providerConfig.b = {
      ...multiConfig.providerConfig.a!,
      apiKey: `${multiConfig.providerConfig.a!.apiKey}-b`,
      baseURL: "https://b.com/v1",
      defaultModel: "m2",
      modelList: ["m2"],
    };
    const factoryA = createProvider(multiConfig, "a");
    const factoryB = createProvider(multiConfig, "b");
    expect(factoryA).not.toBe(factoryB);
  });
});
