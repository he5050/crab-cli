/**
 * API 模块 mock 工具 — 统一封装 @api/provider / @api/fallback / ai 等高频 mock。
 *
 * 目标:
 *   - 消除 14+ 测试文件中重复 50+ 次的 mock.module("@api", () => ({...}))
 *   - 集中管理默认值,减少每文件重复字段
 *   - 提供 reset() 避免跨测试文件污染
 */
import { mock } from "bun:test";

interface ProviderMocks {
  createProvider?: (config: unknown, providerId?: string, modelId?: string) => (modelId: string) => unknown;
  getDefaultModelId?: (config: unknown, providerId?: string) => string;
  getProviderConfig?: (config: unknown, providerId: string) => unknown;
  getProviderModels?: (config: unknown, providerId: string) => string[];
  listConfiguredProviders?: (config: unknown) => string[];
  resolveRequestMethod?: (config: unknown, providerId: string, modelId?: string) => string;
}

interface FallbackMocks {
  clearVerifiedMethods?: () => void;
  getVerifiedMethod?: (config: unknown, providerId: string, modelId?: string) => string;
  probeFallback?: (
    config: unknown,
    providerId: string,
    failedMethod: string,
    modelId: string,
  ) => Promise<string | null>;
  setVerifiedMethod?: (providerId: string, method: string, modelId?: string) => void;
}

interface AiSdkMocks {
  streamText?: (options: unknown) => { fullStream: AsyncIterable<unknown> };
}

/**
 * 一次性注册 provider + fallback + ai 三层 mock。
 * 任意模块未提供则使用最小可用 stub。
 */
export function installApiMocks(
  options: {
    provider?: ProviderMocks;
    fallback?: FallbackMocks;
    aiSdk?: AiSdkMocks;
  } = {},
) {
  const provider = {
    createProvider: options.provider?.createProvider ?? (() => (modelId: string) => modelId),
    getDefaultModelId: options.provider?.getDefaultModelId ?? (() => "test-model"),
    getProviderConfig: options.provider?.getProviderConfig ?? (() => ({ requestMethod: "chat" })),
    getProviderModels: options.provider?.getProviderModels ?? (() => []),
    listConfiguredProviders: options.provider?.listConfiguredProviders ?? (() => ["test"]),
    resolveRequestMethod: options.provider?.resolveRequestMethod ?? (() => "chat"),
  };

  const fallback = {
    clearVerifiedMethods: options.fallback?.clearVerifiedMethods ?? (() => {}),
    getVerifiedMethod: options.fallback?.getVerifiedMethod ?? (() => "chat"),
    probeFallback: options.fallback?.probeFallback ?? (() => Promise.resolve(null)),
    setVerifiedMethod: options.fallback?.setVerifiedMethod ?? (() => {}),
  };

  const aiSdk = {
    streamText:
      options.aiSdk?.streamText ??
      (() => ({
        fullStream: (async function* () {
          yield { type: "finish" as const };
        })(),
      })),
  };

  mock.module("@api", () => ({ ...provider, ...fallback }));
  mock.module("ai", () => ({ ...aiSdk, streamText: aiSdk.streamText }));

  return { provider, fallback, aiSdk };
}

/**
 * 重置所有 mock（每个测试文件 afterEach 中调用）。
 */
export function resetApiMocks() {
  mock.restore();
}
