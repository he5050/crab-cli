/**
 * 配置系统 — 分层配置加载与合并，支持热重载。
 *
 * 职责:
 *   - 提供配置加载、合并、覆盖、验证的统一接口
 *   - 支持文件监听热重载
 *   - 管理默认 Provider 解析
 *
 * 模块功能:
 *   - loadConfig: 加载配置(全局 + 项目级 + 环境变量)
 *   - saveConfig: 保存配置到文件
 *   - getConfig: 获取当前配置
 *   - resetConfigCache: 重置配置缓存
 *   - watchConfig: 启动配置监听
 *   - unwatchConfig: 停止配置监听
 *   - deepMerge: 增强型深合并(支持数组增量追加)
 *   - normalizeDefaultProvider: 规范化默认 Provider
 *   - DEFAULT_CONFIG: 默认配置常量
 *
 * 使用场景:
 *   - 应用启动时加载配置
 *   - 配置变更时热重载
 *   - 配置保存和持久化
 *
 * 边界:
 *   1. 仅配置管理，不涉及配置持久化写入
 *   2. 分层优先级(高→低):环境变量 > 项目级配置 > Profile > 全局配置 > 默认值
 *   3. 支持原子更新避免并发写入问题
 *
 * 流程:
 *   1. 加载默认配置
 *   2. 加载全局配置并合并
 *   3. 加载项目级配置并合并
 *   4. 应用环境变量覆盖
 *   5. 规范化默认 Provider
 *   6. 启动文件监听(如启用)
 */
import { createLogger } from "@/core/logging/logger";
import { AppConfigSchema, type AppConfigSchema as AppConfigType } from "@/schema/config";
import type { RequestMethod, SingleProviderConfig } from "@/schema/config";
import { getDataDir, getGlobalConfigPath, getProfilesDir, getProjectConfigPath } from "../paths/paths";
import { readJsonFile } from "@/core/utilities/fileUtils";
import { ConfigVersionWatcher, atomicUpdateGlobalConfig, getCurrentConfigVersion } from "./atomicConfig";
import { loadRemoteConfig, ConfigVariable } from "./configSources";
import { globalBus, type EventBus } from "@/bus";
import { AppEvent } from "@/bus";
import fs from "node:fs";
import path from "node:path";

const log = createLogger("config");

/**
 * 顶层对象剔除一组键。
 * 仅剥离当前层级，不递归 —— zod 的 unrecognized_keys 错误本就只针对当前层。
 */
function pruneUnrecognizedKeys(raw: unknown, keys: string[]): unknown {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return raw;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!keys.includes(k)) {
      out[k] = v;
    }
  }
  return out;
}

function stripInternalMetadata(raw: unknown): unknown {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return raw;
  }
  const out = { ...(raw as Record<string, unknown>) };
  delete out._metadata;
  return out;
}

function sanitizeInvalidProviderRequestMethods(raw: unknown): { sanitized: unknown; providers: string[] } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { providers: [], sanitized: raw };
  }

  const source = raw as Record<string, unknown>;
  const { providerConfig } = source;
  if (providerConfig === null || typeof providerConfig !== "object" || Array.isArray(providerConfig)) {
    return { providers: [], sanitized: raw };
  }

  const providers: string[] = [];
  const cleanedProviderConfig: Record<string, unknown> = {};
  for (const [providerId, providerRaw] of Object.entries(providerConfig as Record<string, unknown>)) {
    if (providerRaw === null || typeof providerRaw !== "object" || Array.isArray(providerRaw)) {
      cleanedProviderConfig[providerId] = providerRaw;
      continue;
    }

    const provider = { ...(providerRaw as Record<string, unknown>) };
    if (
      typeof provider.requestMethod === "string" &&
      !["chat", "responses", "claude", "gemini"].includes(provider.requestMethod)
    ) {
      delete provider.requestMethod;
      providers.push(providerId);
    }
    cleanedProviderConfig[providerId] = provider;
  }

  if (providers.length === 0) {
    return { providers, sanitized: raw };
  }
  return { providers, sanitized: { ...source, providerConfig: cleanedProviderConfig } };
}

