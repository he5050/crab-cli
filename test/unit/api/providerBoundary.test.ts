/**
 * Provider 系统边界测试。
 *
 * 覆盖导出:
 *   - resolveRequestMethod — requestMethod 解析
 *   - clearProviderCache — 缓存清除
 *   - getDefaultModelId — 默认模型
 *   - listConfiguredProviders — 已配置 Provider 列表
 *   - getProviderModels — Provider 模型列表
 *   - getProviderConfig — 获取 Provider 配置
 *   - createProvider — 创建 Provider(异常路径)
 *   - _compatForTesting — 兼容性测试工具
 *
 * 注意: checkProviderHealth / checkAllProvidersHealth 已迁移到
 *       @/api/resilience/providerHealth，不再从 provider.ts 导出。
 */
import { describe, expect, test } from "bun:test";
import type { AppConfigSchema } from "@/schema/config";

// 使用动态 import + cache busting 避免其他文件的 mock.module("ai") 污染
async function loadProviderModule() {
  // @ts-expect-error test-only cache busting for isolated module evaluation
  return import("@/api/core/provider.ts?provider-boundary-test-v2");
}

// ─── 测试用配置 ────────────────────────────────────────────

function makeTestConfig(overrides?: Record<string, any>): AppConfigSchema {
  return {
    defaultProvider: { model: "gpt-4o", provider: "test-provider" },
    providerConfig: {
      "test-provider": {
        apiKey: "sk-test-1234567890",
        baseURL: "https://api.test.example.com",
        defaultModel: "gpt-4o",
        modelList: ["gpt-4o", "gpt-4o-mini"],
        requestMethod: "chat",
      },
    },
    ...overrides,
  } as any as AppConfigSchema;
}

// ─── resolveRequestMethod ──────────────────────────────────

describe("resolveRequestMethod", () => {
  test("有配置时返回配置的 requestMethod", async () => {
    const { resolveRequestMethod } = await loadProviderModule();
    const config = makeTestConfig();
    expect(resolveRequestMethod(config, "test-provider")).toBe("chat");
  });

  test("无配置时返回 chat 默认值", async () => {
    const { resolveRequestMethod } = await loadProviderModule();
    const config = makeTestConfig();
    expect(resolveRequestMethod(config, "nonexistent")).toBe("chat");
  });

  test("modelRequestMethods 优先于 requestMethod", async () => {
    const { resolveRequestMethod } = await loadProviderModule();
    const config = makeTestConfig({
      providerConfig: {
        "test-provider": {
          apiKey: "sk-test",
          modelRequestMethods: { "claude-3": "claude" },
          requestMethod: "chat",
        },
      },
    });
    expect(resolveRequestMethod(config, "test-provider", "claude-3")).toBe("claude");
  });

  test("无 modelRequestMethods 时用 requestMethod", async () => {
    const { resolveRequestMethod } = await loadProviderModule();
    const config = makeTestConfig({
      providerConfig: {
        "test-provider": {
          apiKey: "sk-test",
          requestMethod: "responses",
        },
      },
    });
    expect(resolveRequestMethod(config, "test-provider", "gpt-4o")).toBe("responses");
  });
});

// ─── clearProviderCache ────────────────────────────────────

describe("clearProviderCache", () => {
  test("不抛异常", async () => {
    const { clearProviderCache } = await loadProviderModule();
    expect(() => clearProviderCache()).not.toThrow();
  });
});

// ─── getDefaultModelId ─────────────────────────────────────

describe("getDefaultModelId", () => {
  test("返回默认 Provider 的默认模型", async () => {
    const { getDefaultModelId } = await loadProviderModule();
    const config = makeTestConfig();
    expect(getDefaultModelId(config)).toBe("gpt-4o");
  });

  test("指定其他 Provider 时用其 defaultModel", async () => {
    const { getDefaultModelId } = await loadProviderModule();
    const config = makeTestConfig({
      providerConfig: {
        "other-provider": { apiKey: "sk-test", defaultModel: "claude-3" },
        "test-provider": { apiKey: "sk-test", model: "gpt-4o" },
      },
    });
    expect(getDefaultModelId(config, "other-provider")).toBe("claude-3");
  });

  test("指定 Provider 无 defaultModel 时回退到 gpt-4o", async () => {
    const { getDefaultModelId } = await loadProviderModule();
    const config = makeTestConfig({
      providerConfig: {
        "bare-provider": { apiKey: "sk-test" },
        "test-provider": { apiKey: "sk-test", model: "gpt-4o" },
      },
    });
    expect(getDefaultModelId(config, "bare-provider")).toBe("");
  });
});

// ─── listConfiguredProviders ───────────────────────────────

