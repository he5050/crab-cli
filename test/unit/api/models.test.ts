/**
 * 模型列表测试 — listAllModels, listModelsByProvider, searchModels, getDefaultModel。
 *
 * 测试用例:
 *   - listAllModels 聚合所有 provider 的 modelList
 *   - listAllModels 标记默认模型
 *   - listModelsByProvider 过滤
 *   - listModelsByProvider 无匹配返回空数组
 *   - getDefaultModel 返回默认模型
 *   - searchModels 模糊匹配
 *   - searchModels 无匹配返回空数组
 *   - searchModels 大小写不敏感
 *   - searchModels 空查询返回所有
 */
import { describe, expect, test } from "bun:test";
import { getDefaultModel, listAllModels, listModelsByProvider, searchModels } from "@/api";
import type { AppConfigSchema } from "@/schema/config";

function makeConfig(overrides?: Partial<AppConfigSchema>): any {
  return {
    defaultProvider: { model: "model-1", provider: "provider-a" },
    providerConfig: {
      "provider-a": {
        apiKey: "key-a",
        baseUrl: "https://a.com",
        modelList: ["model-1", "model-2"],
      },
      "provider-b": {
        apiKey: "key-b",
        baseUrl: "https://b.com",
        modelList: ["model-3"],
      },
    },
    ...overrides,
  };
}

describe("listAllModels", () => {
  test("聚合所有 provider 的 modelList", () => {
    const config = makeConfig();
    const models = listAllModels(config as any);
    const ids = models.map((m) => m.id);
    expect(ids).toContain("model-1");
    expect(ids).toContain("model-2");
    expect(ids).toContain("model-3");
    expect(models.length).toBe(3);
  });

  test("正确标记默认模型", () => {
    const config = makeConfig();
    const models = listAllModels(config as any);
    const defaultModel = models.find((m) => m.id === "model-1");
    expect(defaultModel?.isDefault).toBe(true);
    const nonDefault = models.find((m) => m.id === "model-2");
    expect(nonDefault?.isDefault).toBe(false);
  });
});

describe("listModelsByProvider", () => {
  test("按 provider 过滤", () => {
    const config = makeConfig();
    const models = listModelsByProvider(config as any, "provider-a");
    expect(models.length).toBe(2);
    expect(models.every((m) => m.providerId === "provider-a")).toBe(true);
  });

  test("无匹配返回空数组", () => {
    const config = makeConfig();
    const models = listModelsByProvider(config as any, "non-existent");
    expect(models).toEqual([]);
  });
});

describe("getDefaultModel", () => {
  test("返回默认模型信息", () => {
    const config = makeConfig();
    const model = getDefaultModel(config as any);
    expect(model.id).toBe("model-1");
    expect(model.providerId).toBe("provider-a");
    expect(model.isDefault).toBe(true);
  });
});

describe("searchModels", () => {
  test("模糊匹配模型 ID", () => {
    const config = makeConfig();
    const results = searchModels(config as any, "model-1");
    expect(results.length).toBe(1);
    expect(results[0]!.id).toBe("model-1");
  });

  test("无匹配返回空数组", () => {
    const config = makeConfig();
    const results = searchModels(config as any, "non-existent");
    expect(results).toEqual([]);
  });

  test("大小写不敏感", () => {
    const config = makeConfig();
    const results = searchModels(config as any, "MODEL-1");
    expect(results.length).toBe(1);
  });

  test("空查询返回所有", () => {
    const config = makeConfig();
    const results = searchModels(config as any, "");
    expect(results.length).toBe(3);
  });
});
