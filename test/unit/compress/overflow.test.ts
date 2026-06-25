/**
 * 溢出处理测试。
 *
 * 测试用例:
 *   - 溢出检测
 *   - 溢出处理
 *   - 数据保护
 */
import { describe, expect, test } from "bun:test";
import {
  getAdaptiveKeepRounds,
  getCompressionAdvice,
  getContextWindowSize,
  getTokenPercentage,
  isOverflow,
} from "@/compress/overflow";

// ─── getContextWindowSize ─────────────────────────────────────

describe("getContextWindowSize", () => {
  test("Claude 模型上下文窗口", () => {
    expect(getContextWindowSize("claude-3-5-sonnet")).toBe(200_000);
    expect(getContextWindowSize("claude-3-5-haiku")).toBe(200_000);
    expect(getContextWindowSize("claude-3-opus")).toBe(200_000);
    expect(getContextWindowSize("claude-sonnet-4-6")).toBe(200_000);
    expect(getContextWindowSize("claude-opus-4-8")).toBe(200_000);
  });

  test("GPT 模型上下文窗口", () => {
    expect(getContextWindowSize("gpt-4o")).toBe(128_000);
    expect(getContextWindowSize("gpt-4o-mini")).toBe(128_000);
    expect(getContextWindowSize("gpt-4-turbo")).toBe(128_000);
    expect(getContextWindowSize("o1")).toBe(200_000);
    expect(getContextWindowSize("o3")).toBe(200_000);
  });

  test("Gemini 模型上下文窗口", () => {
    expect(getContextWindowSize("gemini-2.5-pro")).toBe(1_000_000);
    expect(getContextWindowSize("gemini-2.5-flash")).toBe(1_000_000);
    expect(getContextWindowSize("gemini-2.0-flash")).toBe(1_000_000);
  });

  test("前缀匹配", () => {
    expect(getContextWindowSize("claude-3-5-sonnet-20241022")).toBe(200_000);
    expect(getContextWindowSize("gpt-4o-2024-08-06")).toBe(128_000);
    expect(getContextWindowSize("gemini-2.5-pro-preview")).toBe(1_000_000);
  });

  test("大小写不敏感", () => {
    expect(getContextWindowSize("CLAUDE-3-5-SONNET")).toBe(200_000);
    expect(getContextWindowSize("GPT-4O")).toBe(128_000);
    expect(getContextWindowSize("GEMINI-2.5-PRO")).toBe(1_000_000);
  });

  test("未知模型使用默认值", () => {
    expect(getContextWindowSize("unknown-model")).toBe(128_000);
    expect(getContextWindowSize("custom-model-v1")).toBe(128_000);
  });

  test("空字符串使用默认值", () => {
    expect(getContextWindowSize("")).toBe(128_000);
  });
});

// ─── isOverflow ───────────────────────────────────────────────

describe("isOverflow", () => {
  test("低于阈值不溢出", () => {
    expect(isOverflow(100_000, "gpt-4o", 90)).toBe(false);
    expect(isOverflow(114_000, "gpt-4o", 90)).toBe(false); // 128k * 0.9 = 115200
  });

  test("等于阈值溢出", () => {
    // 128k * 0.9 = 115200
    expect(isOverflow(115_200, "gpt-4o", 90)).toBe(true);
  });

  test("高于阈值溢出", () => {
    expect(isOverflow(120_000, "gpt-4o", 90)).toBe(true);
  });

  test("使用默认阈值 90%", () => {
    // 128k * 0.9 = 115200
    expect(isOverflow(115_000, "gpt-4o")).toBe(false);
    expect(isOverflow(115_200, "gpt-4o")).toBe(true);
  });

  test("自定义阈值", () => {
    // 128k * 0.8 = 102400
    expect(isOverflow(102_000, "gpt-4o", 80)).toBe(false);
    expect(isOverflow(102_400, "gpt-4o", 80)).toBe(true);
  });

  test("Claude 模型溢出检测", () => {
    // 200k * 0.9 = 180000
    expect(isOverflow(179_999, "claude-3-5-sonnet", 90)).toBe(false);
    expect(isOverflow(180_000, "claude-3-5-sonnet", 90)).toBe(true);
  });

  test("Gemini 模型溢出检测", () => {
    // 1M * 0.9 = 900000
    expect(isOverflow(899_999, "gemini-2.5-pro", 90)).toBe(false);
    expect(isOverflow(900_000, "gemini-2.5-pro", 90)).toBe(true);
  });

  test("阈值 100%", () => {
    expect(isOverflow(127_999, "gpt-4o", 100)).toBe(false);
    expect(isOverflow(128_000, "gpt-4o", 100)).toBe(true);
  });

  test("阈值 0%", () => {
    expect(isOverflow(0, "gpt-4o", 0)).toBe(true);
    expect(isOverflow(1, "gpt-4o", 0)).toBe(true);
  });
});

