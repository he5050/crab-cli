/**
 * Fallback 单元测试
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { probeFallback, __setFallbackDepsForTesting, __resetFallbackDepsForTesting } from "@/api";
import { AppConfigSchema } from "@/schema/config";

describe("probeFallback locking", () => {
  beforeEach(() => __resetFallbackDepsForTesting());
  afterEach(() => __resetFallbackDepsForTesting());

  test("same provider different models probe in parallel", async () => {
    let callCount = 0;
    __setFallbackDepsForTesting({
      createProvider: () => () => ({ id: "mock-model" }) as any,
      streamText: () =>
        ({
          fullStream: (async function* () {
            callCount++;
            await new Promise((r) => setTimeout(r, 30));
            yield { type: "text-delta", text: "hi" };
          })(),
        }) as any,
      updateModelRequestMethod: async () => true,
    });

    const config = {
      providerConfig: {
        test: { apiKey: "test", baseURL: "http://localhost", requestMethod: "chat" },
      },
      models: [{ modelId: "model-a", providerId: "test", requestMethod: "chat" }],
      defaultProvider: { provider: "test", model: "model-a" },
    } as any;

    const promiseA = probeFallback(config, "test", "responses", "model-a");
    const promiseB = probeFallback(config, "test", "responses", "model-b");

    await Promise.all([promiseA, promiseB]);
    expect(callCount).toBe(2);
  });

  test("same provider same model reuses probe result", async () => {
    let callCount = 0;
    __setFallbackDepsForTesting({
      createProvider: () => () => ({ id: "mock-model" }) as any,
      streamText: () =>
        ({
          fullStream: (async function* () {
            callCount++;
            await new Promise((r) => setTimeout(r, 30));
            yield { type: "text-delta", text: "hi" };
          })(),
        }) as any,
      updateModelRequestMethod: async () => true,
    });

    const config = {
      providerConfig: {
        test: { apiKey: "test", baseURL: "http://localhost", requestMethod: "chat" },
      },
      models: [{ modelId: "model-a", providerId: "test", requestMethod: "chat" }],
      defaultProvider: { provider: "test", model: "model-a" },
    } as any;

    const promiseA = probeFallback(config, "test", "responses", "model-a");
    const promiseB = probeFallback(config, "test", "responses", "model-a");

    await Promise.all([promiseA, promiseB]);
    expect(callCount).toBe(1);
  });
});
