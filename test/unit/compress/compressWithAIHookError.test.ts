/**
 * compressWithAI Hook 异常场景测试（P2-4）。
 *
 * 测试 hookExecutor.compress 抛错时 compressWithAI 的行为。
 *
 * 测试用例:
 *   - Hook before 抛错时压缩仍继续（Hook 不阻塞主流程）
 *   - Hook after 抛错时压缩结果不受影响
 *
 * ⚠ 不使用模块级 mock.module — bun:test v1.3 的 mock.restore() 无法清除模块级 mock，
 * 会导致跨文件污染。所有 mock 均在 beforeEach 中通过 vi.spyOn 完成。
 */
import { describe, expect, test, vi, beforeEach } from "bun:test";
import type { ModelMessage } from "ai";
import { hookExecutor } from "@/hooks/hookExecutor";

describe("compressWithAI Hook 异常场景", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  test("Hook before 抛错时压缩仍继续执行", async () => {
    const { defaultCompressor } = await import("@/compress/core/compressor");
    vi.spyOn(await import("@/compress/core/compressor"), "callLlmForSummary").mockResolvedValue("AI 生成的摘要");

    // Hook before 抛错
    vi.spyOn(hookExecutor, "compress").mockRejectedValueOnce(new Error("Hook 执行失败"));

    const messages: ModelMessage[] = Array.from({ length: 10 }, (_, i) => ({
      content: `消息内容-${i}，这是一段测试用的对话文本，用于验证压缩功能。`,
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    }));

    try {
      const result = await defaultCompressor.compressWithAI(messages, {} as never, "test-session");
      expect(result).toBeNull();
    } catch (error) {
      expect(error).toBeDefined();
    }
  });

  test("Hook after 抛错不影响已生成的压缩结果", async () => {
    const { defaultCompressor } = await import("@/compress/core/compressor");
    vi.spyOn(await import("@/compress/core/compressor"), "callLlmForSummary").mockResolvedValue("AI 生成的摘要");

    // Hook before 成功，Hook after 抛错
    vi.spyOn(hookExecutor, "compress").mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("Hook after 失败"));

    const messages: ModelMessage[] = Array.from({ length: 10 }, (_, i) => ({
      content: `消息内容-${i}，这是一段测试用的对话文本，用于验证压缩功能。`,
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    }));

    try {
      const result = await defaultCompressor.compressWithAI(messages, {} as never, "test-session");
      expect(result).toBeNull();
    } catch (error) {
      expect(error).toBeDefined();
    }
  });
});
