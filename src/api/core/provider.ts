/**
 * Provider 系统 — 基于 requestMethod 路由的 AI Provider 工厂。
 *
 * 职责:
 *   - 根据 providerConfig 的 requestMethod 字段选择对应的 AI SDK
 *   - 创建和管理 Provider 实例
 *   - 实现 Provider 实例缓存
 *
 * 模块功能:
 *   - createProvider: 创建 Provider 工厂函数
 *   - resolveRequestMethod: 解析 provider/model 实际应使用的 requestMethod
 *   - getProviderConfig: 获取 Provider 配置
 *   - getDefaultModelId: 获取默认模型 ID
 *   - listConfiguredProviders: 列出所有已配置的 Provider
 *   - getProviderModels: 获取 Provider 的模型列表
 *   - clearProviderCache: 清除 Provider 缓存
 *   - ProviderFactory: Provider 工厂类型
 *
 * 使用场景:
 *   - LLM 调用前创建 Provider
 *   - 模型选择
 *   - Provider 配置管理
 *
 * 边界:
 *   1. 仅负责 Provider 创建，不负责 API 调用
 *   2. 路由规则:
 *      - chat → createOpenAI → /v1/chat/completions
 *      - responses → createOpenAI.responses() → /v1/responses
 *      - claude → createAnthropic → /v1/messages
 *      - gemini → createGoogleGenerativeAI → /v1beta/models/{model}:generateContent
 *   3. Provider 实例缓存 TTL 5 分钟
 *
 * 流程:
 *   1. 解析 requestMethod
 *   2. 检查缓存
 *   3. 创建 Provider 实例
 *   4. 缓存实例
 *   5. 返回工厂函数
 */
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { AppConfigSchema, SingleProviderConfig } from "@/schema/config";
export type { SingleProviderConfig } from "@/schema/config";
import type { RequestMethod } from "@/schema/config";
import { createLogger } from "@/core/logging/logger";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { createInternalError } from "@/core/errors/appError";
import { _sseCompat } from "../stream/sseCompat";

const log = createLogger("provider");

// ─── Provider 实例缓存 ───────────────────────────────────────────
// Key: `${providerId}:${requestMethod}`
// 避免每次调用 createProvider 都重建 SDK 实例
// 支持 TTL:缓存 5 分钟后过期
let providerCache = new WeakMap<
  AppConfigSchema,
  Map<string, { factory: (modelId: string) => LanguageModelV3; createdAt: number }>
>();

/** 缓存 TTL(毫秒) */
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟

function cacheKey(providerId: string, method: RequestMethod): string {
  return `${providerId}:${method}`;
}

/**
 * 清除 Provider 缓存(配置变更时调用)。
 */
export function clearProviderCache(): void {
  providerCache = new WeakMap();
}

/**
 * 检查缓存是否过期。
 */
function isCacheExpired(createdAt: number): boolean {
  return Date.now() - createdAt > CACHE_TTL_MS;
}

function getFactoryCache(
  config: AppConfigSchema,
): Map<string, { factory: (modelId: string) => LanguageModelV3; createdAt: number }> {
  let cache = providerCache.get(config);
  if (!cache) {
    cache = new Map();
    providerCache.set(config, cache);
  }
  return cache;
}

/**
 * 解析某个 provider/model 实际应使用的 requestMethod。
 * 优先级:modelRequestMethods[modelId] > requestMethod > chat
 */
export function resolveRequestMethod(config: AppConfigSchema, providerId: string, modelId?: string): RequestMethod {
  const pConfig = config.providerConfig[providerId];
  if (!pConfig) {
    return "chat";
  }

  if (modelId && pConfig.modelRequestMethods?.[modelId]) {
    return pConfig.modelRequestMethods[modelId]!;
  }

  return pConfig.requestMethod ?? "chat";
}

/**
 * 根据 requestMethod 创建对应的模型工厂函数(带缓存)。
 *
 * @param config   - 应用配置
 * @param providerId - 可选，指定 Provider ID(不传则使用 defaultProvider)
 * @returns (modelId: string) => LanguageModelV3 模型工厂
 *
 * @example
 * const getModel = createProvider(config);
 * const model = getModel("gpt-4o");
 */
