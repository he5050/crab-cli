/**
 * websearch/utils 单元测试
 *
 * 测试范围:
 *   - formatResults: 搜索结果格式化
 *   - withRetry: 指数退避重试
 *
 * 策略: mock logger，测试纯函数和重试逻辑。
 */
import { describe, expect, it, mock } from "bun:test";

mock.module("@/core/logging/logger", () => ({
  createLogger: () => ({ debug: () => {}, error: () => {}, info: () => {}, warn: () => {} }),
}));

import {
  formatResults,
  withRetry,
  DEFAULT_MAX_RESULTS,
  RETRY_MAX_ATTEMPTS,
  RETRY_BASE_DELAY,
} from "@/tool/websearch/utils";

describe("formatResults", () => {
  it("空结果应返回提示文本", () => {
    expect(formatResults([])).toBe("无搜索结果。");
  });

  it("应格式化单条结果", () => {
    const result = formatResults([{ title: "Test", url: "https://example.com", snippet: "desc" }]);
    expect(result).toContain("1. **Test**");
    expect(result).toContain("https://example.com");
    expect(result).toContain("desc");
  });

  it("应格式化多条结果", () => {
    const results = formatResults([
      { title: "A", url: "https://a.com", snippet: "sa" },
      { title: "B", url: "https://b.com" },
    ]);
    expect(results).toContain("1. **A**");
    expect(results).toContain("2. **B**");
    expect(results).toContain("sa");
    expect(results).not.toContain("undefined");
  });

  it("无 snippet 应跳过", () => {
    const result = formatResults([{ title: "T", url: "https://t.com" }]);
    expect(result).not.toContain("undefined");
  });
});

describe("withRetry", () => {
  it("首次成功应直接返回结果", async () => {
    const fn = mock(() => Promise.resolve("ok"));
    const result = await withRetry(fn, "test");
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("返回 null 应立即停止重试", async () => {
    const fn = mock(() => Promise.resolve(null));
    const result = await withRetry(fn, "test");
    expect(result).toBeNull();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("失败后重试最终成功应返回结果", async () => {
    const fn = mock().mockRejectedValueOnce(new Error("fail1")).mockResolvedValueOnce("recovered");

    const result = await withRetry(fn, "test");
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("所有重试失败应返回 null", async () => {
    const fn = mock().mockRejectedValue(new Error("persistent"));

    const result = await withRetry(fn, "test");
    expect(result).toBeNull();
    expect(fn).toHaveBeenCalledTimes(RETRY_MAX_ATTEMPTS);
  });
});

describe("常量", () => {
  it("DEFAULT_MAX_RESULTS 应为 10", () => {
    expect(DEFAULT_MAX_RESULTS).toBe(10);
  });

  it("RETRY_MAX_ATTEMPTS 应为 3", () => {
    expect(RETRY_MAX_ATTEMPTS).toBe(3);
  });

  it("RETRY_BASE_DELAY 应为 1000ms", () => {
    expect(RETRY_BASE_DELAY).toBe(1000);
  });
});
