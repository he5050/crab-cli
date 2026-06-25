/**
 * [测试目标] ConversationHandler 流超时接线。
 *
 * 测试目标:
 *   - 验证 providerConfig.streamTimeout 能正确传入 streamFn options，并且每个 text delta 都会被 bus 派发
 *
 * 测试用例:
 *   - passes provider streamTimeout into streamFn options:构造 baseConfig.streamTimeout=123456，断言被 streamFn options 捕获
 *   - publishes each text delta without throttling them into the last chunk:订阅 ConversationStreamToken，断言每个 delta 都派发
 */
import { describe, expect, test } from "bun:test";
import { globalBus } from "@/bus";
import { AppEvent } from "@/bus";
import type { AppConfigSchema } from "@/schema/config";
import type { LlmOptions } from "@/api";

const baseConfig: AppConfigSchema = {
  agents: [],
  customHeaders: {},
  defaultProvider: { model: "test-model", provider: "test-provider" },
  devMode: false,
  doomLoopThreshold: 5,
  maxContextTokens: 200_000,
  maxSpawnDepth: 3,
  permissions: [],
  profile: "default",
  providerConfig: {
    "test-provider": {
      baseURL: "https://example.com/v1",
      requestMethod: "chat",
      streamTimeout: 123_456,
    },
  },
  proxy: { browserDebugPort: 9222, enabled: false, port: 7890, searchEngine: "duckduckgo" },
  sensitiveCommands: { commands: [], enabled: true },
  theme: "dark",
  toolResultTokenLimitPercent: 30,
} as unknown as AppConfigSchema;

describe("ConversationHandler 流超时连接", () => {
  test("通过提供方 streamTimeout 到 streamFn 选项", async () => {
    const { ConversationHandler } = await import(`@/conversation/core/conversationHandler.ts`);
    let capturedTimeout: number | undefined;
    const handler = new ConversationHandler(baseConfig, {
      async *streamFn(_config: AppConfigSchema, _messages: unknown[], options?: LlmOptions) {
        capturedTimeout = options?.timeout;
        yield { fullText: "ok", type: "done" } as const;
      },
    });

    const result = await handler.sendMessage("hello");

    expect(result.ok).toBe(true);
    expect(capturedTimeout).toBe(123_456);
    handler.destroy();
  });

  test("publishes each text delta without throttling them into the last chunk", async () => {
    const { ConversationHandler } = await import(`@/conversation/core/conversationHandler.ts`);
    const observed: string[] = [];
    const unsub = globalBus.subscribe(AppEvent.ConversationStreamToken, (evt) => {
      observed.push(evt.properties.content);
    });
    const handler = new ConversationHandler(baseConfig, {
      sessionId: "ses_stream_token_full",
      async *streamFn() {
        yield { text: "OK_", type: "text-delta" } as const;
        yield { text: "REAL_", type: "text-delta" } as const;
        yield { text: "HEADLESS", type: "text-delta" } as const;
        yield { fullText: "OK_REAL_HEADLESS", type: "done" } as const;
      },
    });

    const result = await handler.sendMessage("hello");
    await globalBus.flush();
    unsub();
    handler.destroy();

    expect(result.ok).toBe(true);
    expect(observed).toEqual(["OK_", "REAL_", "HEADLESS"]);
  });
});
