import type { AppConfigSchema, RequestMethod, SingleProviderConfig } from "@/schema/config";
import { AppConfigSchema as AppConfigSchemaZod } from "@/schema/config";
import { loadConfig as loadConfigFn, resetConfigCache as resetCacheFn } from "@/config/loader/config";

let cachedRealConfig: AppConfigSchema | null = null;

/**
 * 读取真实全局配置。
 * 唯一真值源:~/.crab/config.json
 * 如果文件不存在，返回 Zod 默认配置。
 */
export async function loadRealTestConfig(): Promise<AppConfigSchema> {
  if (cachedRealConfig) {
    return cachedRealConfig;
  }
  try {
    resetCacheFn();
    cachedRealConfig = await loadConfigFn();
  } catch {
    cachedRealConfig = AppConfigSchemaZod.parse({});
  }
  return cachedRealConfig;
}

/**
 * 判断默认 provider 是否具备可用的真实连接配置。
 */
export async function hasLiveProviderConfig(): Promise<boolean> {
  const config = await loadRealTestConfig();
  const providerId = config.defaultProvider.provider;
  const providerConfig = config.providerConfig[providerId];
  return Boolean(providerConfig) && (Boolean(providerConfig?.apiKey) || Boolean(providerConfig?.baseURL));
}

export function clearRealTestConfigCache(): void {
  cachedRealConfig = null;
  resetCacheFn();
}

/**
 * 创建一个带提供者信息的测试配置。
 * 优先从 ~/.crab/config.json 读取，若不存在则使用内建的默认值。
 */
export async function buildDerivedProviderConfig(options?: {
  providerId?: string;
  requestMethod?: RequestMethod;
  model?: string;
  modelList?: string[];
}): Promise<AppConfigSchema> {
  const base = structuredClone(await loadRealTestConfig());
  const sourceProviderId = base.defaultProvider.provider;
  const fallbackProviderId = Object.keys(base.providerConfig)[0];
  const resolvedSourceProviderId = base.providerConfig[sourceProviderId] ? sourceProviderId : fallbackProviderId;
  let sourceProvider = resolvedSourceProviderId ? base.providerConfig[resolvedSourceProviderId] : undefined;

  // 没有真实配置时，生成一个可用的默认 provider 配置
  if (!sourceProvider) {
    const providerId = options?.providerId ?? "test-provider";
    const model = options?.model ?? "gpt-4o";
    sourceProvider = {
      apiKey: "sk-test-placeholder",
      defaultModel: model,
      modelList: options?.modelList ?? [model],
      requestMethod: options?.requestMethod ?? "chat",
    };
    base.defaultProvider = { model, provider: providerId };
    base.providerConfig = {
      ...base.providerConfig,
      [providerId]: sourceProvider,
    };
    return base;
  }

  const providerId = options?.providerId ?? resolvedSourceProviderId!;
  const requestMethod = options?.requestMethod ?? sourceProvider.requestMethod ?? "chat";
  const model = options?.model ?? base.defaultProvider.model;

  base.defaultProvider = { model, provider: providerId };
  base.providerConfig = {
    ...base.providerConfig,
    [providerId]: {
      ...sourceProvider,
      defaultModel: sourceProvider.defaultModel ?? model,
      modelList: options?.modelList ?? sourceProvider.modelList ?? [model],
      requestMethod,
    },
  };

  return base;
}

export async function buildProviderConfigWithOverrides(
  options: {
    providerId?: string;
    requestMethod?: RequestMethod;
    model?: string;
    modelList?: string[];
  } = {},
  overrides: Partial<SingleProviderConfig> = {},
): Promise<AppConfigSchema> {
  const config = await buildDerivedProviderConfig(options);
  const providerId = options.providerId ?? config.defaultProvider.provider;
  config.providerConfig[providerId] = {
    ...config.providerConfig[providerId]!,
    ...overrides,
  };
  return config;
}

export async function buildInvalidProviderConfig(options?: {
  providerId?: string;
  requestMethod?: RequestMethod;
  model?: string;
  modelList?: string[];
  unset?: ("apiKey" | "baseURL")[];
  overrides?: Partial<SingleProviderConfig>;
}): Promise<AppConfigSchema> {
  const config = await buildProviderConfigWithOverrides(
    {
      model: options?.model,
      modelList: options?.modelList,
      providerId: options?.providerId,
      requestMethod: options?.requestMethod,
    },
    options?.overrides,
  );

  const providerId = options?.providerId ?? config.defaultProvider.provider;
  const provider = {
    ...config.providerConfig[providerId]!,
  } as Partial<SingleProviderConfig>;

  for (const field of options?.unset ?? []) {
    delete provider[field];
  }

  config.providerConfig[providerId] = provider as SingleProviderConfig;
  return config;
}
