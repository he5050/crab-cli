/**
 * Usage 纯函数测试 — 测试用量统计的核心计算逻辑。
 *
 * 测试 getSessionUsageStats 和 getGlobalUsageStats 的行为:
 *   - 零值默认返回
 *   - global 快捷查询
 *   - 不存在的会话返回零值
 */
import { describe, expect, test } from "bun:test";
import { getSessionUsageStats, getGlobalUsageStats } from "@/session";

describe("getSessionUsageStats", () => {
  test("不存在的会话返回零值默认", async () => {
    const stats = await getSessionUsageStats("non-existent-session-xyz");
    expect(stats).toBeDefined();
    expect(stats.sessionId).toBe("non-existent-session-xyz");
    expect(stats.inputTokens).toBe(0);
    expect(stats.outputTokens).toBe(0);
    expect(stats.messageCount).toBe(0);
    expect(stats.toolCallCount).toBe(0);
  });

  test("global 快捷查询返回全局统计视图", async () => {
    const stats = await getSessionUsageStats("global");
    expect(stats).toBeDefined();
    expect(stats.sessionId).toBe("global");
    // 全局统计至少包含正确的字段结构
    expect(typeof stats.inputTokens).toBe("number");
    expect(typeof stats.outputTokens).toBe("number");
    expect(typeof stats.messageCount).toBe("number");
    expect(typeof stats.toolCallCount).toBe("number");
  });

  test("返回值包含 lastUpdated 时间戳", async () => {
    const stats = await getSessionUsageStats("non-existent");
    expect(stats.lastUpdated).toBeDefined();
    // ISO 格式字符串
    expect(typeof stats.lastUpdated).toBe("string");
  });
});

describe("getGlobalUsageStats", () => {
  test("返回正确的统计结构", () => {
    const stats = getGlobalUsageStats();
    expect(stats).toBeDefined();
    expect(typeof stats.sessionCount).toBe("number");
    expect(typeof stats.messageCount).toBe("number");
    expect(typeof stats.totalInputTokens).toBe("number");
    expect(typeof stats.totalOutputTokens).toBe("number");
    expect(typeof stats.totalToolCalls).toBe("number");
    // 非负
    expect(stats.sessionCount).toBeGreaterThanOrEqual(0);
    expect(stats.messageCount).toBeGreaterThanOrEqual(0);
  });
});