/**
 * 解析配置:safeParse → 收集 unrecognized_keys → 警告 + Toast + 丢弃 → 重试。
 * 仅剥离顶层未知键(zod unrecognized_keys 错误即此语义)。
 * 其他类型错误 → 回退 DEFAULT_CONFIG。
 * 不修改 AppConfigSchema 类型，保持公共 API 签名。
 *
 * 导出供测试覆盖未声明字段告警路径。
 */
export function parseConfig(raw: unknown, eventBus: EventBus = globalBus): AppConfigType {
  const first = AppConfigSchema.safeParse(raw);
  if (first.success) {
    return first.data;
  }

  const unrecognized = first.error.issues
    .filter((i) => i.code === "unrecognized_keys")
    .flatMap((i) => {
      // Zod 的 issue 类型未暴露 unrecognized_keys 的 keys 字段，
      // 需要通过类型断言访问（已知的 Zod 类型限制）。
      const { keys } = i as unknown as { keys?: string[] };
      return Array.isArray(keys) ? keys : [];
    });

  if (unrecognized.length > 0) {
    log.warn(`配置含未声明字段已被忽略: ${unrecognized.join(", ")}`);
    try {
      eventBus.publish(AppEvent.Toast, {
        message: `配置忽略 ${unrecognized.length} 个未声明字段(${unrecognized.slice(0, 3).join(", ")}${unrecognized.length > 3 ? "…" : ""})`,
        variant: "warning",
      });
    } catch {
      // 总线未就绪(极早期启动)时静默，不阻断配置加载
    }
    const second = AppConfigSchema.safeParse(pruneUnrecognizedKeys(raw, unrecognized));
    if (second.success) {
      return second.data;
    }
  }

  const hasInvalidProviderRequestMethod = first.error.issues.some(
    (issue) =>
      issue.code === "invalid_value" &&
      issue.path.length === 3 &&
      issue.path[0] === "providerConfig" &&
      issue.path[2] === "requestMethod",
  );

  if (hasInvalidProviderRequestMethod) {
    const { sanitized, providers } = sanitizeInvalidProviderRequestMethods(raw);
    if (providers.length > 0) {
      log.warn(`Provider requestMethod 非法，已使用默认 chat: ${providers.join(", ")}`);
      try {
        eventBus.publish(AppEvent.Toast, {
          message: `Provider requestMethod 非法，已使用默认 chat(${providers.slice(0, 3).join(", ")}${providers.length > 3 ? "…" : ""})`,
          variant: "warning",
        });
      } catch {
        // 总线未就绪(极早期启动)时静默，不阻断配置加载
      }
      const second = AppConfigSchema.safeParse(sanitized);
      if (second.success) {
        return second.data;
      }
    }
  }

  log.error(`配置验证失败: ${first.error.message}`);
  return { ...DEFAULT_CONFIG };
}

/** 默认配置 */
export const DEFAULT_CONFIG: AppConfigType = AppConfigSchema.parse({});

/** 配置加载器 */
export interface ConfigLoader {
  get: () => AppConfigType;
  reload: () => Promise<void>;
  save: (partial: Partial<AppConfigType>) => Promise<boolean>;
}

/** 文件监听器 */
let configWatcher: fs.FSWatcher | null = null;
/** 版本监听器 — 基于版本号检测配置变更，比纯 fs.watch 更精确 */
let configVersionWatcher: ConfigVersionWatcher | null = null;
let configReloadTimer: ReturnType<typeof setTimeout> | null = null;
let configReloadPromise: Promise<void> | null = null;
let isWatchPaused = false;

function hasUsableProviderConnection(config: SingleProviderConfig | undefined): boolean {
  if (!config) {
    return false;
  }
  return Boolean(config.apiKey) || Boolean(config.baseURL);
}

function resolveDefaultProviderId(config: AppConfigType): string | undefined {
  const providerIds = Object.keys(config.providerConfig ?? {});
  if (providerIds.length === 0) {
    return undefined;
  }

  const current = config.defaultProvider.provider;
  if (config.providerConfig[current]) {
    return current;
  }

  return (
    providerIds.find((providerId) => hasUsableProviderConnection(config.providerConfig[providerId])) ?? providerIds[0]
  );
}