// ─── getTokenPercentage ───────────────────────────────────────

describe("getTokenPercentage", () => {
  test("GPT 模型百分比计算", () => {
    expect(getTokenPercentage(64_000, "gpt-4o")).toBe(50); // 128k 的一半
    expect(getTokenPercentage(128_000, "gpt-4o")).toBe(100);
    expect(getTokenPercentage(0, "gpt-4o")).toBe(0);
  });

  test("Claude 模型百分比计算", () => {
    expect(getTokenPercentage(100_000, "claude-3-5-sonnet")).toBe(50); // 200k 的一半
    expect(getTokenPercentage(200_000, "claude-3-5-sonnet")).toBe(100);
  });

  test("Gemini 模型百分比计算", () => {
    expect(getTokenPercentage(500_000, "gemini-2.5-pro")).toBe(50); // 1M 的一半
    expect(getTokenPercentage(1_000_000, "gemini-2.5-pro")).toBe(100);
  });

  test("超过 100% 时限制为 100%", () => {
    expect(getTokenPercentage(200_000, "gpt-4o")).toBe(100);
    expect(getTokenPercentage(1_000_000, "claude-3-5-sonnet")).toBe(100);
  });

  test("四舍五入", () => {
    // 128k * 0.333 = 42624
    expect(getTokenPercentage(42_624, "gpt-4o")).toBe(33);
    // 128k * 0.666 = 85248
    expect(getTokenPercentage(85_248, "gpt-4o")).toBe(67);
  });

  test("小数值", () => {
    // 小于 1% 时返回 0(Math.round 结果)
    expect(getTokenPercentage(1, "gpt-4o")).toBe(0);
    expect(getTokenPercentage(1280, "gpt-4o")).toBe(1);
  });
});

// ─── getCompressionAdvice ─────────────────────────────────────

describe("getCompressionAdvice", () => {
  test("低于 70% 不压缩", () => {
    expect(getCompressionAdvice(69)).toEqual({
      shouldCompress: false,
      urgency: "low",
    });
    expect(getCompressionAdvice(0)).toEqual({
      shouldCompress: false,
      urgency: "low",
    });
  });

  test("70-79% 低紧急度", () => {
    expect(getCompressionAdvice(70)).toEqual({
      shouldCompress: true,
      urgency: "low",
    });
    expect(getCompressionAdvice(75)).toEqual({
      shouldCompress: true,
      urgency: "low",
    });
    expect(getCompressionAdvice(79)).toEqual({
      shouldCompress: true,
      urgency: "low",
    });
  });

  test("80-89% 中等紧急度", () => {
    expect(getCompressionAdvice(80)).toEqual({
      shouldCompress: true,
      urgency: "medium",
    });
    expect(getCompressionAdvice(85)).toEqual({
      shouldCompress: true,
      urgency: "medium",
    });
    expect(getCompressionAdvice(89)).toEqual({
      shouldCompress: true,
      urgency: "medium",
    });
  });

  test("90% 以上高紧急度", () => {
    expect(getCompressionAdvice(90)).toEqual({
      shouldCompress: true,
      urgency: "high",
    });
    expect(getCompressionAdvice(95)).toEqual({
      shouldCompress: true,
      urgency: "high",
    });
    expect(getCompressionAdvice(100)).toEqual({
      shouldCompress: true,
      urgency: "high",
    });
  });

  test("超过 100% 仍为高紧急度", () => {
    expect(getCompressionAdvice(150)).toEqual({
      shouldCompress: true,
      urgency: "high",
    });
  });
});

