/**
 * Provider 单元测试
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { checkProviderHealth } from "@/api";
import { AppConfigSchema } from "@/schema/config";

function withPreconnect(fn: any) {
  return Object.assign(fn, { preconnect: async () => {} }) as typeof fetch;
}

describe("checkProviderHealth", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = withPreconnect(async () => new Response("{}", { status: 200 }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("chat provider uses /v1/models", async () => {
    const config = AppConfigSchema.parse({
      providerConfig: {
        openai: { apiKey: "test", baseURL: "https://api.openai.com", requestMethod: "chat" },
      },
    });

    let calledUrl: string | undefined;
    globalThis.fetch = withPreconnect(async (url: string | URL | Request) => {
      calledUrl = typeof url === "string" ? url : url instanceof Request ? url.url : String(url);
      return new Response("{}", { status: 200 });
    });

    await checkProviderHealth(config, "openai");
    expect(calledUrl).toBe("https://api.openai.com/v1/models");
  });

  test("responses provider uses /v1/models", async () => {
    const config = AppConfigSchema.parse({
      providerConfig: {
        openai: { apiKey: "test", baseURL: "https://api.openai.com", requestMethod: "responses" },
      },
    });

    let calledUrl: string | undefined;
    globalThis.fetch = withPreconnect(async (url: string | URL | Request) => {
      calledUrl = typeof url === "string" ? url : url instanceof Request ? url.url : String(url);
      return new Response("{}", { status: 200 });
    });

    await checkProviderHealth(config, "openai");
    expect(calledUrl).toBe("https://api.openai.com/v1/models");
  });

  test("claude provider uses baseURL", async () => {
    const config = AppConfigSchema.parse({
      providerConfig: {
        anthropic: { apiKey: "test", baseURL: "https://api.anthropic.com", requestMethod: "claude" },
      },
    });

    let calledUrl: string | undefined;
    globalThis.fetch = withPreconnect(async (url: string | URL | Request) => {
      calledUrl = typeof url === "string" ? url : url instanceof Request ? url.url : String(url);
      return new Response("{}", { status: 200 });
    });

    await checkProviderHealth(config, "anthropic");
    expect(calledUrl).toBe("https://api.anthropic.com");
  });

  test("gemini provider uses /v1beta/models with X-Goog-Api-Key header", async () => {
    const config = AppConfigSchema.parse({
      providerConfig: {
        google: {
          apiKey: "gkey",
          baseURL: "https://generativelanguage.googleapis.com",
          requestMethod: "gemini",
        },
      },
    });

    let calledHeaders: Record<string, string> = {};
    globalThis.fetch = withPreconnect(async (url: string | URL | Request, init?: RequestInit) => {
      const h = init?.headers as Record<string, string>;
      calledHeaders = h;
      return new Response("{}", { status: 200 });
    });

    await checkProviderHealth(config, "google");
    expect(calledHeaders["X-Goog-Api-Key"]).toBe("gkey");
  });

  test("401 returns unhealthy", async () => {
    const config = AppConfigSchema.parse({
      providerConfig: {
        openai: { apiKey: "test", baseURL: "https://api.openai.com", requestMethod: "chat" },
      },
    });

    globalThis.fetch = withPreconnect(async () => new Response("{}", { status: 401 }));

    const result = await checkProviderHealth(config, "openai");
    expect(result.status).toBe("unhealthy");
    expect(result.error).toBe("API Key 无效");
  });

  test("claude non-5xx status is healthy", async () => {
    const config = AppConfigSchema.parse({
      providerConfig: {
        anthropic: { apiKey: "test", baseURL: "https://api.anthropic.com", requestMethod: "claude" },
      },
    });

    globalThis.fetch = withPreconnect(async () => new Response("Not Found", { status: 404 }));

    const result = await checkProviderHealth(config, "anthropic");
    expect(result.status).toBe("healthy");
  });
});