function normalizeDefaultProvider(config: AppConfigType): AppConfigType {
  const resolvedProviderId = resolveDefaultProviderId(config);
  if (!resolvedProviderId || resolvedProviderId === config.defaultProvider.provider) {
    return config;
  }

  const resolvedProvider = config.providerConfig[resolvedProviderId];
  const resolvedModel =
    config.defaultProvider.model || resolvedProvider?.defaultModel || resolvedProvider?.modelList?.[0] || "";

  log.warn(`defaultProvider.provider="${config.defaultProvider.provider}" 未配置，回退到 "${resolvedProviderId}"`);

  return {
    ...config,
    defaultProvider: {
      model: resolvedModel,
      provider: resolvedProviderId,
    },
  };
}

/**
 * 增强型深合并。
 * 支持数组增量追加 (agents)，而非覆盖。
 */
export function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const val = source[key as keyof T];
    if (val === undefined || val === null) {
      continue;
    }

    const existing = result[key as keyof T];

    if (key === "agents" && Array.isArray(existing) && Array.isArray(val)) {
      result[key as keyof T] = [...existing, ...val] as T[keyof T];
    } else if (existing && typeof existing === "object" && typeof val === "object" && !Array.isArray(val)) {
      result[key as keyof T] = deepMerge(
        existing as Record<string, unknown>,
        val as Record<string, unknown>,
      ) as T[keyof T];
    } else {
      result[key as keyof T] = val as T[keyof T];
    }
  }
  return result;
}

/** 当前配置缓存 */
let cachedConfig: AppConfigType | null = null;

/**
 * 配置损坏检测。
 * 当全局配置文件存在但 JSON 解析失败时，记录损坏事件并引导用户恢复。
 * @returns true 表示文件完好或无需处理，false 表示检测到损坏
 */
function detectCorruptedConfig(configPath: string): boolean {
  if (!fs.existsSync(configPath)) {
    return true; // 文件不存在不算损坏
  }
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf8").trim();
  } catch {
    return true; // 读取失败不算损坏（权限等问题由调用方处理）
  }
  if (!raw) {
    return true; // 空文件不算损坏
  }
  try {
    JSON.parse(raw); // 尝试解析
    return true;
  } catch {
    log.error(`检测到配置文件损坏(JSON 解析失败): ${configPath}`);
    if (raw.includes("_metadata")) {
      log.warn("配置文件损坏但版本元数据可能可恢复，请手动检查或从备份恢复");
    } else {
      log.warn("配置文件损坏且无版本元数据，建议检查 ~/.crab/config.json 或删除后重启应用");
    }
    return false;
  }
}

/**
 * 环境变量启动诊断。
 * 检测常见配置冲突和潜在问题，输出 warn/debug 级别日志。
 */
let envDiagnosed = false;
function diagnoseEnvironmentVariables(): void {
  if (envDiagnosed) {
    return;
  }
  envDiagnosed = true;

  const proxyUrl = process.env.CRAB_PROXY;
  if (
    proxyUrl &&
    !proxyUrl.startsWith("http://") &&
    !proxyUrl.startsWith("https://") &&
    !proxyUrl.startsWith("socks")
  ) {
    log.warn(`CRAB_PROXY 格式可能无效（缺少协议前缀）: ${proxyUrl.slice(0, 30)}`);
  }

  if (process.env.CRAB_DEV && process.env.CRAB_DEV !== "1") {
    log.debug(`CRAB_DEV="${process.env.CRAB_DEV}"（非 "1"），开发者模式将关闭`);
  }
}

/**
 * 计算两个配置之间的变更摘要（顶层 key 级别）。
 */
function computeConfigDiff(oldConfig: AppConfigType, newConfig: AppConfigType): string[] {
  const changes: string[] = [];
  const allKeys = new Set([...Object.keys(oldConfig), ...Object.keys(newConfig)]);
  for (const key of allKeys) {
    const oldVal = JSON.stringify((oldConfig as Record<string, unknown>)[key]);
    const newVal = JSON.stringify((newConfig as Record<string, unknown>)[key]);
    if (oldVal !== newVal) {
      changes.push(key);
    }
  }
  return changes;
}

