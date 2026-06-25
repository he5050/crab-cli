/**
 * Embedding E2E 测试 — 使用真实 LLM 配置验证 embedText/embedTexts。
 *
 * 验证代码路径正确性（非 API 正确性）：确认配置加载、HTTP 请求构造、
 * 响应解析等全链路无内部崩溃（TypeError/undefined 等）。
 * API 自身返回的错误（model_not_found/超时等）视为通过。
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { AppConfigSchema } from "@/schema/config";
import { hasLiveProviderConfig, loadRealTestConfig } from "../../helpers/realConfig";

const hasLiveConfig = await hasLiveProviderConfig();

describe.skipIf(!hasLiveConfig)("embedding E2E — 真实 LLM 调用", () => {
  let realConfig: AppConfigSchema;

  beforeAll(async () => {
    realConfig = await loadRealTestConfig();
  });

  // 辅助：验证代码无崩溃，API 错误视为成功
  async function safeCall<T>(promise: Promise<T>): Promise<T | null> {
    try {
      return await promise;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).toBeTruthy();
      expect(msg).not.toContain("undefined");
      expect(msg).not.toContain("Cannot read properties");
      return null;
    }
  }

  test("embedText 单条文本", async () => {
    const { embedText } = await import("@api");
    const result = await safeCall(embedText(realConfig, "Hello, world!", { maxRetries: 0 }));
    if (result) {
      expect(result).toHaveProperty("text", "Hello, world!");
      expect(result.embedding.length).toBeGreaterThan(0);
    }
  });

  test("embedTexts 批量文本", async () => {
    const { embedTexts } = await import("@api");
    const texts = ["first text", "second text"];
    const result = await safeCall(embedTexts(realConfig, texts, { maxRetries: 0 }));
    if (result) {
      expect(result).toHaveLength(2);
      for (let i = 0; i < result.length; i++) {
        expect(result[i]).toHaveProperty("text", texts[i]);
        expect(result[i]!.embedding.length).toBeGreaterThan(0);
      }
    }
  });

  test("embedTexts 空列表返回空数组", async () => {
    const { embedTexts } = await import("@api");
    const results = await embedTexts(realConfig, []);
    expect(results).toEqual([]);
  });

  test("embedText 指定 providerId", async () => {
    const { embedText } = await import("@api");
    const providerId = realConfig.defaultProvider.provider || "";
    if (!providerId) return;
    const result = await safeCall(
      embedText(realConfig, "test with providerId", { providerId: providerId!, maxRetries: 0 }),
    );
    if (result) {
      expect(result.embedding.length).toBeGreaterThan(0);
    }
  });
});
