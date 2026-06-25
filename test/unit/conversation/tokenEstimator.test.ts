/**
 * Token 估算器测试。
 *
 * 测试用例:
 *   - Token 计数
 *   - 成本估算
 *   - 限制检查
 */
import { describe, expect, test } from "bun:test";
import type { ModelMessage } from "ai";
import { estimateMessagesTokens, estimateTokens } from "@/compress/conversation";

// ─── estimateTokens ────────────────────────────────────────────

describe("estimateTokens", () => {
  test("空字符串返回 0", () => {
    expect(estimateTokens("")).toBe(0);
  });

  test("纯英文文本估算", () => {
    // 英文每 4 字符 ≈ 1 token
    const text = "Hello World"; // 11 字符
    const result = estimateTokens(text);
    expect(result).toBe(Math.ceil(11 / 4)); // 3
  });

  test("纯中文文本估算", () => {
    // CJK 每字符 ≈ 1.5 token
    const text = "你好世界"; // 4 字符
    const result = estimateTokens(text);
    expect(result).toBe(Math.ceil(4 * 1.5)); // 6
  });

  test("中英文混合文本估算", () => {
    const text = "Hello 你好"; // 英文 6 字符 + 中文 2 字符
    const result = estimateTokens(text);
    const expected = Math.ceil(6 / 4 + 2 * 1.5); // 2 + 3 = 5
    expect(result).toBe(expected);
  });

  test("日文假名估算", () => {
    // 日文假名属于 CJK 范围
    const text = "こんにちは"; // 5 假名
    const result = estimateTokens(text);
    expect(result).toBe(Math.ceil(5 * 1.5)); // 8
  });

  test("韩文估算", () => {
    // 韩文属于 CJK 范围
    const text = "안녕하세요"; // 5 字符
    const result = estimateTokens(text);
    expect(result).toBe(Math.ceil(5 * 1.5)); // 8
  });

  test("数字和标点符号估算", () => {
    // 数字和标点属于非 CJK
    const text = "12345!!!"; // 8 字符
    const result = estimateTokens(text);
    expect(result).toBe(Math.ceil(8 / 4)); // 2
  });

  test("长文本估算", () => {
    const text = "a".repeat(1000);
    const result = estimateTokens(text);
    expect(result).toBe(Math.ceil(1000 / 4)); // 250
  });

  test("纯 CJK 标点符号", () => {
    // 6 个 CJK 标点 + 2 个 ASCII 括号
    const text = "「」『』()【】"; // 8 个字符
    const result = estimateTokens(text);
    // 6 CJK * 1.5 + 2 other / 4 = 9 + 0.5 = 9.5 -> ceil = 10
    expect(result).toBe(Math.ceil(6 * 1.5 + 2 / 4)); // 10
  });
});

// ─── estimateMessagesTokens ────────────────────────────────────

