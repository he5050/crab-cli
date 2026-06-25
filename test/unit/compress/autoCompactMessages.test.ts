/**
 * autoCompactMessages 集成测试。
 *
 * 测试用例:
 *   - 正常压缩流程（截断 + maybeCompact）
 *   - 压缩失败时发布 Toast 警告（优雅降级）
 *   - 有 sessionId 时使用协调器锁
 *   - 无 sessionId 时不使用协调器锁
 *   - createConversationCompressor 阈值判断
 */
import { describe, expect, test, vi, beforeEach, spyOn } from "bun:test";
import type { ModelMessage } from "ai";
import { globalBus, AppEvent } from "@/bus";

const mockTruncateToolOutputs = vi.fn();
const mockMaybeCompact = vi.fn();
const mockWithLock = vi.fn(async (_id: string, fn: () => Promise<unknown>) => fn());
let mockEstimateTokens = 100_000;

vi.mock("@/compress/conversation", () => ({
  estimateMessagesTokens: vi.fn(() => mockEstimateTokens),
  estimateTokens: vi.fn(() => mockEstimateTokens),
  truncateToolOutputs: (...args: unknown[]) => mockTruncateToolOutputs(...args),
  maybeCompact: (...args: unknown[]) => mockMaybeCompact(...args),
  findSplitIndex: vi.fn(),
  DEFAULT_COMPACTION_CONFIG: {},
  clearAllCompactionCounts: vi.fn(),
  clearCompactionCount: vi.fn(),
  getCompactionCount: vi.fn(() => 0),
  getTrackedCompactionSessionCount: vi.fn(() => 0),
}));

vi.mock("@/compress/core/compressionCoordinator", () => ({
  compressionCoordinator: {
    withLock: (...args: unknown[]) => mockWithLock(...(args as [string, () => Promise<unknown>])),
  },
}));

function mockConfig() {
  return {
    defaultProvider: { provider: "test", model: "test-model" },
  } as never;
}

function mockCompactionConfig() {
  return {
    keepRecentTurns: 4,
    targetRatio: 0.3,
    tokenThreshold: 80_000,
    toolOutputTruncateLength: 1000,
  } as never;
}

