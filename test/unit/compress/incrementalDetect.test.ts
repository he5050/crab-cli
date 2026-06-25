/**
 * IncrementalCompressor detectChanges 详细测试。
 *
 * 测试用例:
 *   - 追加消息检测
 *   - 修改消息检测（内容和角色）
 *   - 删除消息检测
 *   - 无变化检测
 *   - 空消息序列
 *   - 多轮追加后增量检测
 *   - 切换哈希算法
 */
import { describe, expect, test, beforeEach } from "bun:test";
import { IncrementalCompressor, createIncrementalCompressor } from "@/compress/strategies/incrementalCompressor";
import type { ModelMessage } from "ai";
import type { CompressionResult } from "@/compress/types";

function createMsg(role: "user" | "assistant", content: string): ModelMessage {
  return { role, content };
}

function mockCompressor(summary: string): (messages: ModelMessage[]) => Promise<CompressionResult> {
  return async () => ({
    summary,
    usage: { completion_tokens: 100, prompt_tokens: 200, total_tokens: 300 },
  });
}

describe("IncrementalCompressor detectChanges", () => {
  let compressor: IncrementalCompressor;

  beforeEach(() => {
    compressor = createIncrementalCompressor("test-session", mockCompressor("摘要"), {
      changeThreshold: 0.3,
      maxHistoryEntries: 100,
    });
  });

  test("首次 compress 后 detectChanges 返回 none", async () => {
    const messages = [createMsg("user", "a"), createMsg("assistant", "b")];
    await compressor.compress(messages);

    // 相同消息，无变化
    const changes = compressor.detectChanges(messages);
    expect(changes.hasChanges).toBe(false);
    expect(changes.changeType).toBe("none");
    expect(changes.newMessages).toHaveLength(0);
  });

  test("追加消息检测为 append 类型", async () => {
    const base = [createMsg("user", "a"), createMsg("assistant", "b")];
    await compressor.compress(base);

    const appended = [...base, createMsg("user", "c")];
    const changes = compressor.detectChanges(appended);

    expect(changes.hasChanges).toBe(true);
    expect(changes.changeType).toBe("append");
    expect(changes.newMessages).toHaveLength(1);
    expect(changes.newMessages[0]!.content).toBe("c");
    expect(changes.changeStartIndex).toBe(2);
  });

  test("修改中间消息检测为 modify 类型", async () => {
    const base = [createMsg("user", "a"), createMsg("assistant", "b"), createMsg("user", "c")];
    await compressor.compress(base);

    // 修改第二条消息
    const modified = [createMsg("user", "a"), createMsg("assistant", "changed"), createMsg("user", "c")];
    const changes = compressor.detectChanges(modified);

    expect(changes.hasChanges).toBe(true);
    expect(changes.changeType).toBe("modify");
    expect(changes.changeStartIndex).toBe(1);
  });

  test("修改角色检测为 modify 类型", async () => {
    const base = [createMsg("user", "a"), createMsg("assistant", "b")];
    await compressor.compress(base);

    // 修改角色（内容相同但角色不同）
    const modified = [createMsg("assistant", "a"), createMsg("assistant", "b")];
    const changes = compressor.detectChanges(modified);

    expect(changes.hasChanges).toBe(true);
    expect(changes.changeType).toBe("modify");
  });

  test("删除消息检测为 delete 类型", async () => {
    const base = [createMsg("user", "a"), createMsg("assistant", "b"), createMsg("user", "c")];
    await compressor.compress(base);

    // 删除最后一条
    const shortened = [createMsg("user", "a"), createMsg("assistant", "b")];
    const changes = compressor.detectChanges(shortened);

    expect(changes.hasChanges).toBe(true);
    expect(changes.changeType).toBe("delete");
    expect(changes.changeStartIndex).toBe(0);
  });

  test("多次追加后正确的 changeStartIndex", async () => {
    let messages = [createMsg("user", "a")];
    await compressor.compress(messages);

    messages = [...messages, createMsg("assistant", "b")];
    await compressor.compress(messages);

    messages = [...messages, createMsg("user", "c")];
    await compressor.compress(messages);

    // 再追加一条
    messages = [...messages, createMsg("assistant", "d")];
    const changes = compressor.detectChanges(messages);

    expect(changes.changeStartIndex).toBe(3);
    expect(changes.newMessages).toHaveLength(1);
  });

  test("空消息序列与初始状态相同返回 none", async () => {
    // lastMessageCount=0, messages.length=0 → 长度相同，无变化
    const changes = compressor.detectChanges([]);
    expect(changes.hasChanges).toBe(false);
    expect(changes.changeType).toBe("none");
  });

  test("恢复状态后 detectChanges 基于恢复的状态", async () => {
    const messages1 = [createMsg("user", "a"), createMsg("assistant", "b")];
    await compressor.compress(messages1);

    // 保存状态
    const savedState = compressor.getState();

    // 创建新实例并恢复
    const newCompressor = createIncrementalCompressor("test-session", mockCompressor("新摘要"));
    newCompressor.restoreState(savedState);

    // 相同消息应该无变化
    const changes = newCompressor.detectChanges(messages1);
    expect(changes.hasChanges).toBe(false);

    // 追加一条应该检测为 append
    const appended = [...messages1, createMsg("user", "c")];
    const changesAppended = newCompressor.detectChanges(appended);
    expect(changesAppended.changeType).toBe("append");
    expect(changesAppended.changeStartIndex).toBe(2);
  });

  test("复杂内容哈希区分不同内容", async () => {
    // 内容长度相同但内容不同
    const base = [createMsg("user", "abc"), createMsg("assistant", "def")];
    await compressor.compress(base);

    // 替换为相同长度不同内容
    const modified = [createMsg("user", "abc"), createMsg("assistant", "xyz")];
    const changes = compressor.detectChanges(modified);

    expect(changes.changeType).toBe("modify");
    expect(changes.changeStartIndex).toBe(1);
  });

  test("getStats 效率计算", async () => {
    const messages = [createMsg("user", "a"), createMsg("assistant", "b")];
    await compressor.compress(messages);

    const stats = compressor.getStats();
    expect(stats.compressionCount).toBe(1);
    // tokens saved = total_tokens * 0.7 = 210
    expect(stats.totalTokensSaved).toBeGreaterThan(0);
    expect(stats.efficiency).toBeGreaterThan(0);
    expect(stats.entriesCount).toBe(2);
  });
});
