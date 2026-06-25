/**
 * compressWithAI 关键路径测试。
 *
 * 测试用例:
 *   - 空消息返回 null
 *   - 所有消息需保留时返回 null
 *   - Hook compress 前后调用
 *
 * 注: compressWithAI 的完整路径（AI 摘要/截断回退）已在
 * compressor.test.ts 中覆盖。此文件仅测试边界行为。
 *
 * ⚠ 不使用模块级 vi.mock — bun:test v1.3 的 mock.restore() 无法清除模块级 mock，
 * 会导致跨文件污染。所有 mock 均在 beforeEach 中通过 vi.spyOn 完成。
 */
import { describe, expect, test, vi, beforeEach } from "bun:test";
import type { ModelMessage } from "ai";
import { hookExecutor } from "@/hooks/hookExecutor";

const mockCallLlmForSummary = vi.fn().mockResolvedValue("AI 生成的摘要");

describe("Compressor.compressWithAI 边界行为", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallLlmForSummary.mockResolvedValue("AI 生成的摘要");
  });

  test("空消息返回 null", async () => {
    const { defaultCompressor } = await import("@/compress/core/compressor");
    const result = await defaultCompressor.compressWithAI([], {} as never);
    expect(result).toBeNull();
    expect(mockCallLlmForSummary).not.toHaveBeenCalled();
  });

  test("传入 sessionId 时触发 Hook", async () => {
    const spyCompress = vi.spyOn(hookExecutor, "compress").mockResolvedValue([]);
    const compressorModule = await import("@/compress/core/compressor");
    vi.spyOn(compressorModule, "callLlmForSummary").mockResolvedValue("AI 生成的摘要");

    const messages: ModelMessage[] = Array.from({ length: 10 }, (_, i) => ({
      content: `msg-${i}`,
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    }));

    const result = await compressorModule.defaultCompressor.compressWithAI(messages, {} as never, "test-session");

    expect(result).not.toBeNull();
    expect(spyCompress).toHaveBeenCalledWith("test-session", "before", expect.any(Number));
    expect(spyCompress).toHaveBeenCalledWith("test-session", "after", expect.any(Number));
  });

  test("未传 sessionId 时 Hook 使用空字符串", async () => {
    const spyCompress = vi.spyOn(hookExecutor, "compress").mockResolvedValue([]);
    const compressorModule = await import("@/compress/core/compressor");
    vi.spyOn(compressorModule, "callLlmForSummary").mockResolvedValue("AI 生成的摘要");

    const messages: ModelMessage[] = Array.from({ length: 10 }, (_, i) => ({
      content: `msg-${i}`,
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    }));

    await compressorModule.defaultCompressor.compressWithAI(messages, {} as never);

    expect(spyCompress).toHaveBeenCalledWith("", "before", expect.any(Number));
    expect(spyCompress).toHaveBeenCalledWith("", "after", expect.any(Number));
  });

  test("所有消息需要保留时返回 null（消息数 < 3）", async () => {
    const { defaultCompressor } = await import("@/compress/core/compressor");
    const messages: ModelMessage[] = Array.from({ length: 2 }, (_, i) => ({
      content: `msg-${i}`,
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    }));

    const result = await defaultCompressor.compressWithAI(messages, {} as never);
    expect(result).toBeNull();
    expect(mockCallLlmForSummary).not.toHaveBeenCalled();
  });
});
