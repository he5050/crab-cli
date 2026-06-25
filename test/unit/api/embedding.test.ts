/**
 * Embedding 单元测试
 */
import { describe, expect, test } from "bun:test";
import { getEmbeddingConfig, getEmbeddingConfigForProvider, createEmbeddingModel } from "@/api";
import { AppConfigSchema } from "@/schema/config";
import { AppError } from "@/core/errors/appError";
describe("getEmbeddingConfig", () => {
  test("falls back to provider apiKey and baseURL", () => {
    const config = AppConfigSchema.parse({
      providerConfig: {
        openai: {
          apiKey: "provider-key",
          baseURL: "https://api.openai.com",
          requestMethod: "chat",
        },
      },
      defaultProvider: { provider: "openai", model: "gpt-4" },
      codebase: {
        embedding: {
          type: "openai",
        },
      },
    });

    const emb = getEmbeddingConfig(config);
    expect(emb.apiKey).toBe("provider-key");
    expect(emb.baseUrl).toBe("https://api.openai.com");
  });

  test("embedding-specific apiKey overrides provider", () => {
    const config = AppConfigSchema.parse({
      providerConfig: {
        openai: {
          apiKey: "provider-key",
          baseURL: "https://api.openai.com",
          requestMethod: "chat",
        },
      },
      defaultProvider: { provider: "openai", model: "gpt-4" },
      codebase: {
        embedding: {
          apiKey: "emb-key",
          baseUrl: "https://emb.example.com",
          type: "openai",
        },
      },
    });

    const emb = getEmbeddingConfig(config);
    expect(emb.apiKey).toBe("emb-key");
    expect(emb.baseUrl).toBe("https://emb.example.com");
  });

  test("returns defaults when no provider fallback", () => {
    const config = AppConfigSchema.parse({
      providerConfig: {},
      defaultProvider: { provider: "", model: "" },
      codebase: {
        embedding: {
          type: "openai",
        },
      },
    });

    const emb = getEmbeddingConfig(config);
    expect(emb.apiKey).toBe("");
    expect(emb.baseUrl).toBe("");
    expect(emb.model).toBe("text-embedding-3-small");
  });

  test("ollama type uses ollama baseUrl", () => {
    const config = AppConfigSchema.parse({
      providerConfig: {},
      defaultProvider: { provider: "", model: "" },
      codebase: {
        embedding: { type: "ollama" },
      },
    });

    const emb = getEmbeddingConfig(config);
    expect(emb.baseUrl).toBe("http://localhost:11434");
    expect(emb.type).toBe("ollama");
  });
});

describe("getEmbeddingConfigForProvider", () => {
  test("falls back to specified provider config", () => {
    const config = AppConfigSchema.parse({
      providerConfig: {
        azure: {
          apiKey: "azure-key",
          baseURL: "https://azure.openai.com",
          requestMethod: "chat",
        },
      },
      defaultProvider: { provider: "openai", model: "gpt-4" },
      codebase: {
        embedding: { type: "openai" },
      },
    });

    const emb = getEmbeddingConfigForProvider(config, "azure");
    expect(emb.apiKey).toBe("azure-key");
    expect(emb.baseUrl).toBe("https://azure.openai.com");
  });

  test("embedding config overrides provider config", () => {
    const config = AppConfigSchema.parse({
      providerConfig: {
        azure: {
          apiKey: "azure-key",
          baseURL: "https://azure.openai.com",
          requestMethod: "chat",
        },
      },
      defaultProvider: { provider: "openai", model: "gpt-4" },
      codebase: {
        embedding: {
          apiKey: "emb-key",
          type: "openai",
        },
      },
    });

    const emb = getEmbeddingConfigForProvider(config, "azure");
    expect(emb.apiKey).toBe("emb-key");
  });

  test("uses provider baseURL when not set in embedding config", () => {
    const config = AppConfigSchema.parse({
      providerConfig: {
        custom: {
          baseURL: "https://custom.example.com",
          defaultModel: "custom-embed-model",
          requestMethod: "chat",
        },
      },
      defaultProvider: { provider: "custom", model: "gpt-4" },
      codebase: {
        embedding: {
          type: "openai",
          model: "custom-embed-model",
        },
      },
    });

    const emb = getEmbeddingConfigForProvider(config, "custom");
    expect(emb.baseUrl).toBe("https://custom.example.com");
    expect(emb.model).toBe("custom-embed-model");
  });

  test("returns empty for unknown provider", () => {
    const config = AppConfigSchema.parse({
      providerConfig: {},
      defaultProvider: { provider: "openai", model: "gpt-4" },
    });

    const emb = getEmbeddingConfigForProvider(config, "nonexistent");
    expect(emb.apiKey).toBe("");
    expect(emb.baseUrl).toBe("");
  });
});

