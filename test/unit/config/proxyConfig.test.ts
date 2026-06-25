/**
 * 代理配置权限测试。
 *
 * 测试用例:
 *   - 代理权限检查
 *   - 配置验证
 *   - 安全策略
 */
import { describe, expect, test } from "bun:test";
import { AppConfigSchema } from "@/schema/config";
import { getProviderBaseUrl, getProxyConfig, isRelayProvider } from "@/config";
import { buildDerivedProviderConfig } from "../../helpers/realConfig";

describe("代理/中转配置", () => {
  test("getProxyConfig 默认未启用", () => {
    const config = AppConfigSchema.parse({});
    const proxy = getProxyConfig(config);
    expect(proxy.enabled).toBe(false);
    expect(proxy.url).toBeUndefined();
  });

  test("getProxyConfig 启用代理", () => {
    const config = AppConfigSchema.parse({
      proxy: { enabled: true, url: "http://localhost:7890" },
    });
    const proxy = getProxyConfig(config);
    expect(proxy.enabled).toBe(true);
    expect(proxy.url).toBe("http://localhost:7890");
  });

  test("getProviderBaseUrl 返回自定义 baseURL", async () => {
    const config = await buildDerivedProviderConfig({
      model: "relay-model",
      providerId: "myRelay",
    });
    config.providerConfig.myRelay = {
      ...config.providerConfig.myRelay!,
      baseURL: "https://relay.example.com/v1",
    };
    expect(getProviderBaseUrl(config, "myRelay")).toBe("https://relay.example.com/v1");
  });

  test("isRelayProvider 非 builtin 为中转", async () => {
    const config = await buildDerivedProviderConfig({
      model: "relay-model",
      providerId: "iruidong",
    });
    config.providerConfig.iruidong = {
      ...config.providerConfig.iruidong!,
      baseURL: "https://iruidong.com/v1",
    };
    expect(isRelayProvider(config, "iruidong")).toBe(true);
  });

  test("isRelayProvider openai 官方域不是中转", async () => {
    const config = await buildDerivedProviderConfig({
      model: "gpt-4o",
      providerId: "openai",
    });
    config.providerConfig.openai = {
      ...config.providerConfig.openai!,
      baseURL: "https://api.openai.com/v1",
    };
    expect(isRelayProvider(config, "openai")).toBe(false);
  });

  test("isRelayProvider openai 自定义域是中转", async () => {
    const config = await buildDerivedProviderConfig({
      model: "gpt-4o",
      providerId: "openai",
    });
    config.providerConfig.openai = {
      ...config.providerConfig.openai!,
      baseURL: "https://relay.example.com/v1",
    };
    expect(isRelayProvider(config, "openai")).toBe(true);
  });
});
