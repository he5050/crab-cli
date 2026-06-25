/**
 * chat() / chatComplete() 单元测试。
 *
 * 测试目标:
 * - chat() 消息为空时返回 error 事件
 * - chat() 通过 mock streamText 正常返回流式事件
 * - chatComplete() 消息为空时抛出错误
 * - chatComplete() 通过 mock streamText 正常返回 ChatResult
 * - chatComplete() 无真实 API 时抛出连接错误（验证委托链路）
 * - chatComplete() null/undefined 消息列表视为空
 */
import { afterEach, describe, expect, test } from "bun:test";
import { chat, chatComplete } from "@/api/core/chat";
import { _setStreamTextForTesting, _resetStreamTextForTesting } from "@/api/stream/streamHandler";
import type { AppConfigSchema } from "@/schema/config";
import type { ModelMessage } from "ai";

// ─── 测试用配置 ────────────────────────────────────────────

const mockConfig = {
  defaultProvider: { provider: "test", model: "test-model" },
  providerConfig: {
    test: { apiKey: "k", baseURL: "https://api.test", requestMethod: "chat" as const },
  },
} as unknown as AppConfigSchema;

const emptyMessages: ModelMessage[] = [];
const simpleMessages: ModelMessage[] = [{ content: "hello", role: "user" }];

// ─── mock streamText 工厂 ──────────────────────────────────

/**
 * 设置 mock streamText，返回指定的文本和推理片段。
 * mock 会模拟 streamText 的返回结构（fullStream + consumeStream）。
 */
function setupMockStreamText(textParts: string[], reasoningParts: string[] = []) {
  _setStreamTextForTesting(((_opts: unknown) => {
    async function* fullStream() {
      for (const text of textParts) {
        yield { type: "text-delta", text };
      }
      for (const reasoning of reasoningParts) {
        yield { type: "reasoning-delta", text: reasoning };
      }
      yield {
        type: "finish",
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      };
    }
    return {
      consumeStream: async () => {},
      fullStream: fullStream(),
    } as any;
  }) as any);
}

describe("chat()", () => {
  afterEach(() => {
    _resetStreamTextForTesting();
  });

  test("消息列表为空时返回 error 事件", async () => {
    const events: any[] = [];
    for await (const event of chat(mockConfig, emptyMessages)) {
      events.push(event);
    }
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("error");
    expect(events[0].error.message).toContain("消息列表不能为空");
  });

  test("通过 mock streamText 正常返回流式事件", async () => {
    setupMockStreamText(["你好", "世界"]);

    const events: any[] = [];
    for await (const event of chat(mockConfig, simpleMessages)) {
      events.push(event);
    }

    const textDeltas = events.filter((e: any) => e.type === "text-delta");
    expect(textDeltas.length).toBe(2);
    expect(textDeltas[0].text).toBe("你好");
    expect(textDeltas[1].text).toBe("世界");

    const doneEvents = events.filter((e: any) => e.type === "done");
    expect(doneEvents.length).toBe(1);
    expect(doneEvents[0].usage).toBeDefined();
    expect(doneEvents[0].usage.totalTokens).toBe(30);
  });
});

describe("chatComplete()", () => {
  afterEach(() => {
    _resetStreamTextForTesting();
  });

  test("消息列表为空时抛出错误", () => {
    expect(chatComplete(mockConfig, emptyMessages)).rejects.toThrow("消息列表不能为空");
  });

  test("通过 mock streamText 正常返回 ChatResult", async () => {
    setupMockStreamText(["你好", "世界"], ["让我想想"]);

    const result = await chatComplete(mockConfig, simpleMessages);

    expect(result.text).toBe("你好世界");
    expect(result.reasoning).toBe("让我想想");
    expect(result.usage).toBeDefined();
    expect(result.usage!.totalTokens).toBe(30);
  });

  test("无真实 API 时抛出错误（验证委托链路）", async () => {
    _setStreamTextForTesting((() => {
      throw new Error("模拟 API 连接失败");
    }) as any);
    try {
      await chatComplete(mockConfig, simpleMessages);
      expect.unreachable("应在无 API 环境下抛出错误");
    } catch (error: any) {
      expect(error).toBeDefined();
      expect(error.message).toContain("模拟 API 连接失败");
    }
  });

  test("null/undefined 消息列表视为空", async () => {
    expect(chatComplete(mockConfig, null as any)).rejects.toThrow("消息列表不能为空");
    expect(chatComplete(mockConfig, undefined as any)).rejects.toThrow("消息列表不能为空");
  });
});
