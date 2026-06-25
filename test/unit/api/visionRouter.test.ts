/**
 * Vision Router 单元测试。
 *
 * 覆盖 4 条路由路径:
 *   1. 无图片内容 → usingVision=false，原始配置不变
 *   2. 有图片 + 独立 Vision 配置（visionProvider）→ 切换到专用 Provider
 *   3. 有图片 + 仅 visionModel → 同 Provider 切换模型
 *   4. 有图片 + 无任何 Vision 配置 → usingVision=false，保持原始配置
 */
import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  hasVisionContent,
  hasDedicatedVisionConfig,
  buildVisionProviderConfig,
  resolveStreamRuntime,
} from "@/api/stream/visionRouter";
import type { ModelMessage } from "ai";
import type { SingleProviderConfig, AppConfigSchema } from "@/schema/config";

afterEach(() => {
  mock.restore();
});

// ─── 测试辅助 ────────────────────────────────────────────────────

function createBaseConfig(overrides: Record<string, unknown> = {}): AppConfigSchema {
  return {
    defaultProvider: { model: "gpt-4o", provider: "openai" },
    maxContextTokens: 128_000,
    providerConfig: {
      openai: {
        apiKey: "test-key",
        baseURL: "https://api.openai.test/v1",
        requestMethod: "chat" as const,
        defaultModel: "gpt-4o",
        modelList: ["gpt-4o", "gpt-4o-mini"],
        ...overrides,
      },
      vision: {
        apiKey: "vision-key",
        baseURL: "https://api.vision.test/v1",
        requestMethod: "chat" as const,
        defaultModel: "gpt-4-vision",
        modelList: ["gpt-4-vision"],
      },
    },
  } as unknown as AppConfigSchema;
}

function textMessages(): ModelMessage[] {
  return [{ content: "Hello", role: "user" }];
}

function imageMessages(): ModelMessage[] {
  return [
    {
      content: [
        { type: "text", text: "What is this?" },
        { type: "image", image: "data:image/png;base64,abc123" },
      ],
      role: "user",
    },
  ];
}

function fileMessages(): ModelMessage[] {
  return [
    {
      content: [
        { type: "text", text: "Analyze this" },
        { type: "file", data: "file-content", mediaType: "application/pdf" } as any,
      ],
      role: "user",
    },
  ];
}

function toolResultMessages(): ModelMessage[] {
  return [
    {
      content: [{ type: "tool-result", toolCallId: "call_1", toolName: "read_file", content: "file data" } as any],
      role: "assistant",
    },
  ];
}

// Mock getVerifiedMethod — visionRouter 内部依赖 fallback 模块
mock.module("@/api/resilience/fallback", () => ({
  getVerifiedMethod: (_config: unknown, _providerId: string, _modelId?: string) => "chat",
  probeFallback: () => Promise.resolve(null),
  setVerifiedMethod: () => {},
  clearVerifiedMethods: () => {},
  getFallbackChain: () => [],
  getProbeTimeout: () => 5000,
}));

// ─── hasVisionContent ───────────────────────────────────────────

describe("hasVisionContent", () => {
  test("纯文本消息返回 false", () => {
    expect(hasVisionContent(textMessages())).toBe(false);
  });

  test("包含图片的消息返回 true", () => {
    expect(hasVisionContent(imageMessages())).toBe(true);
  });

  test("包含文件的消息返回 true", () => {
    expect(hasVisionContent(fileMessages())).toBe(true);
  });

  test("包含 tool-result 的消息返回 true", () => {
    expect(hasVisionContent(toolResultMessages())).toBe(true);
  });

  test("空消息列表返回 false", () => {
    expect(hasVisionContent([])).toBe(false);
  });

  test("混合消息：一条文本一条图片返回 true", () => {
    expect(
      hasVisionContent([
        { content: "text only", role: "user" },
        { content: [{ type: "image", image: "data:image/png;base64,xyz" }], role: "user" },
      ]),
    ).toBe(true);
  });
});