describe("autoCompactMessages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEstimateTokens = 100_000;
    mockMaybeCompact.mockResolvedValue({
      compacted: false,
      durationMs: 0,
      messagesAfter: 10,
      messagesBefore: 10,
      tokensAfter: 100_000,
      tokensBefore: 100_000,
    });
  });

  test("调用 truncateToolOutputs 预处理", async () => {
    const { autoCompactMessages } = await import("@/compress/runtime/compressionRuntime");
    const messages: ModelMessage[] = [{ role: "user", content: "hello" }];

    await autoCompactMessages({
      messages,
      config: mockConfig(),
      compactionConfig: mockCompactionConfig(),
      sessionId: "s1",
    });

    expect(mockTruncateToolOutputs).toHaveBeenCalledTimes(1);
    expect(mockTruncateToolOutputs).toHaveBeenCalledWith(messages, 1000, 8);
  });

  test("使用协调器锁（有 sessionId）", async () => {
    const { autoCompactMessages } = await import("@/compress/runtime/compressionRuntime");
    const messages: ModelMessage[] = [{ role: "user", content: "hello" }];

    await autoCompactMessages({
      messages,
      config: mockConfig(),
      compactionConfig: mockCompactionConfig(),
      sessionId: "s1",
    });

    expect(mockWithLock).toHaveBeenCalledWith("s1", expect.any(Function));
  });

  test("不使用协调器锁（无 sessionId）", async () => {
    const { autoCompactMessages } = await import("@/compress/runtime/compressionRuntime");
    const messages: ModelMessage[] = [{ role: "user", content: "hello" }];

    await autoCompactMessages({
      messages,
      config: mockConfig(),
      compactionConfig: mockCompactionConfig(),
    });

    expect(mockWithLock).not.toHaveBeenCalled();
    expect(mockMaybeCompact).toHaveBeenCalledTimes(1);
  });

  test("压缩成功时不发布 Toast", async () => {
    mockMaybeCompact.mockResolvedValue({
      compacted: true,
      durationMs: 100,
      messagesAfter: 3,
      messagesBefore: 10,
      tokensAfter: 30_000,
      tokensBefore: 100_000,
    });

    const publishSpy = spyOn(globalBus, "publish");

    const { autoCompactMessages } = await import("@/compress/runtime/compressionRuntime");
    const messages: ModelMessage[] = [{ role: "user", content: "hello" }];

    await autoCompactMessages({
      messages,
      config: mockConfig(),
      compactionConfig: mockCompactionConfig(),
      sessionId: "s1",
    });

    expect(publishSpy).not.toHaveBeenCalled();
  });

  test("压缩失败时发布 Toast 警告", async () => {
    mockMaybeCompact.mockRejectedValue(new Error("AI 超时"));

    const publishSpy = spyOn(globalBus, "publish");

    const { autoCompactMessages } = await import("@/compress/runtime/compressionRuntime");
    const messages: ModelMessage[] = [{ role: "user", content: "hello" }];

    await autoCompactMessages({
      messages,
      config: mockConfig(),
      compactionConfig: mockCompactionConfig(),
      sessionId: "s1",
    });

    expect(publishSpy).toHaveBeenCalledWith(AppEvent.Toast, {
      message: expect.stringContaining("上下文压缩失败"),
      variant: "warning",
    });
  });

  test("压缩失败时不会抛出异常（优雅降级）", async () => {
    mockMaybeCompact.mockRejectedValue(new Error("致命错误"));

    const { autoCompactMessages } = await import("@/compress/runtime/compressionRuntime");
    const messages: ModelMessage[] = [{ role: "user", content: "hello" }];

    await expect(
      autoCompactMessages({
        messages,
        config: mockConfig(),
        compactionConfig: mockCompactionConfig(),
        sessionId: "s1",
      }),
    ).resolves.toBeUndefined();
  });

  test("传递正确的参数给 maybeCompact", async () => {
    const { autoCompactMessages } = await import("@/compress/runtime/compressionRuntime");
    const messages: ModelMessage[] = [{ role: "user", content: "hello" }];
    const config = mockConfig();
    const compactionConfig = mockCompactionConfig();

    await autoCompactMessages({ messages, config, compactionConfig, sessionId: "s1" });

    expect(mockMaybeCompact).toHaveBeenCalledWith(messages, config, compactionConfig, "s1");
  });
});

describe("createConversationCompressor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMaybeCompact.mockResolvedValue({
      compacted: false,
      durationMs: 0,
      messagesAfter: 10,
      messagesBefore: 10,
      tokensAfter: 50_000,
      tokensBefore: 50_000,
    });
  });

  test("token 低于阈值时不执行压缩", async () => {
    mockEstimateTokens = 50_000;

    const { createConversationCompressor } = await import("@/compress/runtime/compressionRuntime");
    const compressor = createConversationCompressor(mockCompactionConfig(), "s1");
    const messages: ModelMessage[] = [{ role: "user", content: "hello" }];

    const result = await compressor.compress(messages, mockConfig(), "test-model", "s1");

    expect(result.compressed).toBe(false);
    expect(mockMaybeCompact).not.toHaveBeenCalled();
  });

  test("token 超过阈值时执行压缩", async () => {
    mockEstimateTokens = 90_000;

    mockMaybeCompact.mockResolvedValue({
      compacted: true,
      durationMs: 100,
      messagesAfter: 3,
      messagesBefore: 10,
      tokensAfter: 30_000,
      tokensBefore: 90_000,
    });

    const { createConversationCompressor } = await import("@/compress/runtime/compressionRuntime");
    const compressor = createConversationCompressor(mockCompactionConfig(), "s1");
    const messages: ModelMessage[] = [{ role: "user", content: "hello" }];

    const result = await compressor.compress(messages, mockConfig(), "test-model", "s1");

    expect(result.compressed).toBe(true);
    expect(result.beforeTokens).toBe(90_000);
    expect(result.afterTokensEstimate).toBe(30_000);
  });
});