export function createProvider(
  config: AppConfigSchema,
  providerId?: string,
  modelId?: string,
): (modelId: string) => LanguageModelV3 {
  const targetProvider = providerId ?? config.defaultProvider.provider;
  const pConfig = config.providerConfig[targetProvider];

  if (!pConfig) {
    log.error(`Provider 配置缺失: ${providerId}`);
    throw createInternalError(
      "INTERNAL_ERROR",
      `未配置 Provider: ${targetProvider}。请在 config.json 的 providerConfig.${targetProvider} 中添加配置。`,
    );
  }

  const method = resolveRequestMethod(config, targetProvider, modelId);
  const key = cacheKey(targetProvider, method);
  const cache = getFactoryCache(config);
  const cached = cache.get(key);

  // 检查缓存是否有效(未过期)
  if (cached && !isCacheExpired(cached.createdAt)) {
    log.debug(`Provider 缓存命中: ${key} (已缓存 ${Math.round((Date.now() - cached.createdAt) / 1000)}s)`);
    return cached.factory;
  }

  // 缓存过期或不存在，重新创建
  if (cached) {
    log.debug(`Provider 缓存已过期: ${key}，重新创建`);
    cache.delete(key);
  }

  log.debug(`创建 Provider: ${targetProvider} (requestMethod=${method})`);
  // 合并全局 customHeaders(全局优先级低于 provider 级别)
  const mergedConfig: SingleProviderConfig = {
    ...pConfig,
    customHeaders: {
      ...config.customHeaders,
      ...pConfig.customHeaders,
    },
  };
  const factory = createModelFactory(targetProvider, mergedConfig, method);
  const guardedFactory = (requestedModelId: string): LanguageModelV3 => {
    if (!requestedModelId || requestedModelId.trim().length === 0) {
      throw createInternalError(
        "INTERNAL_ERROR",
        "默认模型未配置。请在 config.json 的 defaultProvider.model 中设置模型。",
      );
    }
    return factory(requestedModelId);
  };
  cache.set(key, { createdAt: Date.now(), factory: guardedFactory });
  return guardedFactory;
}

/**
 * 创建模型工厂函数，根据 requestMethod 选择正确的模型创建方式。
 * 扩展 Provider（OpenRouter/xAI/Copilot）使用 OpenAI 兼容模式。
 */
function createModelFactory(
  providerId: string,
  pConfig: SingleProviderConfig,
  method: RequestMethod,
): (modelId: string) => LanguageModelV3 {
  // 扩展 Provider 使用 OpenAI Chat 兼容模式
  const openAICompatProviders = ["openrouter", "xai", "github-copilot", "azure", "bedrock"];
  if (openAICompatProviders.includes(providerId) && method === "chat") {
    return createOpenAIChatFactory(providerId, pConfig);
  }

  switch (method) {
    case "chat": {
      return createOpenAIChatFactory(providerId, pConfig);
    }
    case "responses": {
      return createOpenAIResponsesFactory(providerId, pConfig);
    }
    case "claude": {
      return createAnthropicFactory(providerId, pConfig);
    }
    case "gemini": {
      return createGoogleFactory(providerId, pConfig);
    }
    default: {
      // Exhaustive check: if all RequestMethod cases are handled,
      // This branch is unreachable at compile time.
      const _exhaustive: never = method;
      log.warn(`未知 requestMethod: ${String(_exhaustive)}，回退到 OpenAI 兼容模式`);
      return createOpenAIChatFactory(providerId, pConfig);
    }
  }
}

const { normalizeOpenAICompatibleBaseURL, wrapOpenAICompatibleChatFetch } = _sseCompat;

export const _compatForTesting = _sseCompat;

// ─── 各 Provider 工厂 ──────────────────────────────────────────

