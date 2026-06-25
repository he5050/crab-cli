/**
 * 混合压缩测试。
 *
 * 测试用例:
 *   - 多算法组合
 *   - 自适应选择
 *   - 性能优化
 */
import { afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { ModelMessage } from "ai";
import { performHybridCompression } from "@/compress/strategies/hybridCompress";
import { defaultCompressor } from "@/compress/core/compressor";
import type { AppConfigSchema } from "@/schema/config";
import { buildDerivedProviderConfig } from "../../helpers/realConfig";

let REAL_CONFIG: AppConfigSchema;
let compressWithAiSpy: any;

const createTestConfig = () => structuredClone(REAL_CONFIG);

beforeAll(async () => {
  REAL_CONFIG = await buildDerivedProviderConfig({
    model: "compress-model",
    providerId: "compress-test",
    requestMethod: "chat",
  });
});

beforeEach(() => {
  compressWithAiSpy = spyOn(defaultCompressor, "compressWithAI").mockResolvedValue(null);
});

afterEach(() => {
  mock.restore();
});

describe("performHybridCompression", () => {
  test("空消息数组处理", async () => {
    const messages: ModelMessage[] = [];
    const result = await performHybridCompression(messages, createTestConfig());

    expect(result.compressed).toBe(true);
    expect(result.messages).toEqual([]);
  });

  test("AI 摘要成功路径", async () => {
    compressWithAiSpy.mockResolvedValue({
      compressedTokens: 5,
      compressionRatio: 0.5,
      messagesRemoved: 1,
      originalTokens: 10,
      summary: "compressed",
    } as any);

    const messages: ModelMessage[] = [
      { content: "Hello", role: "user" },
      { content: "Hi there", role: "assistant" },
    ];

    const result = await performHybridCompression(messages, createTestConfig());
    expect(result.compressed).toBe(true);
    expect(result.messages).toBe(messages);
  });

  test("小消息数组处理", async () => {
    const messages: ModelMessage[] = [
      { content: "Hello", role: "user" },
      { content: "Hi there", role: "assistant" },
    ];

    const result = await performHybridCompression(messages, createTestConfig());

    expect(result.compressed).toBe(true);
    expect(result.messages.length).toBeGreaterThanOrEqual(0);
  });

  test("包含工具调用的消息", async () => {
    const messages: ModelMessage[] = [
      { content: "List files", role: "user" },
      {
        content: [{ input: { cmd: "ls" }, toolCallId: "c1", toolName: "bash", type: "tool-call" }],
        role: "assistant",
      },
      { content: "file1\nfile2", role: "tool", toolCallId: "c1" } as any,
      { content: "Here are the files", role: "assistant" },
    ];

    const result = await performHybridCompression(messages, createTestConfig());

    expect(result.compressed).toBe(true);
    expect(result.beforeTokens).toBeDefined();
    expect(result.afterTokensEstimate).toBeDefined();
  });

  test("大型工具输出触发截断", async () => {
    const longOutput = "x".repeat(10_000);
    const messages: ModelMessage[] = [
      { content: "Read file", role: "user" },
      {
        content: [{ input: { path: "/test" }, toolCallId: "c1", toolName: "read", type: "tool-call" }],
        role: "assistant",
      },
      {
        content: [{ output: longOutput, toolCallId: "c1", toolName: "read", type: "tool-result" }],
        role: "tool",
      } as any,
    ];

    const result = await performHybridCompression(messages, createTestConfig(), {
      toolOutputTruncateLength: 1000,
    });

    expect(result.compressed).toBe(true);
    expect(result.beforeTokens).toBeGreaterThan(0);
  });

  test("自定义 keepRounds 参数", async () => {
    const messages: ModelMessage[] = [
      { content: "First", role: "user" },
      {
        content: [{ input: { cmd: "ls" }, toolCallId: "c1", toolName: "bash", type: "tool-call" }],
        role: "assistant",
      },
      { content: "output1", role: "tool", toolCallId: "c1" } as any,
      { content: "Second", role: "user" },
      {
        content: [{ input: { path: "/test" }, toolCallId: "c2", toolName: "read", type: "tool-call" }],
        role: "assistant",
      },
      { content: "output2", role: "tool", toolCallId: "c2" } as any,
    ];

    const result = await performHybridCompression(messages, createTestConfig(), {}, 1);

    expect(result.compressed).toBe(true);
  });

  test("自定义配置", async () => {
    const messages: ModelMessage[] = [
      { content: "Hello", role: "user" },
      { content: "Hi", role: "assistant" },
    ];

    const result = await performHybridCompression(messages, createTestConfig(), {
      keepRecentTurns: 2,
      toolOutputTruncateLength: 500,
    });

    expect(result.compressed).toBe(true);
  });

  test("多轮工具调用", async () => {
    const messages: ModelMessage[] = [
      { content: "Task 1", role: "user" },
      {
        content: [{ input: { cmd: "pwd" }, toolCallId: "c1", toolName: "bash", type: "tool-call" }],
        role: "assistant",
      },
      { content: "/home/user", role: "tool", toolCallId: "c1" } as any,
      { content: "Now task 2", role: "assistant" },
      {
        content: [{ input: { path: "/test" }, toolCallId: "c2", toolName: "read", type: "tool-call" }],
        role: "assistant",
      },
      { content: "content", role: "tool", toolCallId: "c2" } as any,
    ];

    const result = await performHybridCompression(messages, createTestConfig());

    expect(result.compressed).toBe(true);
    expect(result.messages).toBeDefined();
  });

  test("返回结果包含压缩前后 token 估算", async () => {
    const messages: ModelMessage[] = [
      { content: "Hello world this is a test message", role: "user" },
      { content: "This is a response message", role: "assistant" },
    ];

    const result = await performHybridCompression(messages, createTestConfig());

    expect(result.compressed).toBe(true);
    expect(typeof result.beforeTokens).toBe("number");
    expect(typeof result.afterTokensEstimate).toBe("number");
  });

  test("消息数组被就地修改", async () => {
    const messages: ModelMessage[] = [
      { content: "Hello", role: "user" },
      { content: "Hi", role: "assistant" },
    ];
    const originalLength = messages.length;

    const result = await performHybridCompression(messages, createTestConfig());

    // 结果中的 messages 应该与传入的是同一个数组引用
    expect(result.messages).toBe(messages);
  });
});

// ─── 边界情况 ───────────────────────────────────────────────────

describe("HybridCompress 边界情况", () => {
  test("单条消息处理", async () => {
    const messages: ModelMessage[] = [{ content: "Hello", role: "user" }];

    const result = await performHybridCompression(messages, createTestConfig());

    expect(result.compressed).toBe(true);
  });

  test("大量消息处理", async () => {
    const messages: ModelMessage[] = Array.from({ length: 100 }, (_, i) => ({
      content: `Message ${i}`,
      role: i % 2 === 0 ? "user" : "assistant",
    })) as ModelMessage[];

    const result = await performHybridCompression(messages, createTestConfig());

    expect(result.compressed).toBe(true);
  });

  test("包含空内容的消息", async () => {
    const messages: ModelMessage[] = [
      { content: "", role: "user" },
      { content: "", role: "assistant" },
    ];

    const result = await performHybridCompression(messages, createTestConfig());

    expect(result.compressed).toBe(true);
  });

  test("超长消息内容", async () => {
    const longContent = "x".repeat(50_000);
    const messages: ModelMessage[] = [
      { content: longContent, role: "user" },
      { content: "Response", role: "assistant" },
    ];

    const result = await performHybridCompression(messages, createTestConfig());

    expect(result.compressed).toBe(true);
    expect(result.beforeTokens).toBeGreaterThan(0);
  });
});
