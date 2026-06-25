/**
 * 自动压缩重试测试(L4-T06)。
 *
 * 测试目标:
 *   - 验证 AutoCompress 在压缩失败时的重试与退避策略
 *
 * 测试用例:
 *   - 模拟压缩失败时按预期重试
 *   - 达到最大重试次数后抛出
 *   - 成功压缩时正常返回
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

describe("AutoCompress Retry (L4-T06)", () => {
  beforeEach(() => {
    mock.restore();
  });

  test("shouldAutoCompress 达到阈值返回 true", async () => {
    const mod = await import("@/compress/runtime/autoCompress.ts");
    mod.__setAutoCompressDepsForTesting({
      defaultConfig: { autoCompressThreshold: 80, maxRetries: 3, retryBaseDelay: 1000 } as any,
    });

    expect(mod.shouldAutoCompress(80)).toBe(true);
    expect(mod.shouldAutoCompress(90)).toBe(true);
    expect(mod.shouldAutoCompress(79)).toBe(false);
    expect(mod.shouldAutoCompress(50)).toBe(false);
    expect(mod.shouldAutoCompress(80, 90)).toBe(false);
  });

  test("shouldAutoCompress 支持自定义阈值", async () => {
    const mod = await import("@/compress/runtime/autoCompress.ts");
    mod.__setAutoCompressDepsForTesting({
      defaultConfig: { autoCompressThreshold: 80, maxRetries: 3, retryBaseDelay: 1000 } as any,
    });

    expect(mod.shouldAutoCompress(70, 70)).toBe(true);
    expect(mod.shouldAutoCompress(69, 70)).toBe(false);
  });

  test("performAutoCompression 低于阈值返回 null", async () => {
    const mod = await import("@/compress/runtime/autoCompress.ts");
    mod.__setAutoCompressDepsForTesting({
      defaultConfig: { autoCompressThreshold: 80, maxRetries: 3, retryBaseDelay: 1000 } as any,
      estimateMessagesTokens: () => 100,
      getTokenPercentage: () => 30,
    });
    const result = await mod.performAutoCompression([], {} as any, "model-id");
    expect(result).toBeNull();
  });

  test("performAutoCompression 成功时返回结果并触发 completed 状态", async () => {
    const statusUpdates: any[] = [];
    const truncateOversizedToolResults = mock(() => undefined);
    const mod = await import("@/compress/runtime/autoCompress.ts");
    mod.__setAutoCompressDepsForTesting({
      defaultCompressor: {
        compressWithAI: mock(async () => ({
          summary: "compressed summary",
          usage: { completion_tokens: 100, prompt_tokens: 500, total_tokens: 600 },
        })),
      } as any,
      defaultConfig: { autoCompressThreshold: 80, maxRetries: 3, retryBaseDelay: 1000 } as any,
      estimateMessagesTokens: () => 1000,
      getTokenPercentage: () => 85,
      truncateOversizedToolResults,
    });
    const result = await mod.performAutoCompression([], {} as any, "model-id", "s1", (s: any) => statusUpdates.push(s));

    expect(result).not.toBeNull();
    expect(result!.summary).toBe("compressed summary");
    expect(truncateOversizedToolResults).toHaveBeenCalledTimes(1);

    // 应有 compressing 和 completed 两个状态更新
    const steps = statusUpdates.map((s) => s.step);
    expect(steps).toContain("compressing");
    expect(steps).toContain("completed");
  });

  test("performAutoCompression 失败后重试，耗尽后返回 failed 状态", async () => {
    const statusUpdates: any[] = [];
    let attemptCount = 0;
    const mod = await import("@/compress/runtime/autoCompress.ts");
    mod.__setAutoCompressDepsForTesting({
      defaultCompressor: {
        compressWithAI: mock(async () => {
          attemptCount++;
          throw new Error(`compress error attempt ${attemptCount}`);
        }),
      } as any,
      defaultConfig: { autoCompressThreshold: 80, maxRetries: 2, retryBaseDelay: 50 } as any,
      estimateMessagesTokens: () => 1000,
      getTokenPercentage: () => 85,
      setTimeout: ((fn: (...args: any[]) => void) => {
        fn();
        return 0 as any;
      }) as typeof setTimeout,
    });

    try {
      const result = await mod.performAutoCompression([], {} as any, "model-id", "s2", (s: any) =>
        statusUpdates.push(s),
      );

      expect(result).toBeNull();
      expect(attemptCount).toBe(3); // 1次初始 + 2次重试

      // 状态更新应包含 retrying 和 failed
      const steps = statusUpdates.filter((s) => s != null).map((s: any) => s.step);
      expect(steps).toContain("retrying");
      expect(steps).toContain("failed");

      // Failed 状态应有错误信息
      const failedStatus = statusUpdates.find((s) => s != null && s.step === "failed");
      expect(failedStatus).toBeDefined();
      expect(failedStatus.message).toContain("压缩失败");
    } finally {
      mod.__resetAutoCompressDepsForTesting();
    }
  });
});
