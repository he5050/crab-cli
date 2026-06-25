/**
 * API 配置权限测试。
 *
 * 测试用例:
 *   - API 权限规则
 *   - 端点保护
 *   - 访问控制
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { AppConfigSchema, RequestMethod } from "@/schema/config";
import type { AppConfigSchema as AppConfigType } from "@/schema/config";
import { buildDerivedProviderConfig, hasLiveProviderConfig, loadRealTestConfig } from "../../helpers/realConfig";

let REAL_CONFIG: AppConfigType;

// Top-level await 确保 skipIf 在模块加载时拿到正确的值
const hasConfig = await hasLiveProviderConfig();

beforeAll(async () => {
  REAL_CONFIG = await loadRealTestConfig();
});

async function createDerivedProviderConfig(
  overrides: Record<string, unknown>,
  options?: { providerId?: string; requestMethod?: "chat" | "responses" | "claude" | "gemini"; model?: string },
) {
  const providerId = options?.providerId ?? "myProvider";
  const config = await buildDerivedProviderConfig({
    model: options?.model,
    providerId,
    requestMethod: options?.requestMethod,
  });
  config.providerConfig[providerId] = {
    ...config.providerConfig[providerId]!,
    ...overrides,
  };
  return AppConfigSchema.parse(config);
}

describe("RequestMethod 枚举验证", () => {
  test("chat / responses / claude / gemini 四种合法值", () => {
    for (const method of ["chat", "responses", "claude", "gemini"] as const) {
      expect(RequestMethod.safeParse(method).success).toBe(true);
    }
  });

  test("非法值被拒绝", () => {
    expect(RequestMethod.safeParse("stream").success).toBe(false);
    expect(RequestMethod.safeParse("openai").success).toBe(false);
    expect(RequestMethod.safeParse("custom").success).toBe(false);
  });

  test("config.json 中的 requestMethod 值全部合法", async () => {
    const configs = await Promise.all([
      buildDerivedProviderConfig({ model: "chat-model", providerId: "provider1", requestMethod: "chat" }),
      buildDerivedProviderConfig({ model: "responses-model", providerId: "provider2", requestMethod: "responses" }),
      buildDerivedProviderConfig({ model: "claude-model", providerId: "provider3", requestMethod: "claude" }),
      buildDerivedProviderConfig({ model: "gemini-model", providerId: "provider4", requestMethod: "gemini" }),
    ]);
    expect(configs[0].providerConfig.provider1!.requestMethod).toBe("chat");
    expect(configs[1].providerConfig.provider2!.requestMethod).toBe("responses");
    expect(configs[2].providerConfig.provider3!.requestMethod).toBe("claude");
    expect(configs[3].providerConfig.provider4!.requestMethod).toBe("gemini");
  });
});

describe("API 配置扩展 — 自定义请求头/提示词/thinking/token/超时", () => {
  test("SingleProviderConfig 支持 customHeaders", async () => {
    const config = await createDerivedProviderConfig({
      customHeaders: { "X-Custom-Auth": "token123" },
    });
    expect(config.providerConfig.myProvider!.customHeaders).toEqual({ "X-Custom-Auth": "token123" });
  });

  test("SingleProviderConfig 支持 systemPrompt", async () => {
    const config = await createDerivedProviderConfig({
      systemPrompt: "你是一个代码助手",
    });
    expect(config.providerConfig.myProvider!.systemPrompt).toBe("你是一个代码助手");
  });

  test("SingleProviderConfig 支持 thinking 配置", async () => {
    const config = await createDerivedProviderConfig({
      thinking: { budgetTokens: 5000, enabled: true },
    });
    expect(config.providerConfig.myProvider!.thinking?.enabled).toBe(true);
    expect(config.providerConfig.myProvider!.thinking?.budgetTokens).toBe(5000);
  });

  test("SingleProviderConfig 支持 requestThinking 配置", async () => {
    const config = await createDerivedProviderConfig({
      requestThinking: {
        chat: { enabled: true, reasoningEffort: "low" },
        claude: { budgetTokens: 12_000, enabled: true },
        gemini: { budgetTokens: 8192, enabled: true, includeThoughts: true, thinkingLevel: "high" },
        responses: { enabled: true, reasoningEffort: "high" },
      },
    });
    expect(config.providerConfig.myProvider!.requestThinking?.chat?.reasoningEffort).toBe("low");
    expect(config.providerConfig.myProvider!.requestThinking?.responses?.reasoningEffort).toBe("high");
    expect(config.providerConfig.myProvider!.requestThinking?.claude?.budgetTokens).toBe(12_000);
    expect(config.providerConfig.myProvider!.requestThinking?.gemini?.includeThoughts).toBe(true);
    expect(config.providerConfig.myProvider!.requestThinking?.gemini?.thinkingLevel).toBe("high");
  });

  test("SingleProviderConfig 支持 maxTokens", async () => {
    const config = await createDerivedProviderConfig({
      maxTokens: 4096,
    });
    expect(config.providerConfig.myProvider!.maxTokens).toBe(4096);
  });

  test("SingleProviderConfig 支持 streamTimeout", async () => {
    const config = await createDerivedProviderConfig({
      streamTimeout: 30_000,
    });
    expect(config.providerConfig.myProvider!.streamTimeout).toBe(30_000);
  });

  test("SingleProviderConfig 支持 temperature", async () => {
    const config = await createDerivedProviderConfig({
      temperature: 0.5,
    });
    expect(config.providerConfig.myProvider!.temperature).toBe(0.5);
  });

  test("SingleProviderConfig 支持 modelRequestMethods", async () => {
    const config = await createDerivedProviderConfig(
      {
        modelRequestMethods: {
          "claude-special": "claude",
          "gpt-responses": "responses",
        },
      },
      { model: "chat-model", requestMethod: "chat" },
    );
    expect(config.providerConfig.myProvider!.modelRequestMethods).toEqual({
      "claude-special": "claude",
      "gpt-responses": "responses",
    });
  });

  test("SingleProviderConfig 支持独立 Vision 配置", async () => {
    const config = await createDerivedProviderConfig({
      visionApiKey: "sk-vision",
      visionBaseURL: "https://vision.example.com/v1",
      visionCustomHeaders: { "X-Vision": "1" },
      visionModel: "gpt-4o-mini",
      visionProvider: "visionOpenAI",
      visionRequestMethod: "responses",
    });
    expect(config.providerConfig.myProvider!.visionProvider).toBe("visionOpenAI");
    expect(config.providerConfig.myProvider!.visionModel).toBe("gpt-4o-mini");
    expect(config.providerConfig.myProvider!.visionBaseURL).toBe("https://vision.example.com/v1");
    expect(config.providerConfig.myProvider!.visionApiKey).toBe("sk-vision");
    expect(config.providerConfig.myProvider!.visionRequestMethod).toBe("responses");
    expect(config.providerConfig.myProvider!.visionCustomHeaders).toEqual({ "X-Vision": "1" });
  });

  test("所有扩展字段为 optional", async () => {
    const config = await buildDerivedProviderConfig({
      model: "minimal-model",
      providerId: "minimal",
    });
    const pConf = config.providerConfig.minimal!;
    expect(pConf.customHeaders).toBeUndefined();
    expect(pConf.systemPrompt).toBeUndefined();
    expect(pConf.thinking).toBeUndefined();
    expect(pConf.maxTokens).toBeUndefined();
    expect(pConf.streamTimeout).toBeUndefined();
    expect(pConf.temperature).toBeUndefined();
  });

  test("temperature 范围限制 0-2", () => {
    expect(
      AppConfigSchema.safeParse({
        providerConfig: { p: { temperature: 3 } },
      }).success,
    ).toBe(false);
    expect(
      AppConfigSchema.safeParse({
        providerConfig: { p: { temperature: -0.1 } },
      }).success,
    ).toBe(false);
  });

  test("catchall 保留未知字段(tavilyApiKey 等)", () => {
    const config = AppConfigSchema.parse({
      tavilyApiKey: "test-key",
      tavilyBaseURL: "https://tavily.example.com",
    });
    expect((config as any).tavilyApiKey).toBe("test-key");
    expect((config as any).tavilyBaseURL).toBe("https://tavily.example.com");
  });

  test.skipIf(!hasConfig)("用户的真实 config.json 格式能正确解析", () => {
    const config = AppConfigSchema.parse(structuredClone(REAL_CONFIG));
    const defaultProviderId = config.defaultProvider.provider;
    const resolvedProviderId = config.providerConfig[defaultProviderId]
      ? defaultProviderId
      : Object.keys(config.providerConfig)[0];

    expect(defaultProviderId).toBeTruthy();
    expect(resolvedProviderId).toBeTruthy();
    expect(config.providerConfig[resolvedProviderId!]).toBeDefined();
    expect(Object.keys(config.providerConfig).length).toBeGreaterThan(0);
  });
});