describe("createEmbeddingModel", () => {
  test("creates ollama model with correct metadata", () => {
    const embCfg = {
      apiKey: "",
      baseUrl: "http://localhost:11434",
      dimensions: 768,
      model: "nomic-embed-text",
      type: "ollama",
    };
    const model = createEmbeddingModel(embCfg);
    expect((model as any).modelId).toBe("nomic-embed-text");
    expect((model as any).provider).toBe("ollama");
    expect((model as any).specificationVersion).toBe("v3");
    expect((model as any).maxEmbeddingsPerCall).toBe(512);
    expect((model as any).supportsParallelCalls).toBe(true);
  });

  test("creates gemini model with correct metadata", () => {
    const embCfg = {
      apiKey: "gemini-key",
      baseUrl: "https://generativelanguage.googleapis.com",
      dimensions: 768,
      model: "text-embedding-004",
      type: "gemini",
    };
    const model = createEmbeddingModel(embCfg);
    expect((model as any).modelId).toBe("text-embedding-004");
    expect((model as any).provider).toBe("gemini");
    expect((model as any).specificationVersion).toBe("v3");
  });

  test("createEmbeddingModel overrides model with overrideModel", () => {
    const embCfg = {
      apiKey: "",
      baseUrl: "http://localhost:11434",
      dimensions: 768,
      model: "default-model",
      type: "ollama",
    };
    const model = createEmbeddingModel(embCfg, "override-model");
    expect((model as any).modelId).toBe("override-model");
  });
});

// ─── 错误归一（P0-3） ─────────────────────────────────────

describe("createEmbeddingModel — 错误归一", () => {
  const originalFetch = globalThis.fetch;

  function restoreFetch() {
    globalThis.fetch = originalFetch;
  }

  test("Ollama HTTP 500 走 toApiAppError 抛出 AppError", async () => {
    globalThis.fetch = (async () => new Response("internal error", { status: 500 })) as unknown as typeof fetch;

    const embCfg = {
      apiKey: "",
      baseUrl: "http://localhost:11434",
      dimensions: 768,
      model: "nomic-embed-text",
      type: "ollama" as const,
    };
    const model = createEmbeddingModel(embCfg);

    try {
      await (model as any).doEmbed({ values: ["hi"] });
      throw new Error("应该抛出错误");
    } catch (err) {
      // toApiAppError 500 → NetworkError (NETWORK-100 CONNECTION_FAILED)
      expect(err).toBeInstanceOf(AppError);
      expect((err as { code?: string }).code).toBe("NETWORK-100");
    } finally {
      restoreFetch();
    }
  });

  test("Gemini HTTP 401 走 toApiAppError 抛出 AppError (auth)", async () => {
    globalThis.fetch = (async () => new Response("unauthorized", { status: 401 })) as unknown as typeof fetch;

    const embCfg = {
      apiKey: "bad-key",
      baseUrl: "https://generativelanguage.googleapis.com",
      dimensions: 768,
      model: "text-embedding-004",
      type: "gemini" as const,
    };
    const model = createEmbeddingModel(embCfg);

    try {
      await (model as any).doEmbed({ values: ["hi"] });
      throw new Error("应该抛出错误");
    } catch (err) {
      // 401 → SecurityError (SECURITY-700)
      expect(err).toBeInstanceOf(AppError);
      expect((err as { code?: string }).code).toBe("SECURITY-700");
    } finally {
      restoreFetch();
    }
  });

  test("Gemini JSON 解析失败抛出 AppError", async () => {
    globalThis.fetch = (async () => new Response("not-json{", { status: 200 })) as unknown as typeof fetch;

    const embCfg = {
      apiKey: "k",
      baseUrl: "https://generativelanguage.googleapis.com",
      dimensions: 768,
      model: "text-embedding-004",
      type: "gemini" as const,
    };
    const model = createEmbeddingModel(embCfg);

    try {
      await (model as any).doEmbed({ values: ["x"] });
      throw new Error("应该抛出错误");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as { code?: string }).code).toBe("INTERNAL-904");
    } finally {
      restoreFetch();
    }
  });

  test("Ollama JSON 解析失败抛出 AppError", async () => {
    globalThis.fetch = (async () => new Response("{invalid", { status: 200 })) as unknown as typeof fetch;

    const embCfg = {
      apiKey: "",
      baseUrl: "http://localhost:11434",
      dimensions: 768,
      model: "nomic-embed-text",
      type: "ollama" as const,
    };
    const model = createEmbeddingModel(embCfg);

    try {
      await (model as any).doEmbed({ values: ["y"] });
      throw new Error("应该抛出错误");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as { code?: string }).code).toBe("INTERNAL-904");
    } finally {
      restoreFetch();
    }
  });
});