describe("estimateMessagesTokens", () => {
  test("空数组返回 0", () => {
    expect(estimateMessagesTokens([])).toBe(0);
  });

  test("单条字符串内容消息", () => {
    const messages: ModelMessage[] = [{ content: "Hello", role: "user" }];
    const result = estimateMessagesTokens(messages);
    // Role 开销 4 + 文本 token
    expect(result).toBe(4 + estimateTokens("Hello"));
  });

  test("多条消息累加", () => {
    const messages: ModelMessage[] = [
      { content: "System", role: "system" },
      { content: "Hello", role: "user" },
      { content: "Hi there", role: "assistant" },
    ];
    const result = estimateMessagesTokens(messages);
    const expected =
      4 * 3 + // 3 条消息的 role 开销
      estimateTokens("System") +
      estimateTokens("Hello") +
      estimateTokens("Hi there");
    expect(result).toBe(expected);
  });

  test("数组内容消息(多 parts)", () => {
    const messages: ModelMessage[] = [
      {
        content: [
          { text: "Let me help", type: "text" },
          { input: { path: "/test.txt" }, toolCallId: "c1", toolName: "fs_read", type: "tool-call" },
        ],
        role: "assistant",
      },
    ];
    const result = estimateMessagesTokens(messages);
    // Role 开销 + 文本 + 工具调用参数 JSON
    expect(result).toBeGreaterThan(4);
  });

  test("工具调用 token 估算", () => {
    const messages: ModelMessage[] = [
      {
        content: [
          {
            input: { cmd: "ls -la" },
            toolCallId: "c1",
            toolName: "bash",
            type: "tool-call",
          },
        ],
        role: "assistant",
      },
    ];
    const result = estimateMessagesTokens(messages);
    // Role 开销 + 工具名 + 参数 JSON
    expect(result).toBeGreaterThan(4);
  });

  test("工具结果 token 估算", () => {
    const messages: ModelMessage[] = [
      {
        content: "file content here",
        role: "tool",
        toolCallId: "c1",
      } as any,
    ];
    const result = estimateMessagesTokens(messages);
    // Role 开销 + 结果文本
    expect(result).toBe(4 + estimateTokens("file content here"));
  });

  test("工具结果对象输出估算", () => {
    const messages: ModelMessage[] = [
      {
        content: [
          {
            output: { data: [1, 2, 3], key: "value" },
            toolCallId: "c1",
            toolName: "json_tool",
            type: "tool-result",
          },
        ],
        role: "tool",
      } as any,
    ];
    const result = estimateMessagesTokens(messages);
    // Role 开销 + 工具名 + 输出 JSON
    expect(result).toBeGreaterThan(4);
  });

  test("混合文本和工具调用", () => {
    const messages: ModelMessage[] = [
      {
        content: [
          { text: "I will read the file", type: "text" },
          { input: { path: "/test.txt" }, toolCallId: "c1", toolName: "fs_read", type: "tool-call" },
        ],
        role: "assistant",
      },
      {
        content: "file content",
        role: "tool",
        toolCallId: "c1",
      } as any,
      {
        content: "Here is the content",
        role: "assistant",
      },
    ];
    const result = estimateMessagesTokens(messages);
    expect(result).toBeGreaterThan(12); // 至少 3 条消息的 role 开销
  });

  test("包含 reasoning/thinking 内容", () => {
    const messages: ModelMessage[] = [
      {
        content: [
          { text: "Let me think step by step...", type: "reasoning" },
          { text: "The answer is 42", type: "text" },
        ],
        role: "assistant",
      },
    ];
    const result = estimateMessagesTokens(messages);
    // Role 开销 + reasoning 文本 + 回答文本
    expect(result).toBeGreaterThan(4);
  });

  test("长对话 token 估算", () => {
    const messages: ModelMessage[] = Array.from({ length: 10 }, (_, i) => ({
      content: `Message ${i}`,
      role: i % 2 === 0 ? "user" : "assistant",
    })) as ModelMessage[];

    const result = estimateMessagesTokens(messages);
    const expected = 10 * 4 + messages.reduce((sum, m) => sum + estimateTokens(m.content as string), 0);
    expect(result).toBe(expected);
  });

  test("null/undefined content 处理", () => {
    const messages: ModelMessage[] = [
      { content: [{ text: null as any, type: "text" }], role: "assistant" },
      { content: [{ type: "text" }], role: "assistant" },
    ] as any;

    // 不应抛出错误
    const result = estimateMessagesTokens(messages);
    expect(result).toBeGreaterThanOrEqual(8); // 至少 role 开销
  });
});

// ─── 边界情况 ───────────────────────────────────────────────────

describe("TokenEstimator 边界情况", () => {
  test("特殊字符估算", () => {
    const text = "🎉🎊🎁"; // Emoji
    const result = estimateTokens(text);
    // Emoji 通常被视为非 CJK
    expect(result).toBeGreaterThanOrEqual(0);
  });

  test("换行和空白字符", () => {
    const text = "Line 1\nLine 2\n\nLine 3";
    const result = estimateTokens(text);
    expect(result).toBe(Math.ceil(text.length / 4));
  });

  test("全角英文字符", () => {
    // 全角字符属于 Fullwidth Forms 范围
    const text = "Ｈｅｌｌｏ"; // 5 个全角字符
    const result = estimateTokens(text);
    expect(result).toBe(Math.ceil(5 * 1.5)); // 8
  });
});
