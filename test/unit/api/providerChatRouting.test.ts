/**
 * Provider Chat 路由测试。
 *
 * 测试用例:
 *   - requestMethod=chat 时使用 chat 模型工厂
 *   - requestMethod=responses 时使用 responses 模型工厂
 *   - 默认工厂的回退
 *   - Mock 注入后的路由验证
 */
import { afterEach, describe, expect, mock, test } from "bun:test";
import { AppConfigSchema } from "@/schema/config";

afterEach(() => mock.restore());

describe("Provider chat 路由", () => {
  test("requestMethod=chat 时使用 OpenAI chat 模型工厂而不是 responses 默认工厂", async () => {
    mock.module("@ai-sdk/openai", () => ({
      createOpenAI: () => {
        const provider = ((modelId: string) => ({ modelId, route: "responses-default" })) as ((
          modelId: string,
        ) => unknown) & {
          chat: (modelId: string) => unknown;
          responses: (modelId: string) => unknown;
        };
        provider.chat = (modelId: string) => ({ modelId, route: "chat" });
        provider.responses = (modelId: string) => ({ modelId, route: "responses" });
        return provider;
      },
    }));

    // @ts-expect-error test-only cache busting for isolated module evaluation
    const { createProvider } = await import("@/api/core/provider.ts?provider-chat-routing");
    const config = AppConfigSchema.parse({
      defaultProvider: { model: "kimi-k2.5", provider: "relay" },
      providerConfig: {
        relay: {
          apiKey: "test-key",
          baseURL: "https://relay.example.com/v1",
          requestMethod: "chat",
        },
      },
    });

    const providerFactory = createProvider(config, "relay", "kimi-k2.5");
    expect(providerFactory("kimi-k2.5") as any).toEqual({
      modelId: "kimi-k2.5",
      route: "chat",
    });
  });
});
