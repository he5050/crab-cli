/**
 * Stream Handler 单元测试
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { doStreamCall, _setStreamTextForTesting, _resetStreamTextForTesting } from "@/api";
import { AppConfigSchema } from "@/schema/config";

const baseConfig = {
  providerConfig: {
    openai: {
      apiKey: "test",
      baseURL: "http://localhost:9999",
      requestMethod: "chat",
    },
  },
  models: [{ modelId: "gpt-4", providerId: "openai", requestMethod: "chat" }],
  defaultProvider: { model: "gpt-4", provider: "openai" },
} as any;

describe("doStreamCall empty response detection", () => {
  beforeEach(() => _resetStreamTextForTesting());
  afterEach(() => _resetStreamTextForTesting());

  test("reasoning-only response is not treated as empty", async () => {
    _setStreamTextForTesting(
      () =>
        ({
          fullStream: (async function* () {
            yield { type: "reasoning-delta", text: "Thinking..." };
            yield { type: "finish" };
          })(),
        }) as any,
    );

    const events: any[] = [];
    for await (const event of doStreamCall(baseConfig, "openai", "gpt-4", [], {})) {
      events.push(event);
    }

    expect(events.some((e) => e.type === "reasoning-delta")).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(true);
  });

  test("empty text + empty reasoning + no tool call throws error", async () => {
    _setStreamTextForTesting(
      () =>
        ({
          fullStream: (async function* () {
            yield { type: "finish" };
          })(),
        }) as any,
    );

    await expect(async () => {
      for await (const event of doStreamCall(baseConfig, "openai", "gpt-4", [], {})) {
        // consume
      }
    }).toThrow();
  });

  test("text-delta prevents empty response error", async () => {
    _setStreamTextForTesting(
      () =>
        ({
          fullStream: (async function* () {
            yield { type: "text-delta", text: "hello" };
            yield { type: "finish" };
          })(),
        }) as any,
    );

    const events: any[] = [];
    for await (const event of doStreamCall(baseConfig, "openai", "gpt-4", [], {})) {
      events.push(event);
    }

    expect(events.some((e) => e.type === "text-delta")).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(true);
  });
});

// ─── P0-5: abortSignal 传播 ───────────────────────────────────

describe("doStreamCall — abortSignal 传播", () => {
  beforeEach(() => _resetStreamTextForTesting());
  afterEach(() => _resetStreamTextForTesting());

  test("底层 stream 抛 AbortError 时透传为流式取消错误", async () => {
    const controller = new AbortController();
    // 立即触发 abort，让 stream 内部抛 AbortError
    controller.abort("user-cancel");

    _setStreamTextForTesting(() => {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    });

    await expect(
      (async () => {
        for await (const _event of doStreamCall(baseConfig, "openai", "gpt-4", [], {
          abortSignal: controller.signal,
        })) {
          // consume
        }
      })(),
    ).rejects.toThrow();
  });

  test("流式超时触发时 AbortController 收到 abort 信号", async () => {
    let abortReceived = false;
    _setStreamTextForTesting((opts: { abortSignal?: AbortSignal }) => {
      // 模拟 SDK 监听 abortSignal
      opts.abortSignal?.addEventListener("abort", () => {
        abortReceived = true;
      });
      return {
        fullStream: (async function* () {
          await new Promise((resolve) => setTimeout(resolve, 200));
          yield { type: "text-delta", text: "should not reach" };
        })(),
      } as any;
    });

    // 触发 doStreamCall（使用短 timeout）
    // 异常被静默吞掉不重要——我们只断言 controller 被 abort
    try {
      for await (const _event of doStreamCall(baseConfig, "openai", "gpt-4", [], { timeout: 30 })) {
        // consume
      }
    } catch {
      // ignore
    }

    // 等待足够长以确保 setTimeout(30) 已触发
    await new Promise((r) => setTimeout(r, 100));
    expect(abortReceived).toBe(true);
  });
});

// ─── P1-18: tool-call 事件流 ───────────────────────────────────

describe("doStreamCall — tool-call 事件", () => {
  beforeEach(() => _resetStreamTextForTesting());
  afterEach(() => _resetStreamTextForTesting());

  test("工具调用事件透传", async () => {
    _setStreamTextForTesting(
      () =>
        ({
          fullStream: (async function* () {
            yield { type: "tool-call", toolCallId: "c1", toolName: "fs_read", input: { path: "a.txt" } };
            yield { type: "finish" };
          })(),
        }) as any,
    );

    const events: any[] = [];
    for await (const event of doStreamCall(baseConfig, "openai", "gpt-4", [], {})) {
      events.push(event);
    }

    const toolCall = events.find((e) => e.type === "tool-call");
    expect(toolCall).toBeDefined();
    expect(toolCall?.toolName).toBe("fs_read");
    expect(toolCall?.toolCallId).toBe("c1");
    expect(events.some((e) => e.type === "done")).toBe(true);
  });
});
