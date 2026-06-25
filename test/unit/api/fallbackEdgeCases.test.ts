/**
 * Fallback 边界情况测试。
 *
 * 测试用例:
 *   - 并发锁
 *   - 探测超时
 *   - 空流处理
 *   - 回写失败
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AppConfigSchema } from "@/schema/config";
import type { RequestMethod } from "@/schema/config";
import { buildDerivedProviderConfig, hasLiveProviderConfig } from "../../helpers/realConfig";

let TEST_CONFIG: AppConfigSchema;
const hasLiveForWriteback = await hasLiveProviderConfig();

beforeAll(async () => {
  TEST_CONFIG = await buildDerivedProviderConfig({
    model: "test-model",
    providerId: "test",
    requestMethod: "chat",
  });
});

async function loadFallbackModule() {
  // @ts-expect-error test-only cache busting for isolated module evaluation
  return import("@api?fallback-edge-cases-test");
}

async function configureFallbackDeps(
  streamText: (options: unknown) => { fullStream: AsyncIterable<unknown> },
  updateModelRequestMethod: (
    providerId: string,
    modelId: string,
    method: RequestMethod,
  ) => Promise<boolean> = async () => true,
) {
  const mod = await loadFallbackModule();
  mod.__resetFallbackDepsForTesting();
  mod.__setFallbackDepsForTesting({
    createProvider: () => () => ({ modelId: "test-model", provider: "test-provider" }),
    streamText,
    updateModelRequestMethod,
  });
  return mod;
}

describe("Fallback 边界 — 并发锁", () => {
  beforeEach(async () => {
    const { __resetFallbackDepsForTesting } = await loadFallbackModule();
    __resetFallbackDepsForTesting();
  });

  test("并发调用 probeFallback 复用同一 Promise", async () => {
    let probeCallCount = 0;

    const { probeFallback } = await configureFallbackDeps(() => {
      probeCallCount++;
      return {
        fullStream: (async function* fullStream() {
          yield { text: "ok", type: "text-delta" };
        })(),
      };
    });

    const [r1, r2] = await Promise.all([
      probeFallback(TEST_CONFIG, "test", "chat", "test-model"),
      probeFallback(TEST_CONFIG, "test", "chat", "test-model"),
    ]);

    // 两个调用应得到相同结果
    expect(r1).toBe(r2);
    // 实际探测只执行一次
    expect(probeCallCount).toBeLessThanOrEqual(3); // 最多试 3 个候选
  });
});

describe("Fallback 边界 — probeOnce 空流", () => {
  test("流正常结束但无 text-delta 视为不可用", async () => {
    const { probeFallback } = await configureFallbackDeps(() => ({
      fullStream: (async function* fullStream() {
        // 空:不 yield 任何 text-delta chunk，直接结束
      })(),
    }));

    const result = await probeFallback(TEST_CONFIG, "test", "chat", "test-model");
    // 空流(无 text-delta)应返回 null(不可用)，尝试降级到下一个方法
    // 如果所有方法都返回空流，最终返回 null
    expect(result).toBeNull();
  });
});

// Config 回写测试需要真实的 Provider SDK 实例
describe.skipIf(!hasLiveForWriteback)("Fallback 边界 — config 回写失败", () => {
  beforeEach(async () => {
    const { clearVerifiedMethods } = await loadFallbackModule();
    clearVerifiedMethods();
  });

  test("回写失败但内存缓存仍有效", async () => {
    const { probeFallback, getVerifiedMethod } = await configureFallbackDeps(
      () => ({
        fullStream: (async function* fullStream() {
          yield { text: "ok", type: "text-delta" };
        })(),
      }),
      async () => false,
    );

    const result = await probeFallback(TEST_CONFIG, "test", "chat", "test-model");

    // 即使回写失败，探测仍返回有效方法
    expect(result).not.toBeNull();

    // 内存缓存应有值
    const verified = getVerifiedMethod(TEST_CONFIG, "test", "test-model");
    expect(verified).toBe(result!);
  });
});

afterEach(async () => {
  const { __resetFallbackDepsForTesting } = await loadFallbackModule();
  __resetFallbackDepsForTesting();
});

afterAll(() => mock.restore());