// ─── getAdaptiveKeepRounds ────────────────────────────────────

describe("getAdaptiveKeepRounds", () => {
  test("95% 及以上保留 1 轮", () => {
    expect(getAdaptiveKeepRounds(95, 4)).toBe(1);
    expect(getAdaptiveKeepRounds(100, 4)).toBe(1);
  });

  test("85%-94% 保留 2 轮", () => {
    expect(getAdaptiveKeepRounds(85, 4)).toBe(2);
    expect(getAdaptiveKeepRounds(94, 4)).toBe(2);
  });

  test("80%-84% 保留 3 轮", () => {
    expect(getAdaptiveKeepRounds(80, 4)).toBe(3);
    expect(getAdaptiveKeepRounds(84, 4)).toBe(3);
  });

  test("低于 80% 使用默认保留轮数", () => {
    expect(getAdaptiveKeepRounds(79, 4)).toBe(4);
    expect(getAdaptiveKeepRounds(50, 6)).toBe(6);
  });

  test("主会话 compaction 与子代理 compressor 共享同一个自适应 helper", async () => {
    const compactionSource = await Bun.file("src/compress/conversation/compaction.ts").text();
    const subAgentSource = await Bun.file("src/compress/runtime/subAgentCompressor.ts").text();

    expect(compactionSource).toContain("getAdaptiveKeepRounds(percentage");
    expect(subAgentSource).toContain("getAdaptiveKeepRounds(percentage, this.config.keepRecentTurns)");
    expect(subAgentSource).not.toContain("private getAdaptiveKeepRounds");
  });
});

// ─── 边界情况 ───────────────────────────────────────────────────

describe("Overflow 边界情况", () => {
  test("零 token 处理", () => {
    expect(isOverflow(0, "gpt-4o", 90)).toBe(false);
    expect(getTokenPercentage(0, "gpt-4o")).toBe(0);
  });

  test("负 token 处理", () => {
    expect(isOverflow(-100, "gpt-4o", 90)).toBe(false);
    // 负值计算后 Math.min(100, -0) = -0
    expect(getTokenPercentage(-100, "gpt-4o")).toBe(-0);
  });

  test("极大 token 值", () => {
    expect(isOverflow(10_000_000, "gpt-4o", 90)).toBe(true);
    expect(getTokenPercentage(10_000_000, "gpt-4o")).toBe(100);
  });

  test("各种 Claude 模型变体", () => {
    const claudeModels = [
      "claude-3-5-sonnet-20241022",
      "claude-3-5-sonnet-latest",
      "claude-3-5-haiku-20241022",
      "claude-haiku-4-5",
      "claude-3-opus-20240229",
      "claude-sonnet-4-6-20250514",
      "claude-opus-4-8-20250514",
    ];

    for (const model of claudeModels) {
      expect(getContextWindowSize(model)).toBe(200_000);
    }
  });

  test("各种 GPT 模型变体", () => {
    const gptModels = [
      "gpt-4o-2024-08-06",
      "gpt-4o-2024-05-13",
      "gpt-4o-mini-2024-07-18",
      "gpt-4-turbo-2024-04-09",
      "o1-preview",
      "o1-mini",
      "o3-mini",
    ];

    for (const model of gptModels) {
      expect(getContextWindowSize(model)).toBeGreaterThanOrEqual(128_000);
    }
  });
});
