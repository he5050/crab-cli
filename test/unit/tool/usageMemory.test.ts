/**
 * usageMemory 单元测试
 *
 * 测试范围:
 *   - extractIntentKeywords: 关键词提取纯函数
 *   - recordUsageMemory / readUsageMemory: 存储读写
 *   - getUsageBoost: 使用权重评分
 *   - getUsageCandidates: 候选排序
 *
 * 策略: mock logger，使用 clearUsageMemoryForTest 清理存储。
 */
import { afterEach, describe, expect, it, mock } from "bun:test";

mock.module("@/core/logging/logger", () => ({
  createLogger: () => ({ debug: () => {}, error: () => {}, info: () => {}, warn: () => {} }),
}));

import {
  clearUsageMemoryForTest,
  extractIntentKeywords,
  getUsageBoost,
  getUsageCandidates,
  readUsageMemory,
  recordUsageMemory,
} from "@/tool/usageMemory";

describe("extractIntentKeywords", () => {
  it("应提取英文关键词", () => {
    const result = extractIntentKeywords("search for files matching pattern");
    expect(result).toContain("search");
    expect(result).toContain("files");
    expect(result).toContain("pattern");
  });

  it("中文整体作为一个 token 提取（无分词）", () => {
    // 中文无自然分词边界，正则匹配整段 Han 字符序列为一个 token
    const result = extractIntentKeywords("使用正则表达式搜索代码");
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]).toContain("正则表达式");
  });

  it("应过滤英文停用词", () => {
    const result = extractIntentKeywords("the tool for creating files");
    expect(result).not.toContain("the");
    expect(result).not.toContain("for");
    expect(result).not.toContain("with");
    expect(result).toContain("tool");
    expect(result).toContain("creating");
    expect(result).toContain("files");
  });

  it("空输入应返回空数组", () => {
    expect(extractIntentKeywords("")).toEqual([]);
    expect(extractIntentKeywords(undefined)).toEqual([]);
    expect(extractIntentKeywords("   ")).toEqual([]);
  });

  it("应限制关键词数量不超过 12", () => {
    const long = "alpha beta charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oskar";
    const result = extractIntentKeywords(long);
    expect(result.length).toBeLessThanOrEqual(12);
  });

  it("应去重并保持顺序", () => {
    const result = extractIntentKeywords("search search search file");
    // "search" 只出现一次
    const count = result.filter((k) => k === "search").length;
    expect(count).toBe(1);
  });
});

describe("recordUsageMemory + readUsageMemory", () => {
  afterEach(() => {
    clearUsageMemoryForTest();
  });

  it("应记录并读取 usage memory", () => {
    recordUsageMemory({
      kind: "skill",
      name: "my-skill",
      scenario: "code review",
      source: "direct_call",
      success: true,
    });

    const records = readUsageMemory();
    expect(records.length).toBeGreaterThanOrEqual(1);
    const found = records.find((r) => r.name === "my-skill");
    expect(found).toBeDefined();
    expect(found!.kind).toBe("skill");
    expect(found!.successCount).toBe(1);
  });

  it("重复记录应累加计数", () => {
    recordUsageMemory({
      kind: "external_tool",
      name: "gh_issue",
      scenario: "create",
      source: "execute",
      success: true,
    });
    recordUsageMemory({
      kind: "external_tool",
      name: "gh_issue",
      scenario: "create",
      source: "execute",
      success: true,
    });
    recordUsageMemory({
      kind: "external_tool",
      name: "gh_issue",
      scenario: "create",
      source: "execute",
      success: false,
    });

    const records = readUsageMemory();
    const found = records.find((r) => r.name === "gh_issue");
    expect(found!.successCount).toBe(2);
    expect(found!.failureCount).toBe(1);
  });

  it("records 应按 lastUsedAt 降序排列", () => {
    recordUsageMemory({ kind: "skill", name: "old-skill", source: "search", success: true });
    recordUsageMemory({ kind: "skill", name: "new-skill", source: "search", success: true });

    const records = readUsageMemory();
    if (records.length >= 2) {
      expect(records[0]!.lastUsedAt).toBeGreaterThanOrEqual(records[1]!.lastUsedAt);
    }
  });

  it("scenario 过长应截断", () => {
    const longScenario = "x".repeat(200);
    recordUsageMemory({ kind: "skill", name: "test", scenario: longScenario, source: "info", success: true });

    const records = readUsageMemory();
    const found = records.find((r) => r.name === "test");
    expect(found!.scenario.length).toBeLessThanOrEqual(120);
  });
});

describe("getUsageBoost", () => {
  afterEach(() => {
    clearUsageMemoryForTest();
  });

  it("无记录时应返回 score=0", () => {
    const boost = getUsageBoost("skill", "nonexistent", "some scenario");
    expect(boost.score).toBe(0);
    expect(boost.reasons).toEqual([]);
  });

  it("有匹配记录应返回正 score", () => {
    recordUsageMemory({
      kind: "skill",
      name: "review-skill",
      scenario: "code review and quality check",
      source: "execute",
      success: true,
    });

    const boost = getUsageBoost("skill", "review-skill", "code review needed");
    expect(boost.score).toBeGreaterThan(0);
    expect(boost.reasons.length).toBeGreaterThan(0);
  });

  it("频繁失败应降低 score", () => {
    // 记录多次失败
    for (let i = 0; i < 5; i++) {
      recordUsageMemory({
        kind: "external_tool",
        name: "flaky",
        scenario: "deploy",
        source: "execute",
        success: false,
      });
    }
    // 记录一次成功
    recordUsageMemory({ kind: "external_tool", name: "flaky", scenario: "deploy", source: "execute", success: true });

    const boost = getUsageBoost("external_tool", "flaky", "deploy service");
    // 失败惩罚可能使 score 为 0 或负（但函数 clamp 到 0）
    expect(boost.score).toBe(0);
  });
});

describe("getUsageCandidates", () => {
  afterEach(() => {
    clearUsageMemoryForTest();
  });

  it("无记录应返回空数组", () => {
    const candidates = getUsageCandidates("skill", "some scenario");
    expect(candidates).toEqual([]);
  });

  it("应按 boost score 降序返回候选", () => {
    recordUsageMemory({ kind: "skill", name: "high-score", scenario: "code review", source: "execute", success: true });
    recordUsageMemory({ kind: "skill", name: "low-score", scenario: "misc task", source: "info", success: true });

    const candidates = getUsageCandidates("skill", "code review");
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    // 第一个应该是 high-score
    if (candidates.length >= 2) {
      expect(candidates[0]!.boost.score).toBeGreaterThanOrEqual(candidates[1]!.boost.score);
    }
  });
});