describe("listConfiguredProviders", () => {
  test("返回配置的 Provider ID 列表", async () => {
    const { listConfiguredProviders } = await loadProviderModule();
    const config = makeTestConfig();
    const providers = listConfiguredProviders(config);
    expect(providers).toContain("test-provider");
  });

  test("多个 Provider 全部列出", async () => {
    const { listConfiguredProviders } = await loadProviderModule();
    const config = makeTestConfig({
      providerConfig: {
        p1: { apiKey: "sk-test" },
        p2: { apiKey: "sk-test" },
      },
    });
    const providers = listConfiguredProviders(config);
    expect(providers).toContain("p1");
    expect(providers).toContain("p2");
  });
});

// ─── getProviderModels ─────────────────────────────────────

describe("getProviderModels", () => {
  test("返回模型列表", async () => {
    const { getProviderModels } = await loadProviderModule();
    const config = makeTestConfig();
    const models = getProviderModels(config, "test-provider");
    expect(models).toEqual(["gpt-4o", "gpt-4o-mini"]);
  });

  test("未配置的 Provider 返回空数组", async () => {
    const { getProviderModels } = await loadProviderModule();
    const config = makeTestConfig();
    const models = getProviderModels(config, "nonexistent");
    expect(models).toEqual([]);
  });
});

// ─── getProviderConfig ─────────────────────────────────────

describe("getProviderConfig", () => {
  test("返回存在的 Provider 配置", async () => {
    const { getProviderConfig } = await loadProviderModule();
    const config = makeTestConfig();
    const pConfig = getProviderConfig(config, "test-provider");
    expect(pConfig).toBeDefined();
    expect(pConfig!.apiKey).toBe("sk-test-1234567890");
  });

  test("不存在的 Provider 返回 undefined", async () => {
    const { getProviderConfig } = await loadProviderModule();
    const config = makeTestConfig();
    expect(getProviderConfig(config, "nonexistent")).toBeUndefined();
  });
});

// ─── checkProviderHealth ───────────────────────────────────

describe("checkProviderHealth", () => {
  test("未配置的 Provider 返回 unknown 状态", async () => {
    const { checkProviderHealth } = await import("@/api/resilience/providerHealth");
    const config = makeTestConfig();
    const health = await checkProviderHealth(config, "nonexistent");
    expect(health.providerId).toBe("nonexistent");
    expect(health.status).toBe("unknown");
    expect(health.error).toContain("未配置");
  });

  test("配置了 Provider 但网络不可达返回 unhealthy", async () => {
    const { checkProviderHealth } = await import("@/api/resilience/providerHealth");
    const config = makeTestConfig({
      providerConfig: {
        "offline-provider": {
          apiKey: "sk-test",
          baseURL: "http://127.0.0.1:1", // 不可达端口
        },
      },
    });
    const health = await checkProviderHealth(config, "offline-provider");
    expect(health.providerId).toBe("offline-provider");
    expect(health.status).toBe("unhealthy");
  });

  test("返回结果包含必要字段", async () => {
    const { checkProviderHealth } = await import("@/api/resilience/providerHealth");
    const config = makeTestConfig();
    const health = await checkProviderHealth(config, "nonexistent");
    expect(health).toHaveProperty("providerId");
    expect(health).toHaveProperty("status");
    expect(health).toHaveProperty("latencyMs");
    expect(health).toHaveProperty("checkedAt");
    expect(typeof health.latencyMs).toBe("number");
    expect(typeof health.checkedAt).toBe("number");
  });
});

// ─── checkAllProvidersHealth ───────────────────────────────

describe("checkAllProvidersHealth", () => {
  test("返回数组", async () => {
    const { checkAllProvidersHealth } = await import("@/api/resilience/providerHealth");
    const config = makeTestConfig({
      providerConfig: {
        "test-provider": {
          apiKey: "sk-test",
          baseURL: "http://127.0.0.1:1",
        },
      },
    });
    const results = await checkAllProvidersHealth(config);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
  });

  test("每个结果都有 providerId 和 status", async () => {
    const { checkAllProvidersHealth } = await import("@/api/resilience/providerHealth");
    const config = makeTestConfig({
      providerConfig: {
        "test-provider": {
          apiKey: "sk-test",
          baseURL: "http://127.0.0.1:1",
        },
      },
    });
    const results = await checkAllProvidersHealth(config);
    for (const h of results) {
      expect(h).toHaveProperty("providerId");
      expect(h).toHaveProperty("status");
    }
  });
});

// ─── createProvider 异常路径 ───────────────────────────────

describe("createProvider", () => {
  test("未配置的 Provider 抛出错误", async () => {
    const { createProvider } = await loadProviderModule();
    const config = makeTestConfig();
    expect(() => createProvider(config, "nonexistent")).toThrow();
  });
});

// ─── _compatForTesting ────────────────────────────────────