// ─── hasDedicatedVisionConfig ────────────────────────────────────

describe("hasDedicatedVisionConfig", () => {
  test("无 Vision 配置返回 false", () => {
    const cfg = { apiKey: "k", baseURL: "https://example.com" } as SingleProviderConfig;
    expect(hasDedicatedVisionConfig(cfg)).toBe(false);
  });

  test("有 visionProvider 返回 true", () => {
    const cfg = { apiKey: "k", visionProvider: "vision" } as unknown as SingleProviderConfig;
    expect(hasDedicatedVisionConfig(cfg)).toBe(true);
  });

  test("有 visionBaseURL 返回 true", () => {
    const cfg = { apiKey: "k", visionBaseURL: "https://vision.test" } as unknown as SingleProviderConfig;
    expect(hasDedicatedVisionConfig(cfg)).toBe(true);
  });

  test("有 visionApiKey 返回 true", () => {
    const cfg = { apiKey: "k", visionApiKey: "vk" } as unknown as SingleProviderConfig;
    expect(hasDedicatedVisionConfig(cfg)).toBe(true);
  });

  test("有 visionRequestMethod 返回 true", () => {
    const cfg = { apiKey: "k", visionRequestMethod: "claude" } as unknown as SingleProviderConfig;
    expect(hasDedicatedVisionConfig(cfg)).toBe(true);
  });

  test("仅有 visionModel（无独立 Vision 配置）返回 false", () => {
    const cfg = { apiKey: "k", visionModel: "gpt-4-vision" } as unknown as SingleProviderConfig;
    expect(hasDedicatedVisionConfig(cfg)).toBe(false);
  });

  test("undefined 返回 false", () => {
    expect(hasDedicatedVisionConfig(undefined)).toBe(false);
  });
});

// ─── buildVisionProviderConfig ──────────────────────────────────

describe("buildVisionProviderConfig", () => {
  test("合并 Vision 专用字段覆盖基础配置", () => {
    const cfg = {
      apiKey: "base-key",
      baseURL: "https://base.test",
      customHeaders: { "X-Base": "1" },
      requestMethod: "chat" as const,
      defaultModel: "gpt-4o",
      visionApiKey: "vision-key",
      visionBaseURL: "https://vision.test",
      visionCustomHeaders: { "X-Vision": "2" },
      visionModel: "gpt-4-vision",
      visionRequestMethod: "claude",
    } as unknown as SingleProviderConfig;

    const merged = buildVisionProviderConfig(cfg);
    expect(merged.apiKey).toBe("vision-key");
    expect(merged.baseURL).toBe("https://vision.test");
    expect(merged.customHeaders).toEqual({ "X-Base": "1", "X-Vision": "2" });
    expect(merged.defaultModel).toBe("gpt-4-vision");
    expect(merged.requestMethod).toBe("claude");
  });

  test("无 Vision 专用字段时保持基础配置不变", () => {
    const cfg = {
      apiKey: "base-key",
      baseURL: "https://base.test",
      customHeaders: {},
      requestMethod: "chat" as const,
      defaultModel: "gpt-4o",
    } as unknown as SingleProviderConfig;

    const merged = buildVisionProviderConfig(cfg);
    expect(merged.apiKey).toBe("base-key");
    expect(merged.baseURL).toBe("https://base.test");
    expect(merged.defaultModel).toBe("gpt-4o");
    expect(merged.requestMethod).toBe("chat");
  });
});

// ─── resolveStreamRuntime — 4 条路由路径 ──────────────────────

