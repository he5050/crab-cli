/**
 * Provider 回退链公共 API 测试。
 *
 * 测试用例:
 *   - getFallbackChain 解析回退链
 *   - setVerifiedMethod / getVerifiedMethod 探活结果记忆
 *   - clearVerifiedMethods 清理
 *   - getProbeTimeout 超时阈值
 */
import { beforeEach, describe, expect, test } from "bun:test";
import type { AppConfigSchema } from "@/schema/config";
import { clearVerifiedMethods, getFallbackChain, getProbeTimeout, getVerifiedMethod, setVerifiedMethod } from "@/api";
import { FALLBACK_PROBE_TIMEOUT_MS } from "@/config/constants";

function makeConfig(): AppConfigSchema {
  return {
    defaultProvider: { model: "default-model", provider: "primary" },
    providerConfig: {
      bare: {
        apiKey: "test-key",
      },
      primary: {
        apiKey: "test-key",
        modelRequestMethods: {
          "model-a": "claude",
        },
        requestMethod: "responses",
      },
    },
  } as unknown as AppConfigSchema;
}

describe("Fallback 公共 API", () => {
  beforeEach(() => {
    clearVerifiedMethods();
  });

  test("getVerifiedMethod 优先读取模型级内存缓存", () => {
    const config = makeConfig();
    setVerifiedMethod("primary", "gemini", "model-a");

    expect(getVerifiedMethod(config, "primary", "model-a")).toBe("gemini");
  });

  test("getVerifiedMethod 其次读取 provider 级内存缓存", () => {
    const config = makeConfig();
    setVerifiedMethod("primary", "chat");

    expect(getVerifiedMethod(config, "primary", "model-a")).toBe("chat");
  });

  test("getVerifiedMethod 无缓存时读取配置中的模型级和 provider 级方法", () => {
    const config = makeConfig();

    expect(getVerifiedMethod(config, "primary", "model-a")).toBe("claude");
    expect(getVerifiedMethod(config, "primary", "model-b")).toBe("responses");
    expect(getVerifiedMethod(config, "bare", "any-model")).toBe("chat");
    expect(getVerifiedMethod(config, "missing", "any-model")).toBe("chat");
  });

  test("clearVerifiedMethods 清空模型级和 provider 级缓存", () => {
    const config = makeConfig();
    setVerifiedMethod("primary", "gemini", "model-a");
    setVerifiedMethod("primary", "chat");
    clearVerifiedMethods();

    expect(getVerifiedMethod(config, "primary", "model-a")).toBe("claude");
    expect(getVerifiedMethod(config, "primary", "model-b")).toBe("responses");
  });

  test("getFallbackChain 返回副本，外部修改不影响内部顺序", () => {
    const first = getFallbackChain();
    first.push("chat");

    expect(getFallbackChain()).toEqual(["chat", "responses", "claude", "gemini"]);
  });

  test("getProbeTimeout 返回配置常量", () => {
    expect(getProbeTimeout()).toBe(FALLBACK_PROBE_TIMEOUT_MS);
  });
});
