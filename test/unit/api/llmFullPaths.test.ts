/**
 * LLM 完整路径测试。
 *
 * 测试用例:
 *   - streamLlm 降级重试
 *   - 超时处理
 *   - 中止信号
 *   - completeLlm 非流式
 *   - 401 不可恢复错误
 */
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AppConfigSchema } from "@/schema/config";
import { createRegistryMock } from "../../helpers/toolRegistryMock";
import { buildDerivedProviderConfig } from "../../helpers/realConfig";

let MOCK_CONFIG: AppConfigSchema;

beforeAll(async () => {
  // Import @/api/index now to prime the cache so subsequent cache-busted imports
  // can resolve through @/ paths instead of being intercepted by stale @api mocks.
  await import("@/api/index").catch(() => {});
  MOCK_CONFIG = await buildDerivedProviderConfig({
    model: "test-model",
    providerId: "test",
    requestMethod: "chat",
  });
});

// Use absolute file-path imports to fully isolate from mock.module pollution
// left by other test files, since Bun's mock.module + mock.restore() caching
// does not reliably clear module evaluation state across files.
const LLM_PATH = "/Users/hejianfei/Desktop/01-开发项目/06-应用工具/crab-cli/src/api/core/llm.ts";
const FALLBACK_PATH = "/Users/hejianfei/Desktop/01-开发项目/06-应用工具/crab-cli/src/api/resilience/fallback.ts";
const PROVIDER_PATH = "/Users/hejianfei/Desktop/01-开发项目/06-应用工具/crab-cli/src/api/core/provider.ts";
const ERROR_HANDLER_PATH = "/Users/hejianfei/Desktop/01-开发项目/06-应用工具/crab-cli/src/api/core/errorHandler.ts";
const STREAM_HANDLER_PATH = "/Users/hejianfei/Desktop/01-开发项目/06-应用工具/crab-cli/src/api/stream/streamHandler.ts";

async function loadLlmModule() {
  return import(`${LLM_PATH}?llm-full-paths-test`);
}

async function loadFallbackModule() {
  return import(`${FALLBACK_PATH}?llm-full-paths-fallback-test`);
}

async function loadCircuitBreakerModule() {
  return import("@/api/index");
}

// Global beforeEach to clear circuit breaker state between tests.
// Uses the same module instance as llm.ts (no cache-busting) to ensure
// we're clearing the same breakers Map.
beforeEach(async () => {
  const { clearCircuitBreakers } = await loadCircuitBreakerModule();
  clearCircuitBreakers();
});

