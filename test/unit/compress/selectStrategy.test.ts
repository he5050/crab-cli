/**
 * 策略选择逻辑测试。
 *
 * 测试用例:
 *   - 显式指定策略
 *   - 自动选择：增量策略
 *   - 自动选择：混合策略（大工具结果）
 *   - 自动选择：混合策略（高 token 压力）
 *   - 自动选择：混合策略（大消息数）
 *   - 默认策略
 */
import { describe, expect, test } from "bun:test";
import { selectCompactStrategyKind } from "@/compress/strategies/compactStrategy";

describe("selectCompactStrategyKind", () => {
  test("显式指定 standard", () => {
    expect(selectCompactStrategyKind({ requestedStrategy: "standard" })).toBe("standard");
  });

  test("显式指定 hybrid", () => {
    expect(selectCompactStrategyKind({ requestedStrategy: "hybrid" })).toBe("hybrid");
  });

  test("显式指定 incremental", () => {
    expect(selectCompactStrategyKind({ requestedStrategy: "incremental" })).toBe("incremental");
  });

  test("无输入默认返回 standard", () => {
    expect(selectCompactStrategyKind()).toBe("standard");
  });

  test("空输入默认返回 standard", () => {
    expect(selectCompactStrategyKind({})).toBe("standard");
  });

  test("增量策略：消息数达到阈值且允许增量", () => {
    expect(
      selectCompactStrategyKind({
        allowIncremental: true,
        messageCount: 20,
        preferIncremental: true,
      }),
    ).toBe("incremental");
  });

  test("增量策略：消息数不足阈值时不选增量", () => {
    expect(
      selectCompactStrategyKind({
        allowIncremental: true,
        messageCount: 5,
        preferIncremental: true,
      }),
    ).toBe("standard");
  });

  test("增量策略：不允许增量时跳过", () => {
    expect(
      selectCompactStrategyKind({
        allowIncremental: false,
        messageCount: 20,
        preferIncremental: true,
      }),
    ).toBe("standard");
  });

  test("大工具结果选择混合策略", () => {
    expect(
      selectCompactStrategyKind({
        hasLargeToolResults: true,
        messageCount: 10,
      }),
    ).toBe("hybrid");
  });

  test("高 token 压力选择混合策略", () => {
    expect(
      selectCompactStrategyKind({
        tokensBefore: 90000,
        tokenBudget: 100000,
      }),
    ).toBe("hybrid");
  });

  test("低 token 压力不选混合", () => {
    expect(
      selectCompactStrategyKind({
        tokensBefore: 50000,
        tokenBudget: 100000,
      }),
    ).toBe("standard");
  });

  test("大消息数选择混合策略", () => {
    expect(
      selectCompactStrategyKind({
        messageCount: 100,
      }),
    ).toBe("hybrid");
  });

  test("显式策略优先于自动选择", () => {
    expect(
      selectCompactStrategyKind({
        hasLargeToolResults: true,
        messageCount: 100,
        requestedStrategy: "standard",
      }),
    ).toBe("standard");
  });

  test("自定义 StrategySelectionConfig", () => {
    expect(
      selectCompactStrategyKind(
        { messageCount: 50 },
        {
          highBudgetPressureRatio: 0.5,
          incrementalMinMessageCount: 5,
          largeMessageCount: 100,
        },
      ),
    ).toBe("standard");
  });

  test("自定义配置使消息数触发混合", () => {
    expect(
      selectCompactStrategyKind(
        { messageCount: 10 },
        {
          highBudgetPressureRatio: 0.9,
          incrementalMinMessageCount: 12,
          largeMessageCount: 8, // 降低大消息阈值
        },
      ),
    ).toBe("hybrid");
  });
});