/** 加载配置(带缓存) */
export async function loadConfig(eventBus: EventBus = globalBus): Promise<AppConfigType> {
  if (cachedConfig) {
    return cachedConfig;
  }

  let config = { ...DEFAULT_CONFIG };

  // 1. 加载全局配置(~/.crab/config.json)
  try {
    const globalPath = getGlobalConfigPath();

    // 配置损坏检测
    if (!detectCorruptedConfig(globalPath)) {
      // 损坏已记录日志，回退到默认配置
    } else {
      const globalRaw = await readJsonFile(globalPath);
      if (globalRaw) {
        config = deepMerge(config, stripInternalMetadata(globalRaw) as Record<string, unknown>);
        log.debug("已加载全局配置");
      }
    }
  } catch (error) {
    log.error(`加载全局配置失败 (路径: ${getGlobalConfigPath()}): ${(error as Error).message}`);
  }

  // 1.5 加载 Profile 覆盖(~/.crab/profiles/<name>.json)
  if (config.profile && config.profile !== "default") {
    try {
      const profilePath = path.join(getProfilesDir(), `${config.profile}.json`);
      const profileRaw = await readJsonFile(profilePath);
      if (profileRaw) {
        config = deepMerge(config, stripInternalMetadata(profileRaw) as Record<string, unknown>);
        log.debug(`已加载 Profile 覆盖: ${config.profile}`);
      }
    } catch (error) {
      log.warn(`Profile 覆盖文件不存在或加载失败 (${config.profile}): ${(error as Error).message}`);
    }
  }

  // 2. 加载项目级配置(.crab/config.json)
  try {
    const projectPath = getProjectConfigPath(process.cwd());
    if (projectPath) {
      const projectRaw = await readJsonFile(projectPath);
      if (projectRaw) {
        config = deepMerge(config, stripInternalMetadata(projectRaw) as Record<string, unknown>);
        log.debug("已加载项目级配置");
      }
    }
  } catch (error) {
    log.error(`加载项目级配置失败 (路径: ${getProjectConfigPath(process.cwd())}): ${(error as Error).message}`);
  }

  // 2.5 加载远程配置（优先级低于本地配置，不覆盖本地）
  const remoteConfigRaw = config.remoteConfig as
    | { url?: string; headers?: Record<string, string>; timeout?: number }
    | undefined;
  if (remoteConfigRaw?.url) {
    try {
      const remoteData = await loadRemoteConfig({
        url: remoteConfigRaw.url,
        headers: remoteConfigRaw.headers,
        timeout: remoteConfigRaw.timeout,
      });
      if (remoteData && Object.keys(remoteData).length > 0) {
        // 应用变量替换
        const substituted = ConfigVariable.substituteObject(remoteData);
        // 远程配置优先级低于本地，使用 deepMerge 将本地作为 target
        config = deepMerge(substituted as Record<string, unknown>, config);
        log.debug("已加载远程配置并合并（优先级低于本地）");
      }
    } catch (error) {
      log.warn(`远程配置加载失败: ${(error as Error).message}`);
    }
  }

  // 3. 环境变量覆盖(对齐新 schema: defaultProvider + providerConfig)
  const envApiKey = process.env.CRAB_API_KEY;
  if (envApiKey) {
    const { provider } = config.defaultProvider;
    const pc: Record<string, SingleProviderConfig> = {
      ...(config.providerConfig as Record<string, SingleProviderConfig>),
    };
    pc[provider] = {
      ...((pc[provider] ?? {}) as Partial<SingleProviderConfig>),
      apiKey: envApiKey,
      requestMethod: (pc[provider] ?? {}).requestMethod ?? "chat",
    };
    config.providerConfig = pc;
  }

  const envModel = process.env.CRAB_MODEL;
  if (envModel) {
    config.defaultProvider = { ...config.defaultProvider, model: envModel };
  }

  const envProvider = process.env.CRAB_PROVIDER;
  if (envProvider) {
    config.defaultProvider = { ...config.defaultProvider, provider: envProvider };
  }

  const envProxy = process.env.CRAB_PROXY;
  if (envProxy) {
    config.proxy = {
      ...config.proxy,
      enabled: true,
      url: envProxy,
    };
  }

  const envDevMode = process.env.CRAB_DEV;
  if (envDevMode) {
    config.devMode = envDevMode === "1";
  }

  config = normalizeDefaultProvider(config);

  // 3.5 环境变量诊断（检测潜在配置冲突）
  diagnoseEnvironmentVariables();

  // 4. Schema 验证
  try {
    cachedConfig = parseConfig(config, eventBus);
    log.info(`配置加载完成 (profile: ${cachedConfig.profile})`);
    eventBus.publish(AppEvent.ConfigUpdated, { config: cachedConfig, source: "init" });
  } catch (error) {
    log.error(`配置验证失败: ${(error as Error).message}`);
    cachedConfig = { ...DEFAULT_CONFIG };
  }

  return cachedConfig;
}