describe("resolveStreamRuntime", () => {
  test("路径1: 无图片内容 → usingVision=false，原始配置不变", () => {
    const config = createBaseConfig();
    const runtime = resolveStreamRuntime(config, "openai", "gpt-4o", textMessages());

    expect(runtime.usingVision).toBe(false);
    expect(runtime.providerId).toBe("openai");
    expect(runtime.modelId).toBe("gpt-4o");
    expect(runtime.requestMethod).toBe("chat");
    expect(runtime.config).toBe(config);
  });

  test("路径2: 有图片 + 独立 Vision 配置 → 切换到专用 Provider", () => {
    const config = createBaseConfig({
      visionProvider: "vision",
      visionApiKey: "vision-key",
      visionBaseURL: "https://api.vision.test/v1",
      visionModel: "gpt-4-vision",
    });

    const runtime = resolveStreamRuntime(config, "openai", "gpt-4o", imageMessages());

    expect(runtime.usingVision).toBe(true);
    expect(runtime.providerId).toBe("vision");
    expect(runtime.modelId).toBe("gpt-4-vision");
    // 切换后配置中的 Provider 应使用 Vision 参数
    expect(runtime.config.providerConfig["vision"]?.apiKey).toBe("vision-key");
    expect(runtime.config.providerConfig["vision"]?.baseURL).toBe("https://api.vision.test/v1");
  });

  test("路径2: 同 Provider 的独立 Vision 配置（visionBaseURL）→ 使用合并配置", () => {
    const config = createBaseConfig({
      visionBaseURL: "https://vision-endpoint.test/v1",
      visionApiKey: "vision-only-key",
      visionModel: "gpt-4-vision",
    });

    const runtime = resolveStreamRuntime(config, "openai", "gpt-4o", imageMessages());

    expect(runtime.usingVision).toBe(true);
    expect(runtime.providerId).toBe("openai"); // 同 Provider
    expect(runtime.modelId).toBe("gpt-4-vision");
    // 合并后的配置应包含 Vision 专用参数
    const mergedCfg = runtime.config.providerConfig["openai"];
    expect(mergedCfg?.apiKey).toBe("vision-only-key");
    expect(mergedCfg?.baseURL).toBe("https://vision-endpoint.test/v1");
  });

  test("路径3: 有图片 + 仅 visionModel → 同 Provider 切换模型", () => {
    const config = createBaseConfig({
      visionModel: "gpt-4o-vision-preview",
    });

    const runtime = resolveStreamRuntime(config, "openai", "gpt-4o", imageMessages());

    expect(runtime.usingVision).toBe(true);
    expect(runtime.providerId).toBe("openai");
    expect(runtime.modelId).toBe("gpt-4o-vision-preview");
    // 配置本身不变
    expect(runtime.config).toBe(config);
  });

  test("路径4: 有图片 + 无任何 Vision 配置 → usingVision=false，保持原始配置", () => {
    const config = createBaseConfig(); // 无 visionProvider/visionModel 等

    const runtime = resolveStreamRuntime(config, "openai", "gpt-4o", imageMessages());

    expect(runtime.usingVision).toBe(false);
    expect(runtime.providerId).toBe("openai");
    expect(runtime.modelId).toBe("gpt-4o");
    expect(runtime.config).toBe(config);
  });

  test("Provider 配置缺失时正常回退", () => {
    const config = {
      defaultProvider: { model: "gpt-4o", provider: "openai" },
      maxContextTokens: 128_000,
      providerConfig: {},
    } as unknown as AppConfigSchema;

    const runtime = resolveStreamRuntime(config, "openai", "gpt-4o", textMessages());

    expect(runtime.usingVision).toBe(false);
    expect(runtime.providerId).toBe("openai");
    expect(runtime.modelId).toBe("gpt-4o");
  });

  test("文件类型也触发 Vision 路由", () => {
    const config = createBaseConfig({ visionModel: "gpt-4-vision" });
    const runtime = resolveStreamRuntime(config, "openai", "gpt-4o", fileMessages());

    expect(runtime.usingVision).toBe(true);
    expect(runtime.modelId).toBe("gpt-4-vision");
  });

  test("tool-result 类型也触发 Vision 路由", () => {
    const config = createBaseConfig({ visionModel: "gpt-4-vision" });
    const runtime = resolveStreamRuntime(config, "openai", "gpt-4o", toolResultMessages());

    expect(runtime.usingVision).toBe(true);
    expect(runtime.modelId).toBe("gpt-4-vision");
  });
});