describe("_compatForTesting", () => {
  test("包含 normalizeOpenAICompatibleChatChunk", async () => {
    const { _compatForTesting } = await loadProviderModule();
    expect(typeof _compatForTesting.normalizeOpenAICompatibleChatChunk).toBe("function");
  });

  test("normalizeOpenAICompatibleChatChunk 空输入返回原值", async () => {
    const { _compatForTesting } = await loadProviderModule();
    expect(_compatForTesting.normalizeOpenAICompatibleChatChunk(null)).toBeNull();
    expect(_compatForTesting.normalizeOpenAICompatibleChatChunk(undefined)).toBeUndefined();
    expect(_compatForTesting.normalizeOpenAICompatibleChatChunk("string")).toBe("string");
  });

  test("processOpenAICompatibleSseBlock 非 data 行不变", async () => {
    const { _compatForTesting } = await loadProviderModule();
    const input = "not a data line";
    expect(_compatForTesting.processOpenAICompatibleSseBlock(input)).toBe(input);
  });

  test("processOpenAICompatibleSseBlock data: [DONE] 不变", async () => {
    const { _compatForTesting } = await loadProviderModule();
    const input = "data: [DONE]";
    expect(_compatForTesting.processOpenAICompatibleSseBlock(input)).toBe(input);
  });

  test("normalizeOpenAICompatibleChatChunk 补齐 choice/tool_call index 并移除 null 字段", async () => {
    const { _compatForTesting } = await loadProviderModule();
    const normalized = _compatForTesting.normalizeOpenAICompatibleChatChunk({
      choices: [
        {
          delta: {
            content: null,
            reasoning_content: null,
            role: null,
            tool_calls: [
              {
                function: { arguments: "{}", name: "read" },
                id: "call_1",
                type: "function",
              },
            ],
          },
        },
      ],
    }) as any;

    expect(normalized.choices[0].index).toBe(0);
    expect(normalized.choices[0].delta.role).toBeUndefined();
    expect(normalized.choices[0].delta.content).toBeUndefined();
    expect(normalized.choices[0].delta.reasoning_content).toBeUndefined();
    expect(normalized.choices[0].delta.tool_calls[0].index).toBe(0);
  });

  test("processOpenAICompatibleSseBlock 只归一化合法 JSON data 行", async () => {
    const { _compatForTesting } = await loadProviderModule();
    const input = ["event: message", 'data: {"choices":[{"delta":{"content":null}}]}', "data: not-json"].join("\n");
    const output = _compatForTesting.processOpenAICompatibleSseBlock(input);

    expect(output).toContain('"index":0');
    expect(output).not.toContain('"content":null');
    expect(output).toContain("data: not-json");
  });

  test("normalizeOpenAICompatibleBaseURL 根路径自动补 /v1，非 URL 原样返回", async () => {
    const { _compatForTesting } = await loadProviderModule();

    expect(_compatForTesting.normalizeOpenAICompatibleBaseURL("https://api.example.com/")).toBe(
      "https://api.example.com/v1",
    );
    expect(_compatForTesting.normalizeOpenAICompatibleBaseURL("https://api.example.com/custom/")).toBe(
      "https://api.example.com/custom",
    );
    expect(_compatForTesting.normalizeOpenAICompatibleBaseURL("not a url")).toBe("not a url");
    expect(_compatForTesting.normalizeOpenAICompatibleBaseURL(undefined)).toBeUndefined();
  });

  test("wrapOpenAICompatibleChatFetch 归一化 chat SSE 响应且保留非目标响应", async () => {
    const { _compatForTesting } = await loadProviderModule();
    const fetchMock = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (!url.includes("/chat/completions")) {
        return new Response("plain", { headers: { "content-type": "text/plain" } });
      }
      return new Response('data: {"choices":[{"delta":{"content":null,"tool_calls":[{"id":"call_1"}]}}]}\n\n', {
        headers: { "content-type": "text/event-stream" },
      });
    }) as typeof fetch;
    const wrapped = _compatForTesting.wrapOpenAICompatibleChatFetch(fetchMock);

    const passthrough = await wrapped("https://api.example.com/v1/models");
    expect(await passthrough.text()).toBe("plain");

    const response = await wrapped("https://api.example.com/v1/chat/completions");
    const text = await response.text();
    expect(text).toContain('"index":0');
    expect(text).not.toContain('"content":null');
    expect(text).toContain('"tool_calls":[{"id":"call_1","index":0}]');
  });

  test("wrapOpenAICompatibleChatFetch 返回函数", async () => {
    const { _compatForTesting } = await loadProviderModule();
    const wrapped = _compatForTesting.wrapOpenAICompatibleChatFetch();
    expect(typeof wrapped).toBe("function");
  });
});