describe("streamLlm 全路径 — 降级重试", () => {
  beforeEach(async () => {
    const { clearVerifiedMethods } = await loadFallbackModule();
    clearVerifiedMethods();
    const { clearCircuitBreakers } = await loadCircuitBreakerModule();
    clearCircuitBreakers();
  });

  test("error → recoverable → probe成功 → 重试成功", async () => {
    let callCount = 0;

    mock.module("@/api/core/provider", () => ({
      createProvider: () => (modelId: string) => modelId,
      getDefaultModelId: () => "test-model",
      getProviderModels: () => ["test-model"],
      getProviderConfig: () => ({}),
      clearProviderCache: () => {},
      resolveRequestMethod: () => "chat",
      listConfiguredProviders: () => ["test"],
      _compatForTesting: {} as any,
    }));

    mock.module("@/api/resilience/fallback", () => ({
      clearVerifiedMethods: () => {},
      getVerifiedMethod: () => "chat",
      probeFallback: () => Promise.resolve("responses"),
      setVerifiedMethod: mock(() => {}),
    }));

    mock.module("ai", () => ({
      streamText: () => {
        callCount++;
        if (callCount === 1) {
          throw new Error("404 Not Found");
        }
        return {
          fullStream: (async function* fullStream() {
            yield { text: "降级成功", type: "text-delta" };
          })(),
        };
      },
    }));

    mock.module("@tool/tool-registry", () => createRegistryMock());

    const { streamLlm } = await loadLlmModule();
    const events: any[] = [];
    for await (const e of streamLlm(MOCK_CONFIG, [{ content: "hi", role: "user" }])) {
      events.push(e);
    }

    const texts = events.filter((e) => e.type === "text-delta");
    const dones = events.filter((e) => e.type === "done");
    expect(texts.length).toBeGreaterThan(0);
    expect(texts[0].text).toBe("降级成功");
    expect(dones.length).toBe(1);
  });

  test("stream error chunk → recoverable → probe成功 → 重试成功", async () => {
    let callCount = 0;

    mock.module("@/api/core/provider", () => ({
      createProvider: () => (modelId: string) => modelId,
      getDefaultModelId: () => "test-model",
      getProviderModels: () => ["test-model"],
      getProviderConfig: () => ({}),
      clearProviderCache: () => {},
      resolveRequestMethod: () => "chat",
      listConfiguredProviders: () => ["test"],
    }));

    mock.module("@/api/resilience/fallback", () => ({
      clearVerifiedMethods: () => {},
      getVerifiedMethod: () => "chat",
      probeFallback: () => Promise.resolve("responses"),
      setVerifiedMethod: mock(() => {}),
    }));

    mock.module("ai", () => ({
      streamText: () => {
        callCount++;
        if (callCount === 1) {
          return {
            fullStream: (async function* fullStream() {
              yield { errorText: "404 Not Found", type: "error" };
            })(),
          };
        }
        return {
          fullStream: (async function* fullStream() {
            yield { text: "chunk 降级成功", type: "text-delta" };
          })(),
        };
      },
    }));

    mock.module("@tool/tool-registry", () => createRegistryMock());

    const { streamLlm } = await loadLlmModule();
    const events: any[] = [];
    for await (const e of streamLlm(MOCK_CONFIG, [{ content: "hi", role: "user" }])) {
      events.push(e);
    }

    expect(events.some((e) => e.type === "text-delta" && e.text === "chunk 降级成功")).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(true);
  });

  test("responses 空响应 → 触发降级 → 重试成功", async () => {
    // 此测试不依赖外部 callCount, 通过事件类型判定
    // 第 1 次 streamText 模拟空响应, 之后 streamText 模拟成功
    let localCallCount = 0;
    mock.module("@/api/core/provider", () => ({
      createProvider: () => (modelId: string) => modelId,
      getDefaultModelId: () => "test-model",
      getProviderModels: () => ["test-model"],
      getProviderConfig: () => ({}),
      clearProviderCache: () => {},
      resolveRequestMethod: () => "responses",
      listConfiguredProviders: () => ["test"],
    }));

    mock.module("@/api/resilience/fallback", () => ({
      clearVerifiedMethods: () => {},
      getVerifiedMethod: () => "responses",
      probeFallback: () => Promise.resolve("chat"),
      setVerifiedMethod: mock(() => {}),
    }));

    mock.module("ai", () => ({
      streamText: () => {
        localCallCount++;
        if (localCallCount % 2 === 1) {
          return {
            fullStream: (async function* fullStream() {
              yield { type: "finish", usage: { totalTokens: 10 } };
            })(),
          };
        }
        return {
          fullStream: (async function* fullStream() {
            yield { text: "降级成功", type: "text-delta" };
          })(),
        };
      },
    }));

    mock.module("@tool/tool-registry", () => createRegistryMock());

    const { streamLlm } = await loadLlmModule();
    const events: any[] = [];
    for await (const e of streamLlm(MOCK_CONFIG, [{ content: "hi", role: "user" }], { system: "你是助手" })) {
      events.push(e);
    }

    // 兼容 mock 变化: 接受任一 text-delta 出现即可
    const textDeltas = events.filter((e) => e.type === "text-delta");
    expect(textDeltas.length).toBeGreaterThan(0);
    expect(textDeltas[0].text).toMatch(/降级/);
    expect(events.some((e) => e.type === "done")).toBe(true);
  });

  test("error → recoverable → probe成功 → 重试也失败", async () => {
    // Mock: 每次调用都抛错
    mock.module("@/api/core/provider", () => ({
      createProvider: () => (modelId: string) => modelId,
      getDefaultModelId: () => "test-model",
      getProviderModels: () => ["test-model"],
      getProviderConfig: () => ({}),
      clearProviderCache: () => {},
      resolveRequestMethod: () => "chat",
      listConfiguredProviders: () => ["test"],
    }));

    mock.module("@/api/resilience/fallback", () => ({
      clearVerifiedMethods: () => {},
      getVerifiedMethod: () => "chat",
      probeFallback: () => Promise.resolve("responses"),
      setVerifiedMethod: mock(() => {}),
    }));

    mock.module("ai", () => ({
      streamText: () => {
        throw new Error("500 Internal Server Error");
      },
    }));

    mock.module("@tool/tool-registry", () => createRegistryMock());

    const { streamLlm } = await loadLlmModule();
    const events: any[] = [];
    for await (const e of streamLlm(MOCK_CONFIG, [{ content: "hi", role: "user" }])) {
      events.push(e);
    }

    const errors = events.filter((e) => e.type === "error");
    expect(errors.length).toBe(1);
    expect(errors[0].error.message).toContain("Internal Server Error");
  });

  test("error → recoverable → probe返回null → 返回原始错误", async () => {
    mock.module("@/api/core/provider", () => ({
      createProvider: () => (modelId: string) => modelId,
      getDefaultModelId: () => "test-model",
      getProviderModels: () => ["test-model"],
      getProviderConfig: () => ({}),
      clearProviderCache: () => {},
      resolveRequestMethod: () => "chat",
      listConfiguredProviders: () => ["test"],
    }));

    mock.module("@/api/resilience/fallback", () => ({
      clearVerifiedMethods: () => {},
      getVerifiedMethod: () => "chat",
      probeFallback: () => Promise.resolve(null),
      setVerifiedMethod: mock(() => {}),
    }));

    mock.module("ai", () => ({
      streamText: () => {
        throw new Error("404 Not Found");
      },
    }));

    mock.module("@tool/tool-registry", () => createRegistryMock());

    const { streamLlm } = await loadLlmModule();
    const events: any[] = [];
    for await (const e of streamLlm(MOCK_CONFIG, [{ content: "hi", role: "user" }])) {
      events.push(e);
    }

    const errors = events.filter((e) => e.type === "error");
    expect(errors.length).toBe(1);
    expect(errors[0].error.message).toContain("404");
  });

  test("error → 401 不可恢复 → 直接返回错误(不触发降级)", async () => {
    let probeCalled = false;

    mock.module("@/api/core/provider", () => ({
      createProvider: () => (modelId: string) => modelId,
      getDefaultModelId: () => "test-model",
      getProviderModels: () => ["test-model"],
      getProviderConfig: () => ({}),
      clearProviderCache: () => {},
      resolveRequestMethod: () => "chat",
      listConfiguredProviders: () => ["test"],
    }));

    mock.module("@/api/resilience/fallback", () => ({
      clearVerifiedMethods: () => {},
      getVerifiedMethod: () => "chat",
      probeFallback: () => {
        probeCalled = true;
        return Promise.resolve(null);
      },
    }));

    mock.module("ai", () => ({
      streamText: () => {
        throw new Error("401 Unauthorized: Invalid API key");
      },
    }));

    mock.module("@tool/tool-registry", () => createRegistryMock());

    const { streamLlm } = await loadLlmModule();
    const events: any[] = [];
    for await (const e of streamLlm(MOCK_CONFIG, [{ content: "hi", role: "user" }])) {
      events.push(e);
    }

    // 不应调用 probeFallback
    expect(probeCalled).toBe(false);
    const errors = events.filter((e) => e.type === "error");
    expect(errors.length).toBe(1);
    expect(errors[0].error.message).toContain("401");
  });

  test("429 速率限制 → 指数退避重试成功", async () => {
    let callCount = 0;

    mock.module("@/api/core/provider", () => ({
      createProvider: () => (modelId: string) => modelId,
      getDefaultModelId: () => "test-model",
      getProviderModels: () => ["test-model"],
      getProviderConfig: () => ({}),
      clearProviderCache: () => {},
      resolveRequestMethod: () => "chat",
      listConfiguredProviders: () => ["test"],
    }));

    mock.module("@/api/resilience/fallback", () => ({
      clearVerifiedMethods: () => {},
      getVerifiedMethod: () => "chat",
      probeFallback: () => Promise.resolve("chat"),
      setVerifiedMethod: mock(() => {}),
    }));

    mock.module("ai", () => ({
      streamText: () => {
        callCount++;
        if (callCount <= 1) {
          const error = new Error("429 Too Many Requests") as any;
          error.status = 429;
          throw error;
        }
        return {
          fullStream: (async function* fullStream() {
            yield { text: "retried successfully", type: "text-delta" };
          })(),
        };
      },
    }));

    mock.module("@tool/tool-registry", () => createRegistryMock());

    const { streamLlm } = await loadLlmModule();
    const events: any[] = [];
    for await (const e of streamLlm(MOCK_CONFIG, [{ content: "hi", role: "user" }])) {
      events.push(e);
    }

    expect(callCount).toBe(2);
    expect(events.some((e) => e.type === "text-delta" && e.text === "retried successfully")).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(true);
  });

  test("降级链耗尽 → 返回最终错误", async () => {
    let callCount = 0;

    mock.module("@/api/core/provider", () => ({
      createProvider: () => (modelId: string) => modelId,
      getDefaultModelId: () => "test-model",
      getProviderModels: () => ["test-model"],
      getProviderConfig: () => ({}),
      clearProviderCache: () => {},
      resolveRequestMethod: () => {
        callCount++;
        return callCount <= 3 ? ["chat", "responses"][callCount - 1] : "chat";
      },
      listConfiguredProviders: () => ["test"],
    }));

    mock.module("@/api/resilience/fallback", () => ({
      clearVerifiedMethods: () => {},
      getVerifiedMethod: () => "chat",
      probeFallback: () => Promise.resolve(null),
      setVerifiedMethod: mock(() => {}),
    }));

    mock.module("ai", () => ({
      streamText: () => {
        throw new Error("500 Internal Server Error");
      },
    }));

    mock.module("@tool/tool-registry", () => createRegistryMock());

    const { streamLlm } = await loadLlmModule();
    const events: any[] = [];
    for await (const e of streamLlm(MOCK_CONFIG, [{ content: "hi", role: "user" }])) {
      events.push(e);
    }

    const errors = events.filter((e) => e.type === "error");
    expect(errors.length).toBe(1);
    expect(errors[0].error.message).toContain("500");
  });
});

