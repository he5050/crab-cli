/**
 * selectCompactStrategyKind 边界条件测试。
 *
 * 测试用例:
 *   - requestedStrategy 优先级最高
 *   - allowIncremental=false 时不选增量
 *   - preferIncremental=true 但消息数不足时不选增量
 *   - hasLargeToolResults 强制 hybrid
 *   - 高预算压力触发 hybrid
 *   - 大消息数触发 hybrid
 *   - 默认返回 standard
 *
 * 已知限制: bun:test 跨文件 mock 隔离不完善。compactSessionSuccess.test.ts
 * 会 mock @/compress/strategies/compactStrategy 导致本文件 4 个 hybrid 测试
 * 在批量运行时返回 "standard"（mock 的返回值）。单独运行 15/15 全部通过。
 * 这是 bun:test 的基础设施问题，非代码缺陷。
 */
import { describe, expect, test } from "bun:test";
import { selectCompactStrategyKind } from "@/compress/strategies/compactStrategy";

describe("selectCompactStrategyKind 边界条件", () => {
  test("requestedStrategy 优先级最高", () => {
    // 即使满足增量条件，requestedStrategy=standard 仍返回 standard
    const result = selectCompactStrategyKind({
      requestedStrategy: "standard",
      allowIncremental: true,
      preferIncremental: true,
      messageCount: 100,
    });
    expect(result).toBe("standard");
  });

  test("requestedStrategy=hybrid 时返回 hybrid", () => {
    const result = selectCompactStrategyKind({
      requestedStrategy: "hybrid",
      messageCount: 5,
    });
    expect(result).toBe("hybrid");
  });

  test("allowIncremental=false 时不选增量策略", () => {
    const result = selectCompactStrategyKind({
      allowIncremental: false,
      preferIncremental: true,
      messageCount: 100,
    });
    expect(result).not.toBe("incremental");
  });

  test("preferIncremental=true 但消息数不足 incrementalMinMessageCount", () => {
    // 默认 incrementalMinMessageCount=12，10 条消息不够
    const result = selectCompactStrategyKind({
      allowIncremental: true,
      preferIncremental: true,
      messageCount: 10,
    });
    expect(result).not.toBe("incremental");
  });

  test("preferIncremental=true 且消息数达到阈值时选增量", () => {
    const result = selectCompactStrategyKind({
      allowIncremental: true,
      preferIncremental: true,
      messageCount: 12,
    });
    expect(result).toBe("incremental");
  });

  test("preferIncremental=false 时不选增量", () => {
    const result = selectCompactStrategyKind({
      allowIncremental: true,
      preferIncremental: false,
      messageCount: 100,
    });
    expect(result).not.toBe("incremental");
  });

  test("hasLargeToolResults 强制 hybrid", () => {
    const result = selectCompactStrategyKind({
      hasLargeToolResults: true,
      messageCount: 5,
    });
    expect(result).toBe("hybrid");
  });

  test("高预算压力触发 hybrid（90%+）", () => {
    const result = selectCompactStrategyKind({
      tokenBudget: 100_000,
      tokensBefore: 95_000, // 95%
      messageCount: 10,
    });
    expect(result).toBe("hybrid");
  });

  test("预算压力刚好等于阈值时触发 hybrid", () => {
    const result = selectCompactStrategyKind({
      tokenBudget: 100_000,
      tokensBefore: 90_000, // 刚好 90%
      messageCount: 10,
    });
    expect(result).toBe("hybrid");
  });

  test("预算压力低于阈值不触发 hybrid", () => {
    const result = selectCompactStrategyKind({
      tokenBudget: 100_000,
      tokensBefore: 80_000, // 80% < 90%
      messageCount: 10,
    });
    expect(result).not.toBe("hybrid");
  });

  test("大消息数触发 hybrid（>=80）", () => {
    const result = selectCompactStrategyKind({
      messageCount: 80,
    });
    expect(result).toBe("hybrid");
  });

  test("大消息数刚好低于阈值不触发 hybrid", () => {
    const result = selectCompactStrategyKind({
      messageCount: 79,
    });
    expect(result).not.toBe("hybrid");
  });

  test("默认参数返回 standard", () => {
    const result = selectCompactStrategyKind({});
    expect(result).toBe("standard");
  });

  test("所有条件都不满足时返回 standard", () => {
    const result = selectCompactStrategyKind({
      messageCount: 5,
      tokenBudget: 100_000,
      tokensBefore: 10_000, // 10%
    });
    expect(result).toBe("standard");
  });

  test("自定义配置覆盖默认值", () => {
    const result = selectCompactStrategyKind(
      { messageCount: 100 },
      { largeMessageCount: 200, incrementalMinMessageCount: 50, highBudgetPressureRatio: 0.5 },
    );
    // 100 < 200，不触发 hybrid
    expect(result).not.toBe("hybrid");
  });
});
