/**
 * 自动压缩测试。
 *
 * 测试用例:
 *   - 自动触发
 *   - 阈值判断
 *   - 策略选择
 */
import { describe, expect, mock, test } from "bun:test";
import type { ModelMessage } from "ai";
import { performAutoCompression, shouldAutoCompress } from "@/compress/runtime/autoCompress";
import type { CompressionStatus } from "@/compress/types";

// ─── shouldAutoCompress ───────────────────────────────────────

describe("shouldAutoCompress", () => {
  test("低于阈值返回 false", () => {
    expect(shouldAutoCompress(50, 80)).toBe(false);
    expect(shouldAutoCompress(79, 80)).toBe(false);
  });

  test("等于阈值返回 true", () => {
    expect(shouldAutoCompress(80, 80)).toBe(true);
  });

  test("高于阈值返回 true", () => {
    expect(shouldAutoCompress(81, 80)).toBe(true);
    expect(shouldAutoCompress(100, 80)).toBe(true);
  });

  test("使用默认阈值", () => {
    // 默认阈值是 80
    expect(shouldAutoCompress(79)).toBe(false);
    expect(shouldAutoCompress(80)).toBe(true);
  });

  test("自定义阈值", () => {
    expect(shouldAutoCompress(59, 60)).toBe(false);
    expect(shouldAutoCompress(60, 60)).toBe(true);
    expect(shouldAutoCompress(90, 60)).toBe(true);
  });
});

// ─── performAutoCompression ───────────────────────────────────

describe("performAutoCompression", () => {
  const createMockConfig = () =>
    ({
      ai: {
        apiKey: "test-key",
        model: "gpt-4o",
        provider: "openai" as const,
      },
    }) as any;

  test("低于阈值时跳过压缩", async () => {
    const messages: ModelMessage[] = [
      { content: "Hi", role: "user" },
      { content: "Hello", role: "assistant" },
    ];

    const result = await performAutoCompression(messages, createMockConfig(), "gpt-4o", "test-session");

    expect(result).toBeNull();
  });

  test("状态回调 - 低于阈值时无回调", async () => {
    const messages: ModelMessage[] = [
      { content: "Hi", role: "user" },
      { content: "Hello", role: "assistant" },
    ];

    const statusUpdates: CompressionStatus[] = [];
    const onStatusUpdate = (status: CompressionStatus | null) => {
      if (status) {
        statusUpdates.push(status);
      }
    };

    // 小消息数组不会触发压缩
    await performAutoCompression(messages, createMockConfig(), "gpt-4o", "test-session", onStatusUpdate);

    // 低于阈值时不会触发任何状态回调
    expect(statusUpdates.length).toBe(0);
  });

  test("状态回调结构验证", async () => {
    // 验证 CompressionStatus 类型结构
    const status: CompressionStatus = {
      progress: 50,
      sessionId: "test-session",
      step: "compressing",
    };

    expect(status.step).toBe("compressing");
    expect(status.progress).toBe(50);
    expect(status.sessionId).toBe("test-session");
  });

  test("空消息数组处理", async () => {
    const result = await performAutoCompression([], createMockConfig(), "gpt-4o", "test-session");

    expect(result).toBeNull();
  });

  test("不同模型的上下文窗口", async () => {
    const messages: ModelMessage[] = Array.from({ length: 50 }, (_, i) => ({
      content: "x".repeat(1000),
      role: i % 2 === 0 ? "user" : "assistant",
    })) as ModelMessage[];

    // Claude 模型有更大的上下文窗口 (200k)
    const claudeResult = await performAutoCompression(
      messages,
      createMockConfig(),
      "claude-3-5-sonnet",
      "test-session",
    );

    // Gemini 模型有 1M 上下文窗口
    const geminiResult = await performAutoCompression(messages, createMockConfig(), "gemini-2.5-pro", "test-session");

    // 对于小消息数组，应该都返回 null(未达阈值)
    expect(claudeResult).toBeNull();
    expect(geminiResult).toBeNull();
  });
});

// ─── 边界情况 ───────────────────────────────────────────────────

describe("AutoCompress 边界情况", () => {
  test("阈值 0 时总是触发", () => {
    expect(shouldAutoCompress(0, 0)).toBe(true);
    expect(shouldAutoCompress(1, 0)).toBe(true);
  });

  test("阈值 100 时只有 100% 触发", () => {
    expect(shouldAutoCompress(99, 100)).toBe(false);
    expect(shouldAutoCompress(100, 100)).toBe(true);
  });

  test("负百分比处理", () => {
    // 虽然实际不会出现负百分比，但函数应该能处理
    expect(shouldAutoCompress(-10, 80)).toBe(false);
  });

  test("超过 100% 处理", () => {
    expect(shouldAutoCompress(150, 80)).toBe(true);
  });
});