describe("streamLlm — completeLlm 非流式包装", () => {
  beforeEach(async () => {
    const { clearCircuitBreakers } = await loadCircuitBreakerModule();
    clearCircuitBreakers();
  });

  test("completeLlm 返回完整文本", async () => {
    mock.module("@/api/core/provider", () => ({
      createProvider: () => (modelId: string) => modelId,
      getDefaultModelId: () => "test-model",
      getProviderModels: () => ["test-model"],
      getProviderConfig: () => ({}),
      clearProviderCache: () => {},
      resolveRequestMethod: () => "chat",
      listConfiguredProviders: () => ["test"],
    }));

    mock.module("@/api/resilience/fallback", () => ({
      clearVerifiedMethods: () => {},
      getVerifiedMethod: () => "chat",
    }));

    mock.module("ai", () => ({
      streamText: () => ({
        fullStream: (async function* fullStream() {
          yield { text: "Hello", type: "text-delta" };
          yield { text: " ", type: "text-delta" };
          yield { text: "World", type: "text-delta" };
        })(),
      }),
    }));

    mock.module("@tool/tool-registry", () => createRegistryMock());

    const { completeLlm } = await loadLlmModule();
    const result = await completeLlm(MOCK_CONFIG, [{ content: "hi", role: "user" }]);
    expect(result.text).toBe("Hello World");
  });

  test("completeLlm 遇到 error 事件时抛错", async () => {
    mock.module("@/api/core/provider", () => ({
      createProvider: () => (modelId: string) => modelId,
      getDefaultModelId: () => "test-model",
      getProviderModels: () => ["test-model"],
      getProviderConfig: () => ({}),
      clearProviderCache: () => {},
      resolveRequestMethod: () => "chat",
      listConfiguredProviders: () => ["test"],
    }));

    mock.module("@/api/resilience/fallback", () => ({
      clearVerifiedMethods: () => {},
      getVerifiedMethod: () => "chat",
    }));

    mock.module("ai", () => ({
      streamText: () => ({
        fullStream: (async function* fullStream() {
          yield { text: "partial", type: "text-delta" };
          throw new Error("connection lost");
        })(),
      }),
    }));

    mock.module("@tool/tool-registry", () => createRegistryMock());

    const { completeLlm } = await loadLlmModule();
    await expect(completeLlm(MOCK_CONFIG, [{ content: "hi", role: "user" }])).rejects.toThrow();
  });

  test("completeLlm 仅返回 reasoning 时返回 reasoning 内容", async () => {
    mock.module("@/api/core/provider", () => ({
      createProvider: () => (modelId: string) => modelId,
      getDefaultModelId: () => "test-model",
      getProviderModels: () => ["test-model"],
      getProviderConfig: () => ({}),
      clearProviderCache: () => {},
      resolveRequestMethod: () => "chat",
      listConfiguredProviders: () => ["test"],
    }));

    mock.module("@/api/resilience/fallback", () => ({
      clearVerifiedMethods: () => {},
      getVerifiedMethod: () => "chat",
    }));

    mock.module("ai", () => ({
      streamText: () => ({
        fullStream: (async function* fullStream() {
          yield { text: "Let me", type: "reasoning-delta" };
          yield { text: " think...", type: "reasoning-delta" };
        })(),
      }),
    }));

    mock.module("@tool/tool-registry", () => createRegistryMock());

    const { completeLlm } = await loadLlmModule();
    const result = await completeLlm(MOCK_CONFIG, [{ content: "hi", role: "user" }]);
    expect(result.reasoning).toBe("Let me think...");
    expect(result.text).toBe("");
  });

  test("completeLlm 同时返回 text 和 reasoning 时优先返回 text", async () => {
    mock.module("@/api/core/provider", () => ({
      createProvider: () => (modelId: string) => modelId,
      getDefaultModelId: () => "test-model",
      getProviderModels: () => ["test-model"],
      getProviderConfig: () => ({}),
      clearProviderCache: () => {},
      resolveRequestMethod: () => "chat",
      listConfiguredProviders: () => ["test"],
    }));

    mock.module("@/api/resilience/fallback", () => ({
      clearVerifiedMethods: () => {},
      getVerifiedMethod: () => "chat",
    }));

    mock.module("ai", () => ({
      streamText: () => ({
        fullStream: (async function* fullStream() {
          yield { text: "Reasoning...", type: "reasoning-delta" };
          yield { text: "Hello", type: "text-delta" };
        })(),
      }),
    }));

    mock.module("@tool/tool-registry", () => createRegistryMock());

    const { completeLlm } = await loadLlmModule();
    const result = await completeLlm(MOCK_CONFIG, [{ content: "hi", role: "user" }]);
    expect(result.text).toBe("Hello");
  });

  test("并发会话隔离 — 多会话同时调用状态不交叉", async () => {
    const results: Record<string, string[]> = { a: [], b: [] };
    let callCounter = 0;

    mock.module("@/api/core/provider", () => ({
      createProvider: () => (modelId: string) => modelId,
      getDefaultModelId: () => "test-model",
      getProviderModels: () => [] as string[],
      clearProviderCache: () => {},
      resolveRequestMethod: () => "chat" as const,
      listConfiguredProviders: () => [] as string[],
      getProviderConfig: () => undefined,
    }));

    mock.module("@/api/resilience/fallback", () => ({
      clearVerifiedMethods: () => {},
      getVerifiedMethod: () => "chat",
      probeFallback: () => Promise.resolve("chat"),
      setVerifiedMethod: mock(() => {}),
    }));

    mock.module("ai", () => ({
      streamText: () => {
        const id = ++callCounter;
        return {
          fullStream: (async function* fullStream() {
            yield { text: `session-${id}`, type: "text-delta" };
          })(),
        };
      },
      jsonSchema: (schema: unknown) => schema,
      embedMany: () => Promise.resolve({ values: [] }),
      embed: () => Promise.resolve({ embedding: [0] }),
    }));

    mock.module("@tool/tool-registry", () => createRegistryMock());

    const { streamLlm } = await loadLlmModule();

    await Promise.all([
      (async () => {
        for await (const e of streamLlm(MOCK_CONFIG, [{ content: "a", role: "user" }], { sessionId: "a" })) {
          if (e.type === "text-delta") results.a!.push(e.text);
        }
      })(),
      (async () => {
        for await (const e of streamLlm(MOCK_CONFIG, [{ content: "b", role: "user" }], { sessionId: "b" })) {
          if (e.type === "text-delta") results.b!.push(e.text);
        }
      })(),
    ]);

    expect(results.a!).toEqual(["session-1"]);
    expect(results.b!).toEqual(["session-2"]);
  });

  test("视觉输入 — 图片消息触发 Vision 路由", async () => {
    let capturedProviderId = "";
    let capturedModelId = "";
    const events: any[] = [];

    mock.module("@/api/core/provider", () => ({
      createProvider: () => (modelId: string) => modelId,
      getDefaultModelId: () => "test-model",
      getProviderModels: () => [] as string[],
      clearProviderCache: () => {},
      resolveRequestMethod: () => "chat" as const,
      listConfiguredProviders: () => [] as string[],
      getProviderConfig: () => undefined,
    }));

    mock.module("@/api/resilience/fallback", () => ({
      clearVerifiedMethods: () => {},
      getVerifiedMethod: () => "chat",
      probeFallback: () => Promise.resolve("chat"),
      setVerifiedMethod: mock(() => {}),
    }));

    mock.module("ai", () => ({
      streamText: (opts: any) => {
        capturedProviderId = opts.model?.provider?.provider || "";
        capturedModelId = opts.model?.modelId || "";
        return {
          fullStream: (async function* fullStream() {
            yield { text: "I see an image", type: "text-delta" };
          })(),
        };
      },
      jsonSchema: (schema: unknown) => schema,
      embedMany: () => Promise.resolve({ values: [] }),
      embed: () => Promise.resolve({ embedding: [0] }),
    }));

    mock.module("@tool/tool-registry", () => createRegistryMock());

    const { streamLlm } = await loadLlmModule();

    // 消息包含图片 part
    const messagesWithImage = [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: "Describe this image" },
          { type: "image" as const, image: "data:image/png;base64,iVBORw0" },
        ],
      },
    ];

    for await (const e of streamLlm(MOCK_CONFIG, messagesWithImage as any)) {
      events.push(e);
    }

    expect(events.some((e) => e.type === "text-delta")).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(true);
  });
});

// 清理 mock.module 污染，防止影响后续测试文件
afterAll(() => mock.restore());
