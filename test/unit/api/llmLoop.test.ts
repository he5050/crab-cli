/**
 * LLM 循环组件测试 - 修复版本
 *
 * 主要修复:
 * 1. 在测试中禁用死循环检测(设置很高的阈值)
 * 2. 修复 mock 流正确处理事件循环
 */
import { beforeEach, describe, expect, it } from "bun:test";
import {
  type LlmLoopCallbacks,
  type LlmLoopOptions,
  type ToolExecutor,
  executeLlmLoop,
} from "@/conversation/core/llmLoop";
import type { ModelMessage } from "ai";
import { DEFAULT_CONFIG } from "@/config";
import type { AppConfigSchema } from "@/schema/config";

// ─── Mock 工具执行器 ────────────────────────────────────────

class MockToolExecutor implements ToolExecutor {
  async execute(
    toolName: string,
    args: unknown,
    context: any,
  ): Promise<{ success: boolean; output: unknown; error?: string }> {
    // 模拟工具执行
    if (toolName === "failing_tool") {
      return {
        error: "Intentional failure for testing",
        output: "Tool execution failed",
        success: false,
      };
    }
    return {
      output: `Executed ${toolName} with args: ${JSON.stringify(args)}`,
      success: true,
    };
  }
}

// ─── Mock LLM Stream(修复事件处理)───────────────────────────────

function createMockStreamLlm() {
  let callCount = 0;

  return async function* mockStreamLlm(config: AppConfigSchema, messages: ModelMessage[], options: any) {
    callCount++;

    // 第一次调用:有工具调用
    if (callCount === 1) {
      yield { text: "Hello", type: "text-delta" as const };
      yield { text: " world", type: "text-delta" as const };

      yield {
        args: { query: "test" },
        toolCallId: "call_123",
        toolName: "test_tool",
        type: "tool-call" as const,
      };

      yield {
        fullText: "Hello world",
        type: "done" as const,
        usage: {
          completionTokens: 5,
          promptTokens: 10,
          totalTokens: 15,
        },
      };
    } else {
      // 后续调用:只有文本响应，无工具调用
      yield { text: "Task completed", type: "text-delta" as const };

      yield {
        fullText: "Task completed",
        type: "done" as const,
        usage: {
          completionTokens: 2,
          promptTokens: 5,
          totalTokens: 7,
        },
      };
    }
  };
}

function createMockStreamLlmWithMultipleTools() {
  let callCount = 0;

  return async function* mockStreamLlmWithMultipleTools(
    config: AppConfigSchema,
    messages: ModelMessage[],
    options: any,
  ) {
    callCount++;

    // 第一次调用:多个工具调用
    if (callCount === 1) {
      yield { text: "Processing", type: "text-delta" as const };

      // 多个工具调用
      yield {
        args: { action: "read" },
        toolCallId: "call_1",
        toolName: "tool1",
        type: "tool-call" as const,
      };

      yield {
        args: { action: "write" },
        toolCallId: "call_2",
        toolName: "tool2",
        type: "tool-call" as const,
      };

      yield {
        fullText: "Processing",
        type: "done" as const,
        usage: {
          completionTokens: 10,
          promptTokens: 20,
          totalTokens: 30,
        },
      };
    } else {
      // 后续调用:只有文本响应
      yield { text: "Done", type: "text-delta" as const };

      yield {
        fullText: "Done",
        type: "done" as const,
        usage: {
          completionTokens: 2,
          promptTokens: 5,
          totalTokens: 7,
        },
      };
    }
  };
}

async function* mockStreamLlmWithError(config: AppConfigSchema, messages: ModelMessage[], options: any) {
  yield { text: "Starting", type: "text-delta" as const };
  yield {
    error: new Error("Simulated LLM error"),
    type: "error" as const,
  };
}

async function* mockInfiniteStream(config: AppConfigSchema, messages: ModelMessage[], options: any) {
  // 每轮调用一个工具，模拟无限循环
  const roundCount = (options.roundCount || 0) + 1;
  yield { text: `Round ${roundCount}`, type: "text-delta" as const };
  yield {
    args: { round: roundCount }, // 每次参数不同，避免死循环检测
    toolCallId: `call_${roundCount}`,
    toolName: "continue_tool",
    type: "tool-call" as const,
  };
  yield {
    fullText: `Round ${roundCount}`,
    type: "done" as const,
    usage: { completionTokens: 2, promptTokens: 5, totalTokens: 7 },
  };
}

async function* mockThrownErrorStream(config: AppConfigSchema, messages: ModelMessage[], options: any) {
  yield { text: "before crash", type: "text-delta" as const };
  throw new Error("Thrown stream error");
}

// ─── 测试 ─────────────────────────────────────────────────────