/** 保存配置到全局路径 */
export async function saveConfig(partial: Partial<AppConfigType>, eventBus: EventBus = globalBus): Promise<boolean> {
  try {
    // 暂停监听，避免自己保存触发热重载
    pauseConfigWatch();

    const configPath = getGlobalConfigPath();
    const existing = (await readJsonFile(configPath)) as Record<string, unknown> | undefined;
    const existingConfig = { ...existing };
    delete existingConfig._metadata;
    const merged = deepMerge(existingConfig, partial);
    const validated = parseConfig(merged, eventBus);

    const result = await atomicUpdateGlobalConfig(validated, {
      replace: true,
      source: "save",
      summary: "saveConfig",
    });
    if (!result.success) {
      log.error(`保存配置失败: ${result.error ?? "unknown"}`);
      resumeConfigWatch();
      return false;
    }

    cachedConfig = validated;

    // 恢复监听
    resumeConfigWatch();

    // 通知所有订阅者配置已更新
    eventBus.publish(AppEvent.ConfigUpdated, { config: validated, source: "save" });
    return true;
  } catch (error) {
    resumeConfigWatch();
    log.error(`保存配置失败: ${(error as Error).message}`);
    return false;
  }
}

/** 获取数据目录路径 */
export function getApplicationDataDir(): string {
  return getDataDir();
}

/** 获取配置实例(自动加载) */
export async function config(): Promise<AppConfigType> {
  if (!cachedConfig) {
    await loadConfig();
  }
  return cachedConfig!;
}

/** 重置缓存(用于测试) */
export function resetConfigCache(): void {
  cachedConfig = null;
}

/**
 * 启动配置文件热重载监听。
 * 当 ~/.crab/config.json 变化时自动重新加载配置。
 *
 * 使用 ConfigVersionWatcher(基于版本号检测)作为主要监听手段，
 * 如果配置文件没有版本元数据，回退到 fs.watch。
 */
export function startConfigWatch(): void {
  if (configWatcher || configVersionWatcher) {
    return;
  }

  const configPath = getGlobalConfigPath();

  // 检查配置文件是否有版本元数据
  getCurrentConfigVersion(configPath)
    .then((version) => {
      if (version) {
        // 配置有版本号 → 使用 ConfigVersionWatcher(精确、低开销)
        configVersionWatcher = new ConfigVersionWatcher(
          configPath,
          async (_newVersion, _oldVersion) => {
            if (isWatchPaused) {
              return;
            }
            await runConfigReload("版本检测");
          },
          2000,
        );
        configVersionWatcher.start();
        log.debug("配置版本监听已启动");
      } else {
        // 无版本号 → 回退到 fs.watch
        startFsWatcher();
      }
    })
    .catch(() => {
      startFsWatcher();
    });
}

function scheduleConfigReload(reason: string, delayMs = 100): void {
  if (configReloadTimer) {
    clearTimeout(configReloadTimer);
  }
  configReloadTimer = setTimeout(() => {
    configReloadTimer = null;
    void runConfigReload(reason);
  }, delayMs);
}