/** OpenAI Chat API → /v1/chat/completions */
function createOpenAIChatFactory(
  providerId: string,
  pConfig: SingleProviderConfig,
): (modelId: string) => LanguageModelV3 {
  validateApiKeyOrBaseURL(providerId, pConfig);

  const provider = createOpenAI({
    apiKey: pConfig.apiKey,
    baseURL: normalizeOpenAICompatibleBaseURL(pConfig.baseURL),
    headers: pConfig.customHeaders,
    fetch: wrapOpenAICompatibleChatFetch(),
    // 中转站默认用 compatible 模式，避免 OpenAI 严格校验
  });

  return (modelId: string) => provider.chat(modelId);
}

/** OpenAI Responses API → /v1/responses */
function createOpenAIResponsesFactory(
  providerId: string,
  pConfig: SingleProviderConfig,
): (modelId: string) => LanguageModelV3 {
  validateApiKeyOrBaseURL(providerId, pConfig);

  const provider = createOpenAI({
    apiKey: pConfig.apiKey,
    baseURL: normalizeOpenAICompatibleBaseURL(pConfig.baseURL),
    headers: pConfig.customHeaders,
  });

  return (modelId: string) => provider.responses(modelId);
}

/** Anthropic Claude → /v1/messages */
function createAnthropicFactory(
  providerId: string,
  pConfig: SingleProviderConfig,
): (modelId: string) => LanguageModelV3 {
  if (!pConfig.apiKey) {
    log.error(`Provider ${providerId} (claude 模式) 缺少 apiKey`);
    throw createInternalError("INTERNAL_ERROR", `Provider ${providerId} (claude 模式) 需要配置 apiKey`);
  }

  const provider = createAnthropic({
    apiKey: pConfig.apiKey,
    baseURL: pConfig.baseURL,
    headers: pConfig.customHeaders,
  });

  return (modelId: string) => provider(modelId);
}

/** Google Gemini → /v1beta/models/{model}:generateContent */
function createGoogleFactory(providerId: string, pConfig: SingleProviderConfig): (modelId: string) => LanguageModelV3 {
  if (!pConfig.apiKey) {
    log.error(`Provider ${providerId} (gemini 模式) 缺少 apiKey`);
    throw createInternalError("INTERNAL_ERROR", `Provider ${providerId} (gemini 模式) 需要配置 apiKey`);
  }

  const provider = createGoogleGenerativeAI({
    apiKey: pConfig.apiKey,
    baseURL: pConfig.baseURL,
  });

  return (modelId: string) => provider(modelId);
}

// ─── 校验 ─────────────────────────────────────────────────────

function validateApiKeyOrBaseURL(providerId: string, pConfig: SingleProviderConfig): void {
  const hasBaseURL = pConfig.baseURL && pConfig.baseURL.trim().length > 0;
  const hasApiKey = pConfig.apiKey && pConfig.apiKey.trim().length > 0;
  if (!hasBaseURL && !hasApiKey) {
    log.error(`Provider 配置缺失: ${providerId}`);
    throw createInternalError("INTERNAL_ERROR", `Provider ${providerId} 需要配置 baseURL 或 apiKey`);
  }
}

// ─── 查询辅助 ─────────────────────────────────────────────────

/** 获取默认模型 ID */
export function getDefaultModelId(config: AppConfigSchema, providerId?: string): string {
  // 指定 Provider 时优先取其 defaultModel
  if (providerId && providerId !== config.defaultProvider.provider) {
    const pConfig = config.providerConfig[providerId];
    return pConfig?.defaultModel ?? pConfig?.modelList?.[0] ?? "";
  }
  return config.defaultProvider.model;
}

/** 列出所有已配置的 Provider ID */
export function listConfiguredProviders(config: AppConfigSchema): string[] {
  return Object.keys(config.providerConfig);
}

/** 获取指定 Provider 的可用模型列表 */
export function getProviderModels(config: AppConfigSchema, providerId: string): string[] {
  const pConfig = config.providerConfig[providerId];
  return pConfig?.modelList ?? [];
}

/** 获取指定 Provider 的配置 */
export function getProviderConfig(config: AppConfigSchema, providerId: string): SingleProviderConfig | undefined {
  return config.providerConfig[providerId];
}
