/**
 * P3-5: Fallback 并发锁竞态条件测试
 *
 * 测试目标:
 * - probeFallback 的 probingLocks 并发守卫
 * - 同一 provider+model 的并发调用复用同一 Promise
 * - 探测完成后锁被释放（probingLocks.delete）
 * - clearVerifiedMethods 重置所有状态
 */
import { beforeEach, afterEach, describe, expect, test } from "bun:test";
import {
  probeFallback,
  getVerifiedMethod,
  setVerifiedMethod,
  clearVerifiedMethods,
  __setFallbackDepsForTesting,
  __resetFallbackDepsForTesting,
} from "@/api/resilience/fallback";

const mockConfig = {
  defaultProvider: { provider: "p", model: "m" },
  providerConfig: {
    p: { apiKey: "k", baseURL: "https://api.test", requestMethod: "chat" as const },
  },
  fallbackChain: ["chat", "responses", "claude", "gemini"],
} as any;

describe("probeFallback 并发锁", () => {
  beforeEach(() => {
    __resetFallbackDepsForTesting();
  });

  afterEach(() => {
    __resetFallbackDepsForTesting();
  });

  test("单次探测成功后返回正确方法", async () => {
    // chat fails (不在 allowMethods 中返回空流), responses succeeds
    let callCount = 0;
    __setFallbackDepsForTesting({
      createProvider: () => () => ({ id: "mock-model" }) as any,
      streamText: () =>
        ({
          fullStream: (async function* () {
            callCount++;
            await new Promise((r) => setTimeout(r, 10));
            if (callCount === 1) {
              // 第一次探测 "responses" 失败 (chat 被 skip 因为是 failedMethod)
              return; // 空流
            }
            yield { type: "text-delta", text: "hi" };
          })(),
          consumeStream: async () => {},
        }) as any,
      updateModelRequestMethod: async () => true,
    });

    const result = await probeFallback(mockConfig, "p", "chat", "m");
    // "chat" is skipped (failedMethod), probe "responses" first (fails), then "claude" (succeeds)
    expect(result).toBe("claude");
  });

  test("并发探测复用同一 Promise", async () => {
    let callCount = 0;
    __setFallbackDepsForTesting({
      createProvider: () => () => ({ id: "mock-model" }) as any,
      streamText: () =>
        ({
          fullStream: (async function* () {
            callCount++;
            await new Promise((r) => setTimeout(r, 50));
            yield { type: "text-delta", text: "hi" };
          })(),
          consumeStream: async () => {},
        }) as any,
      updateModelRequestMethod: async () => true,
    });

    const [resultA, resultB] = await Promise.all([
      probeFallback(mockConfig, "p", "chat", "m"),
      probeFallback(mockConfig, "p", "chat", "m"),
    ]);

    expect(resultA).toBe(resultB);
    // streamText should only be called once since both share the same probe
    expect(callCount).toBe(1);
  });

  test("探测完成后锁被释放", async () => {
    let probeCount = 0;
    __setFallbackDepsForTesting({
      createProvider: () => () => ({ id: "mock-model" }) as any,
      streamText: () =>
        ({
          fullStream: (async function* () {
            probeCount++;
            await new Promise((r) => setTimeout(r, 10));
            yield { type: "text-delta", text: "hi" };
          })(),
          consumeStream: async () => {},
        }) as any,
      updateModelRequestMethod: async () => true,
    });

    // First probe
    const result1 = await probeFallback(mockConfig, "p", "chat", "m");
    expect(result1).toBe("responses");

    // Clear verified methods so it probes again (not cache hit)
    clearVerifiedMethods();

    // Second probe — should start a new probe (lock was released), not reuse old promise
    const result2 = await probeFallback(mockConfig, "p", "chat", "m");
    expect(result2).toBe("responses");
    expect(probeCount).toBe(2);
  });

  test("clearVerifiedMethods 重置所有缓存", () => {
    setVerifiedMethod("p", "responses", "m");
    expect(getVerifiedMethod(mockConfig, "p", "m")).toBe("responses");

    clearVerifiedMethods();
    // After clearing, getVerifiedMethod falls back to config's requestMethod
    expect(getVerifiedMethod(mockConfig, "p", "m")).toBe("chat");
  });
});