async function runConfigReload(reason: string, eventBus: EventBus = globalBus): Promise<void> {
  if (configReloadPromise) {
    return configReloadPromise;
  }
  configReloadPromise = (async () => {
    try {
      const oldConfig = cachedConfig ? { ...cachedConfig } : null;
      resetConfigCache();
      const newConfig = await loadConfig(eventBus);

      // 记录变更差异（便于调试热重载问题）
      if (oldConfig) {
        const changedKeys = computeConfigDiff(oldConfig, newConfig);
        if (changedKeys.length > 0) {
          log.debug(`配置热重载变更项(${reason}): ${changedKeys.join(", ")}`);
        }
      }

      log.info(`配置已热重载(${reason})`);
      eventBus.publish(AppEvent.ConfigUpdated, { config: newConfig, source: "hot-reload" });
    } catch (error) {
      log.error(`配置热重载失败: ${(error as Error).message}`);
    }
  })().finally(() => {
    configReloadPromise = null;
  });
  return configReloadPromise;
}

/**
 * Fs.watch 回退方案(用于无版本元数据的配置文件)。
 */
function startFsWatcher(): void {
  const configPath = getGlobalConfigPath();
  const configDir = configPath.substring(0, configPath.lastIndexOf("/"));

  try {
    configWatcher = fs.watch(configDir, (eventType: string, filename: string | null) => {
      if (isWatchPaused) {
        return;
      }
      if (filename !== "config.json") {
        return;
      }

      log.debug(`检测到配置文件变化 (${eventType})，准备重新加载...`);

      scheduleConfigReload("fs.watch", 100);
    });

    log.debug("配置文件 fs.watch 监听已启动");
  } catch (error) {
    log.error(`启动配置监听失败: ${(error as Error).message}`);
  }
}

/**
 * 停止配置文件监听。
 */
export function stopConfigWatch(): void {
  if (configReloadTimer) {
    clearTimeout(configReloadTimer);
    configReloadTimer = null;
  }
  if (configVersionWatcher) {
    configVersionWatcher.stop();
    configVersionWatcher = null;
    log.debug("配置版本监听已停止");
  }
  if (configWatcher) {
    configWatcher.close();
    configWatcher = null;
    log.debug("配置文件监听已停止");
  }
}

/**
 * 暂停配置监听(保存配置时临时暂停，避免循环触发)。
 */
export function pauseConfigWatch(): void {
  isWatchPaused = true;
}

/**
 * 恢复配置监听。
 */
export function resumeConfigWatch(): void {
  isWatchPaused = false;
}

/**
 * 更新指定 Provider 的 requestMethod 并持久化到 config.json。
 * 使用 saveConfig 确保单次写入 + Schema 验证 + 事件通知。
 */
export async function updateProviderRequestMethod(
  providerId: string,
  method: RequestMethod,
  eventBus: EventBus = globalBus,
): Promise<boolean> {
  try {
    const currentConfig = await config();
    const updatedProviderConfig: Record<string, SingleProviderConfig> = { ...currentConfig.providerConfig };
    updatedProviderConfig[providerId] = {
      ...(updatedProviderConfig[providerId] ?? { requestMethod: method }),
      requestMethod: method,
    };
    return await saveConfig({ providerConfig: updatedProviderConfig } as Partial<AppConfigType>, eventBus);
  } catch (error) {
    log.error(`更新 requestMethod 失败: ${(error as Error).message}`);
    return false;
  }
}

/**
 * 更新指定 Provider 下某个模型的 requestMethod 并持久化到 config.json。
 * 使用 saveConfig 确保单次写入 + Schema 验证 + 事件通知。
 */
export async function updateModelRequestMethod(
  providerId: string,
  modelId: string,
  method: RequestMethod,
  eventBus: EventBus = globalBus,
): Promise<boolean> {
  try {
    const currentConfig = await config();
    const updatedProviderConfig: Record<string, SingleProviderConfig> = { ...currentConfig.providerConfig };
    const currentPC = updatedProviderConfig[providerId] ?? { requestMethod: method };
    updatedProviderConfig[providerId] = {
      ...currentPC,
      modelRequestMethods: {
        ...currentPC.modelRequestMethods,
        [modelId]: method,
      },
    };
    return await saveConfig({ providerConfig: updatedProviderConfig } as Partial<AppConfigType>, eventBus);
  } catch (error) {
    log.error(`更新模型级 requestMethod 失败: ${(error as Error).message}`);
    return false;
  }
}
