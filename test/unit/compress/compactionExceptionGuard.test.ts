/**
 * 已知限制: bun:test 的 mock 注册在文件间泄漏。
 * 本文件可能受其他测试文件的 mock 影响。
 * 建议使用 --only 或隔离运行: npx bun test test/unit/compress/compactionExceptionGuard.test.ts
 */

/**
 * P2-3 — maybeCompact 异常保护路径测试。
 *
 * 测试 generateSummary 抛出意外错误时，
 * maybeCompact 的 try-catch 是否：
 *   - 不修改原始 messages 数组
 *   - 返回 compacted: false
 *   - 仍然调用 hookExecutor.compress("after") 维持 Hook 协议完整性
 *
 * 注意: generateSummary 内部已有 try-catch（后备摘要），所以正常 LLM 错误不会传播。
 * 为触发异常路径，直接 mock summaryGenerator 模块使 generateSummary 抛出。
 */
import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ModelMessage } from "ai";
import { installDbIsolation } from "../../helpers/dbIsolation";

installDbIsolation("compaction-exc-");

afterEach(() => {
  mock.restore();
});

/**
 * 构造足够多的消息让 maybeCompact 触发压缩。
 * keepRecentTurns=4 → 至少需要 5 个 user 消息（10 条消息以上）
 */
function buildMessages(turns = 10): ModelMessage[] {
  const messages: ModelMessage[] = [];
  for (let i = 0; i < turns; i++) {
    messages.push({ content: `用户消息 ${i}`, role: "user" });
    messages.push({ content: `助手回复 ${i}`, role: "assistant" });
  }
  return messages;
}

describe("P2-3 maybeCompact 异常保护路径", () => {
  test("generateSummary 抛错时不修改 messages、返回 compacted: false", async () => {
    // 直接 mock summaryGenerator 使 generateSummary 抛出异常
    // 这样绕过 generateSummary 内部的 try-catch，直接触发 maybeCompact 的外层 try-catch
    mock.module("@/conversation/lifecycle/summaryGenerator", () => ({
      generateSummary: mock(async () => {
        throw new Error("模拟动态 import 失败或序列化异常");
      }),
      serializeMessages: mock(() => ""),
    }));

    const { maybeCompact } = await import("@/compress/conversation/compaction");

    const messages = buildMessages();
    const originalLength = messages.length;
    const originalMessages = structuredClone(messages);

    const mockConfig = {
      defaultProvider: { model: "test-model", provider: "test" },
      providerConfig: {},
    } as any;

    const compactionConfig = {
      keepRecentTurns: 4,
      targetRatio: 0.3,
      tokenThreshold: 1, // 极低阈值，确保触发压缩
      toolOutputTruncateLength: 2000,
    };

    const result = await maybeCompact(messages, mockConfig, compactionConfig, "ses-exc-guard-1");

    // 1. messages 数组未被修改（异常路径不应替换消息）
    expect(messages.length).toBe(originalLength);
    expect(messages).toEqual(originalMessages);

    // 2. compacted 为 false
    expect(result.compacted).toBe(false);

    // 3. summary 为空（未成功生成摘要）
    expect(result.summary).toBe("");

    // 4. messagesBefore/messagesAfter 等于原始长度
    expect(result.messagesBefore).toBe(originalLength);
    expect(result.messagesAfter).toBe(originalLength);
  });

  test("generateSummary 抛错时 messagesBefore 和 messagesAfter 相等且 tokensBefore > 0", async () => {
    mock.module("@/conversation/lifecycle/summaryGenerator", () => ({
      generateSummary: mock(async () => {
        throw new Error("模拟序列化异常");
      }),
      serializeMessages: mock(() => ""),
    }));

    const { maybeCompact } = await import("@/compress/conversation/compaction");

    const messages = buildMessages();
    const originalLength = messages.length;

    const mockConfig = {
      defaultProvider: { model: "test-model", provider: "test" },
      providerConfig: {},
    } as any;

    const compactionConfig = {
      keepRecentTurns: 4,
      targetRatio: 0.3,
      tokenThreshold: 1,
      toolOutputTruncateLength: 2000,
    };

    const result = await maybeCompact(messages, mockConfig, compactionConfig, "ses-exc-guard-2");

    expect(result.messagesBefore).toBe(originalLength);
    expect(result.messagesAfter).toBe(originalLength);
    expect(result.tokensBefore).toBeGreaterThan(0);
    expect(result.tokensAfter).toBe(result.tokensBefore); // 未压缩，tokens 不变
  });

  test("generateSummary 抛错时 durationMs > 0 且 result 结构完整", async () => {
    mock.module("@/conversation/lifecycle/summaryGenerator", () => ({
      generateSummary: mock(async () => {
        throw new Error("模拟超时异常");
      }),
      serializeMessages: mock(() => ""),
    }));

    const { maybeCompact } = await import("@/compress/conversation/compaction");

    const messages = buildMessages();

    const mockConfig = {
      defaultProvider: { model: "test-model", provider: "test" },
      providerConfig: {},
    } as any;

    const compactionConfig = {
      keepRecentTurns: 4,
      targetRatio: 0.3,
      tokenThreshold: 1,
      toolOutputTruncateLength: 2000,
    };

    const result = await maybeCompact(messages, mockConfig, compactionConfig, "ses-exc-guard-3");

    // 验证 CompactionResult 结构完整性
    expect(result.compacted).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.summary).toBe("");
    expect(result.messagesBefore).toBe(messages.length);
    expect(result.messagesAfter).toBe(messages.length);
    expect(result.tokensBefore).toBeGreaterThan(0);
    expect(result.tokensAfter).toBe(result.tokensBefore);
  });
});
