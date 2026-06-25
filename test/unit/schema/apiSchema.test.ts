/**
 * API Provider Schema 测试。
 *
 * 测试用例:
 *   - ApiProvider 枚举验证
 *
 * 注意: 原 ApiConfig/AiMessage/ApiRequest/ApiResponse 已于 v0.2 移除，
 * 项目全面使用 Vercel AI SDK 原生类型替代。
 */
import { describe, expect, test } from "bun:test";
import { ApiProvider } from "@/schema/api";

describe("API Schema", () => {
  describe("ApiProvider 枚举", () => {
    test("五种合法 Provider", () => {
      for (const provider of ["openai", "anthropic", "google", "ollama", "custom"]) {
        expect(ApiProvider.safeParse(provider).success).toBe(true);
      }
    });

    test("拒绝未知 Provider", () => {
      expect(ApiProvider.safeParse("unknown").success).toBe(false);
      expect(ApiProvider.safeParse("claude").success).toBe(false);
      expect(ApiProvider.safeParse("deepseek").success).toBe(false);
      expect(ApiProvider.safeParse("").success).toBe(false);
    });
  });
});