describe("LLM 循环组件", () => {
  let messages: ModelMessage[];
  let config: AppConfigSchema;

  beforeEach(() => {
    messages = [{ content: "Test prompt", role: "user" }];
    config = DEFAULT_CONFIG;
  });

  it("应该执行基本循环并返回结果", async () => {
    const toolExecutor = new MockToolExecutor();
    const callbacks: LlmLoopCallbacks = {
      onTextDelta: (text) => {
        expect(typeof text).toBe("string");
      },
      onToolCall: (call) => {
        expect(call.toolName).toBe("test_tool");
      },
    };

    const loopOptions: LlmLoopOptions = {
      doomLoopThreshold: 100, // 禁用死循环检测
      maxRounds: 5,
      streamFn: createMockStreamLlm(),
    };

    const result = await executeLlmLoop(messages, loopOptions, toolExecutor, callbacks, config);

    expect(result.ok).toBe(true);
    expect(result.text).toBe("Task completed");
    expect(result.hadToolCalls).toBe(true);
    expect(result.toolRounds).toBe(1);
    expect(result.usage?.inputTokens).toBe(15); // 第一轮10 + 第二轮5 = 15
    expect(result.usage?.outputTokens).toBe(7); // 第一轮5 + 第二轮2 = 7
  });

  it("应该累加多轮 cache usage", async () => {
    const toolExecutor = new MockToolExecutor();
    let callCount = 0;
    const streamFn = async function* streamFn() {
      callCount++;
      if (callCount === 1) {
        yield { args: {}, toolCallId: "cache_1", toolName: "test_tool", type: "tool-call" as const };
        yield {
          fullText: "",
          type: "done" as const,
          usage: {
            cacheCreationInputTokens: 20,
            cacheReadInputTokens: 60,
            cachedTokens: 60,
            completionTokens: 10,
            promptTokens: 100,
            totalTokens: 110,
          },
        };
        return;
      }
      yield { text: "done", type: "text-delta" as const };
      yield {
        fullText: "done",
        type: "done" as const,
        usage: {
          cacheCreationInputTokens: 10,
          cacheReadInputTokens: 50,
          cachedTokens: 50,
          completionTokens: 5,
          promptTokens: 80,
          totalTokens: 85,
        },
      };
    };

    const result = await executeLlmLoop(
      messages,
      { doomLoopThreshold: 100, maxRounds: 5, streamFn },
      toolExecutor,
      {},
      config,
    );

    expect(result.ok).toBe(true);
    expect(result.usage).toEqual({
      cacheCreationInputTokens: 30,
      cacheReadInputTokens: 110,
      cachedTokens: 110,
      inputTokens: 180,
      outputTokens: 15,
    });
  });

  it("应该正确处理多个工具调用", async () => {
    const toolExecutor = new MockToolExecutor();
    const toolCalls: any[] = [];

    const callbacks: LlmLoopCallbacks = {
      onToolCall: (call) => {
        toolCalls.push(call);
      },
    };

    const loopOptions: LlmLoopOptions = {
      doomLoopThreshold: 100,
      maxRounds: 5,
      streamFn: createMockStreamLlmWithMultipleTools(),
    };

    const result = await executeLlmLoop(messages, loopOptions, toolExecutor, callbacks, config);

    expect(result.ok).toBe(true);
    expect(result.hadToolCalls).toBe(true);
    expect(toolCalls.length).toBe(2);
    expect(toolCalls[0]?.toolName).toBe("tool1");
    expect(toolCalls[1]?.toolName).toBe("tool2");
  });

  it("每轮请求前应该重新读取动态工具 schema", async () => {
    const toolExecutor = new MockToolExecutor();
    const toolsByRound: (Record<string, unknown> | undefined)[] = [];
    let schemaVersion = 0;

    const streamFn = async function* streamFn(_config: AppConfigSchema, _messages: ModelMessage[], options: any) {
      toolsByRound.push(options.tools);
      if (toolsByRound.length === 1) {
        schemaVersion = 1;
        yield {
          args: {},
          toolCallId: "enable-1",
          toolName: "enable_tool",
          type: "tool-call" as const,
        };
        yield { fullText: "", type: "done" as const };
        return;
      }

      yield { text: "done", type: "text-delta" as const };
      yield { fullText: "done", type: "done" as const };
    };

    const result = await executeLlmLoop(
      messages,
      {
        doomLoopThreshold: 100,
        getTools: () => {
          const tools: Record<string, any> = { "tool-search": {} as any };
          if (schemaVersion !== 0) {
            tools.enable_tool = {} as any;
          }
          return tools;
        },
        maxRounds: 2,
        streamFn,
      },
      toolExecutor,
      {},
      config,
    );

    expect(result.ok).toBe(true);
    expect(toolsByRound[0]?.["enable_tool"]).toBeUndefined();
    expect(toolsByRound[1]?.["enable_tool"]).toBeDefined();
  });

  it("应该处理 LLM 错误并返回失败结果", async () => {
    const toolExecutor = new MockToolExecutor();
    const callbacks: LlmLoopCallbacks = {};

    const loopOptions: LlmLoopOptions = {
      maxRounds: 5,
      streamFn: mockStreamLlmWithError,
    };

    const result = await executeLlmLoop(messages, loopOptions, toolExecutor, callbacks, config);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Simulated LLM error");
  });

  it("stream 抛异常时 onError 只回调一次", async () => {
    const toolExecutor = new MockToolExecutor();
    const received: string[] = [];

    const result = await executeLlmLoop(
      messages,
      {
        maxRounds: 5,
        streamFn: mockThrownErrorStream,
      },
      toolExecutor,
      {
        onError: (error) => {
          received.push(error.message);
        },
      },
      config,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Thrown stream error");
    expect(received).toEqual(["Thrown stream error"]);
  });

  it("应该限制最大轮次", async () => {
    const toolExecutor = new MockToolExecutor();
    const callbacks: LlmLoopCallbacks = {};

    const loopOptions: LlmLoopOptions = {
      doomLoopThreshold: 100,
      maxRounds: 3,
      streamFn: mockInfiniteStream,
    };

    const result = await executeLlmLoop(messages, loopOptions, toolExecutor, callbacks, config);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("达到最大工具调用轮次");
    expect(result.toolRounds).toBe(3);
  });
});
