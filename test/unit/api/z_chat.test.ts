/**
 * Chat API 单元测试。
 */
import { afterEach, describe, expect, mock, test } from "bun:test";
import { AppEvent } from "@/bus";
import { createEventBusSpy } from "../../helpers/eventBusSpy";

const originalFetch = globalThis.fetch;
let chatImportSeq = 0;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restore();
});

async function loadChatModule() {
  chatImportSeq += 1;
  return import(`@api?chat-test-${chatImportSeq}`);
}

// ─── Helper: mock @/api/core/llm at the module level ─────────────
// We MUST use mock.module here because chat.ts has a static import
// of streamLlm from "./llm". After testing, explicitly clean up via
// afterAll to prevent cross-file mock pollution in Bun v1.3.14.

import { afterAll } from "bun:test";

afterAll(() => {
  // Bun's mock.restore() in afterEach does not reliably clear
  // mock.module registrations across file boundaries.  Explicitly
  // re-register the real module's exports as a no-mock pass-through
  // so that subsequent test files don't pick up a stale mock.
  mock.restore();
  // Double restore – sometimes the first one is not enough in Bun.
  mock.restore();
});

describe("Chat API", () => {
  test("chat 正常流式输出文本", async () => {
    const actualLlm = await import("@/api/core/llm");
    mock.module("@/api/core/llm", () => ({
      ...actualLlm,
      streamLlm: async function* streamLlm() {
        yield { text: "Hello", type: "text-delta" };
        yield { text: " World", type: "text-delta" };
      },
    }));

    const { chat } = await loadChatModule();
    const events = [];
    for await (const event of chat({ defaultProvider: { model: "test", provider: "openai" } } as any, [
      { content: "hi", role: "user" },
    ])) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ text: "Hello", type: "text-delta" });
    expect(events[1]).toEqual({ text: " World", type: "text-delta" });
  });

  test("chat 遇到 error 事件时透传给调用方", async () => {
    const actualLlm = await import("@/api/core/llm");
    mock.module("@/api/core/llm", () => ({
      ...actualLlm,
      streamLlm: async function* streamLlm() {
        yield { text: "partial", type: "text-delta" };
        yield { error: new Error("stream failed"), type: "error" };
      },
    }));

    const { chat } = await loadChatModule();
    const events = [];
    for await (const event of chat({ defaultProvider: { model: "test", provider: "openai" } } as any, [
      { content: "hi", role: "user" },
    ])) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ text: "partial", type: "text-delta" });
    expect(events[1]).toMatchObject({ type: "error" });
    expect((events[1] as { error: Error }).error.message).toBe("stream failed");
  });

  test("chat 透传 reasoning-delta 事件", async () => {
    const actualLlm = await import("@/api/core/llm");
    mock.module("@/api/core/llm", () => ({
      ...actualLlm,
      streamLlm: async function* streamLlm() {
        yield { text: "Let me think", type: "reasoning-delta" };
        yield { text: "Result", type: "text-delta" };
      },
    }));

    const { chat } = await loadChatModule();
    const events = [];
    for await (const event of chat({ defaultProvider: { model: "test", provider: "openai" } } as any, [
      { content: "hi", role: "user" },
    ])) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ text: "Let me think", type: "reasoning-delta" });
    expect(events[1]).toEqual({ text: "Result", type: "text-delta" });
  });
});

// ─── chatComplete 非流式对话测试 ─────────────────────────────────

describe("chatComplete", () => {
  test("正常流：聚合文本和 usage", async () => {
    const actualLlm = await import("@/api/core/llm");
    mock.module("@/api/core/llm", () => ({
      ...actualLlm,
      streamLlm: async function* streamLlm() {
        yield { text: "Hello", type: "text-delta" };
        yield { text: " World", type: "text-delta" };
        yield { type: "done", usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 } };
      },
    }));

    const { chatComplete } = await loadChatModule();
    const result = await chatComplete({ defaultProvider: { model: "test", provider: "openai" } } as any, [
      { content: "hi", role: "user" },
    ]);

    expect(result.text).toBe("Hello World");
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 20, totalTokens: 30 });
    expect(result.reasoning).toBeUndefined();
  });

  test("聚合 reasoning 内容", async () => {
    const actualLlm = await import("@/api/core/llm");
    mock.module("@/api/core/llm", () => ({
      ...actualLlm,
      streamLlm: async function* streamLlm() {
        yield { text: "step 1", type: "reasoning-delta" };
        yield { text: "step 2", type: "reasoning-delta" };
        yield { text: "Answer", type: "text-delta" };
        yield { type: "done" };
      },
    }));

    const { chatComplete } = await loadChatModule();
    const result = await chatComplete({ defaultProvider: { model: "test", provider: "openai" } } as any, [
      { content: "hi", role: "user" },
    ]);

    expect(result.text).toBe("Answer");
    expect(result.reasoning).toBe("step 1step 2");
  });

  test("空消息列表抛出错误", async () => {
    const actualLlm = await import("@/api/core/llm");
    mock.module("@/api/core/llm", () => ({ ...actualLlm }));

    const { chatComplete } = await loadChatModule();
    await expect(chatComplete({ defaultProvider: { model: "test", provider: "openai" } } as any, [])).rejects.toThrow(
      "chatComplete: 消息列表不能为空",
    );
  });

  test("error 事件传播为异常", async () => {
    const actualLlm = await import("@/api/core/llm");
    mock.module("@/api/core/llm", () => ({
      ...actualLlm,
      streamLlm: async function* streamLlm() {
        yield { text: "partial", type: "text-delta" };
        yield { error: new Error("LLM exploded"), type: "error" };
      },
    }));

    const { chatComplete } = await loadChatModule();
    await expect(
      chatComplete({ defaultProvider: { model: "test", provider: "openai" } } as any, [
        { content: "hi", role: "user" },
      ]),
    ).rejects.toThrow("LLM exploded");
  });

  test("空 reasoning 不设置字段", async () => {
    const actualLlm = await import("@/api/core/llm");
    mock.module("@/api/core/llm", () => ({
      ...actualLlm,
      streamLlm: async function* streamLlm() {
        yield { text: "No reasoning", type: "text-delta" };
        yield { type: "done" };
      },
    }));

    const { chatComplete } = await loadChatModule();
    const result = await chatComplete({ defaultProvider: { model: "test", provider: "openai" } } as any, [
      { content: "hi", role: "user" },
    ]);

    expect(result.text).toBe("No reasoning");
    expect(result.reasoning).toBeUndefined();
  });
});

// ─── P0-4: 事件总线订阅工具 ─────────────────────────────────────

describe("eventBusSpy 工具", () => {
  afterEach(() => mock.restore());

  test("createEventBusSpy 可正常订阅与取消订阅", () => {
    const spy = createEventBusSpy();
    spy.clear();
    spy.subscribe([AppEvent.ChatChunk, AppEvent.ProviderStatus]);
    expect(spy.collected(AppEvent.ChatChunk)).toBeDefined();
    spy.unsubscribeAll();
  });

  test("collected 返回空数组当未触发任何事件", () => {
    const spy = createEventBusSpy();
    spy.clear();
    spy.subscribe([AppEvent.ChatChunk]);
    expect(spy.collected(AppEvent.ChatChunk)).toEqual([]);
    spy.unsubscribeAll();
  });
});
