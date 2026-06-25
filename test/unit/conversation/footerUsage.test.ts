/**
 * [测试目标] SessionFooter token usage 标签。
 *
 * 测试目标:
 *   - 验证 formatTokenUsageLabel 在有 / 无缓存统计下生成 footer 中显示的 token 文案
 *
 * 测试用例:
 *   - 无缓存统计时只显示总 token:仅 input/output 输出 " · 1.5K tok"
 *   - 有缓存统计时显示 cache read/write:含 cache 字段时追加 " · cache read 1.5K/write 200"
 */
import { describe, expect, test } from "bun:test";
import { formatTokenUsageLabel } from "@/ui/pages/session/footer";

describe("SessionFooter 令牌使用标签", () => {
  test("无缓存统计时只显示总 token", () => {
    expect(formatTokenUsageLabel({ inputTokens: 1200, outputTokens: 300 })).toBe(" · 1.5K tok");
  });

  test("有缓存统计时显示 cache read/write", () => {
    expect(
      formatTokenUsageLabel({
        cacheCreationInputTokens: 200,
        cacheReadInputTokens: 1500,
        cachedTokens: 1500,
        inputTokens: 2000,
        outputTokens: 500,
      }),
    ).toBe(" · 2.5K tok · cache read 1.5K/write 200");
  });
});
