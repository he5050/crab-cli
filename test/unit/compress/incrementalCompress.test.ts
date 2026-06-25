/**
 * IncrementalCompressor 测试。
 *
 * 测试用例:
 *   - 变化检测（追加/修改/删除/无变化）
 *   - 全量压缩 vs 增量压缩
 *   - 状态管理（getState/restoreState）
 *   - 统计信息
 *   - 清理过期条目
 *   - 哈希算法
 */
import { describe, expect, test, beforeEach } from "bun:test";
import { IncrementalCompressor, createIncrementalCompressor } from "@/compress/strategies/incrementalCompressor";
import type { ModelMessage } from "ai";
import type { CompressionResult } from "@/compress/types";

/** 创建模拟消息 */
function createMsg(role: "user" | "assistant", content: string): ModelMessage {
  return { role, content };
}

/** 模拟压缩器（返回摘要） */
function mockCompressor(summary: string): (messages: ModelMessage[]) => Promise<CompressionResult> {
  return async () => ({
    summary,
    usage: { completion_tokens: 100, prompt_tokens: 200, total_tokens: 300 },
  });
}

describe("IncrementalCompressor", () => {
  let compressor: IncrementalCompressor;

  beforeEach(() => {
    compressor = createIncrementalCompressor("test-session", mockCompressor("摘要"), {
      changeThreshold: 0.3,
      maxHistoryEntries: 100,
    });
  });

  test("初始状态正确", () => {
    const state = compressor.getState();
    expect(state.sessionId).toBe("test-session");
    expect(state.entries).toHaveLength(0);
    expect(state.lastMessageCount).toBe(0);
    expect(state.compressionCount).toBe(0);
    expect(state.totalTokensSaved).toBe(0);
  });

  test("首次压缩执行全量压缩", async () => {
    const messages = [createMsg("user", "你好"), createMsg("assistant", "你好！")];
    const result = await compressor.compress(messages);

    expect(result.summary).toBe("摘要");
    const state = compressor.getState();
    expect(state.compressionCount).toBe(1);
    expect(state.lastMessageCount).toBe(2);
    expect(state.entries.length).toBe(2);
  });

  test("无变化时返回缓存结果", async () => {
    const messages = [createMsg("user", "你好"), createMsg("assistant", "你好！")];
    await compressor.compress(messages);

    // 相同消息再次压缩
    const result = await compressor.compress(messages);
    expect(result.summary).toContain("缓存");
  });

  test("追加消息触发增量压缩", async () => {
    const messages1 = [createMsg("user", "你好"), createMsg("assistant", "你好！")];
    await compressor.compress(messages1);

    // 追加新消息
    const messages2 = [...messages1, createMsg("user", "新问题"), createMsg("assistant", "新回答")];
    const result = await compressor.compress(messages2);

    expect(result.summary).toBe("摘要");
    const state = compressor.getState();
    expect(state.compressionCount).toBe(2);
  });

  test("删除消息触发全量重压缩", async () => {
    const messages1 = [createMsg("user", "a"), createMsg("assistant", "b"), createMsg("user", "c")];
    await compressor.compress(messages1);

    // 删除一条消息
    const messages2 = [createMsg("user", "a"), createMsg("assistant", "b")];
    const result = await compressor.compress(messages2);

    expect(result.summary).toBe("摘要");
    const state = compressor.getState();
    // 全量重压缩后条目数 = 当前消息数
    expect(state.entries.length).toBe(2);
  });

  test("变化比例过大触发全量压缩", async () => {
    compressor = createIncrementalCompressor("test-session", mockCompressor("摘要"), {
      changeThreshold: 0.2,
      maxHistoryEntries: 100,
    });

    const messages1 = [createMsg("user", "原始")];
    await compressor.compress(messages1);

    // 追加 1 条新消息到 2 条中，变化比例 1/2 = 50% > 20%
    const messages2 = [...messages1, createMsg("assistant", "新增")];
    const result = await compressor.compress(messages2);

    expect(result.summary).toBe("摘要");
  });

  test("getStats 返回正确统计", async () => {
    const messages = [createMsg("user", "你好"), createMsg("assistant", "你好！")];
    await compressor.compress(messages);

    const stats = compressor.getStats();
    expect(stats.compressionCount).toBe(1);
    expect(stats.entriesCount).toBe(2);
    expect(stats.totalTokensSaved).toBeGreaterThan(0);
    expect(stats.efficiency).toBeGreaterThan(0);
  });

  test("restoreState 恢复状态", async () => {
    const messages = [createMsg("user", "你好"), createMsg("assistant", "你好！")];
    await compressor.compress(messages);

    const savedState = compressor.getState();

    // 创建新实例并恢复
    const newCompressor = createIncrementalCompressor("test-session", mockCompressor("新摘要"));
    newCompressor.restoreState(savedState);

    const restoredState = newCompressor.getState();
    expect(restoredState.sessionId).toBe("test-session");
    expect(restoredState.compressionCount).toBe(1);
    expect(restoredState.lastMessageCount).toBe(2);
    expect(restoredState.entries.length).toBe(2);
  });

  test("清理过期条目", async () => {
    compressor = createIncrementalCompressor("test-session", mockCompressor("摘要"), {
      changeThreshold: 0.3,
      maxHistoryEntries: 3,
    });

    // 多次压缩产生超过 3 条条目
    let messages: ModelMessage[] = [createMsg("user", "初始")];
    await compressor.compress(messages);

    for (let i = 0; i < 3; i++) {
      messages = [...messages, createMsg("user", `新消息${i}`)];
      await compressor.compress(messages);
    }

    const state = compressor.getState();
    // 条目数不应超过 maxHistoryEntries
    expect(state.entries.length).toBeLessThanOrEqual(3);
  });

  test("createIncrementalCompressor 工厂函数", () => {
    const c = createIncrementalCompressor("s1", mockCompressor("test"));
    expect(c).toBeInstanceOf(IncrementalCompressor);
  });
});
