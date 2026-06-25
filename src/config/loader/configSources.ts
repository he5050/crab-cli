/**
 * 配置来源追踪。
 *
 * 职责:
 *   - 追踪每个配置值的来源(默认值/全局/项目/环境变量)
 *   - 提供配置来源的可视化信息
 *   - 支持配置优先级分析
 *
 * 模块功能:
 *   - getConfigSource: 获取配置项的来源信息
 *   - getSourceLabel: 获取来源的可读标签
 *   - getSourceColor: 获取来源的颜色
 *   - ConfigSource: 配置来源类型
 *   - ConfigSourceInfo: 配置来源详情接口
 *
 * 使用场景:
 *   - 配置可视化展示
 *   - 配置调试
 *   - 配置优先级确认
 *
 * 边界:
 *   1. 仅用于可视化展示，不影响配置加载逻辑
 *   2. 优先级:环境变量 > 项目配置 > 全局配置 > 默认值
 *   3. 仅追踪特定配置项(apiKey, model, provider, proxy, devMode)
 *
 * 流程:
 *   1. 检查环境变量
 *   2. 检查项目级配置
 *   3. 检查全局配置
 *   4. 返回默认值
 */
import { AppConfigSchema, type AppConfigSchema as AppConfigType } from "@/schema/config";
import { getGlobalConfigPath, getProjectConfigPath } from "../paths/paths";
import { readJsonFile } from "@/core/utilities/fileUtils";
import { logConfigDebugFailure, logConfigWarnFailure } from "./errors";
import { createLogger } from "@/core/logging/logger";

/** 配置来源类型 */
export type ConfigSource = "default" | "global" | "project" | "env" | "remote";

/** 配置来源详情 */
export interface ConfigSourceInfo {
  source: ConfigSource;
  value: unknown;
  sourcePath?: string;
}

/**
 * 默认配置。
 * 注意: 此处独立实例化而非引用 config.ts 的 DEFAULT_CONFIG，
 * 因为 config.ts → configSources.ts 存在单向依赖，反向引用会造成循环依赖。
 */
const DEFAULT_CONFIG: AppConfigType = AppConfigSchema.parse({});

/**
 * 检测值是否来自环境变量。
 */
function isFromEnv(key: string): boolean {
  const envMap: Record<string, string> = {
    apiKey: "CRAB_API_KEY",
    devMode: "CRAB_DEV",
    model: "CRAB_MODEL",
    provider: "CRAB_PROVIDER",
    proxy: "CRAB_PROXY",
  };
  const envVar = envMap[key];
  return envVar ? Boolean(process.env[envVar]) : false;
}

/**
 * 获取配置项的来源信息。
 */
export async function getConfigSource(key: string): Promise<ConfigSourceInfo> {
  // 1. 检查环境变量
  if (isFromEnv(key)) {
    return { source: "env", value: getEnvValue(key) };
  }

  // 2. 检查项目级配置
  try {
    const projectPath = getProjectConfigPath(process.cwd());
    if (projectPath) {
      const projectCfg = (await readJsonFile(projectPath)) as Record<string, unknown> | null;
      if (projectCfg && key in projectCfg) {
        return { source: "project", sourcePath: projectPath, value: projectCfg[key] };
      }
    }
  } catch (error) {
    logConfigDebugFailure("读取项目配置来源失败", error, {
      key,
      operation: "config.source.project",
    });
  }

  // 3. 检查全局配置
  try {
    const globalPath = getGlobalConfigPath();
    const globalCfg = (await readJsonFile(globalPath)) as Record<string, unknown> | null;
    if (globalCfg && key in globalCfg) {
      return { source: "global", sourcePath: globalPath, value: globalCfg[key] };
    }
  } catch (error) {
    logConfigDebugFailure("读取全局配置来源失败", error, {
      key,
      operation: "config.source.global",
    });
  }

  // 4. 默认值
  return { source: "default", value: DEFAULT_CONFIG[key as keyof AppConfigType] };
}

/**
 * 获取环境变量对应的值。
 */
function getEnvValue(key: string): unknown {
  const envMap: Record<string, string> = {
    apiKey: process.env.CRAB_API_KEY || "",
    devMode: process.env.CRAB_DEV === "1" ? "true" : "false",
    model: process.env.CRAB_MODEL || "",
    provider: process.env.CRAB_PROVIDER || "",
    proxy: process.env.CRAB_PROXY || "",
  };
  return envMap[key] ?? "";
}

/**
 * 获取来源的可读标签。
 */
export function getSourceLabel(source: ConfigSource): string {
  switch (source) {
    case "default": {
      return "默认值";
    }
    case "global": {
      return "全局配置";
    }
    case "project": {
      return "项目配置";
    }
    case "env": {
      return "环境变量";
    }
    case "remote": {
      return "远程配置";
    }
  }
}

/**
 * 获取来源的颜色。
 */
export function getSourceColor(source: ConfigSource): string {
  switch (source) {
    case "default": {
      return "#808080";
    } // 灰色
    case "global": {
      return "#4CAF50";
    } // 绿色
    case "project": {
      return "#2196F3";
    } // 蓝色
    case "env": {
      return "#FF9800";
    } // 橙色
    case "remote": {
      return "#9C27B0";
    } // 紫色
  }
}

// ─── 远程配置源 (P3-A7) ─────────────────────────────────────

const remoteLog = createLogger("config:remote");

/** 远程配置源选项 */
export interface RemoteConfigSourceOptions {
  /** 远程配置 URL */
  url: string;
  /** 自定义请求头 */
  headers?: Record<string, string>;
  /** 请求超时（毫秒，默认 10000） */
  timeout?: number;
}

/**
 * 远程配置源 — 从指定 URL 拉取 JSON 配置。
 *
 * - 使用 fetch() 从 URL 拉取 JSON 配置
 * - 支持超时（默认 10 秒）
 * - 错误时不阻塞启动（返回空对象 + 警告日志）
 *
 * @returns 远程配置对象（失败时返回空对象）
 */
export async function loadRemoteConfig(options: RemoteConfigSourceOptions): Promise<Record<string, unknown>> {
  const { url, headers = {}, timeout = 10_000 } = options;

  if (!url) {
    return {};
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    remoteLog.debug(`正在从远程加载配置: ${url}`);
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        ...headers,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      logConfigWarnFailure(`远程配置拉取失败(HTTP ${response.status})`, new Error(`HTTP ${response.status}`), {
        url,
        operation: "config.source.remote",
        statusCode: response.status,
      });
      return {};
    }

    const data = (await response.json()) as Record<string, unknown>;
    remoteLog.debug("远程配置加载成功");
    return data;
  } catch (error) {
    logConfigWarnFailure("远程配置加载失败，将使用本地配置", error, {
      url,
      operation: "config.source.remote",
    });
    return {};
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── 配置变量替换 (P3-A7) ───────────────────────────────────

/**
 * 配置变量替换工具 — 支持 `${VAR}` 语法。
 *
 * 替换顺序:
 *   1. 从 vars 参数中查找匹配的键
 *   2. 从环境变量中查找匹配的键
 *   3. 未找到则保留原始 `${VAR}`
 *
 * @example
 * // 从环境变量替换
 * substitute("${HOME}/.config", {}) // → "/home/user/.config"
 *
 * // 从配置上下文替换
 * substitute("${provider.apiKey}", { "provider.apiKey": "sk-xxx" }) // → "sk-xxx"
 */
export const ConfigVariable = {
  /**
   * 替换文本中的 `${VAR}` 变量。
   *
   * @param text - 包含 `${VAR}` 占位符的文本
   * @param vars - 额外的变量映射（优先级高于环境变量）
   * @returns 替换后的文本
   */
  substitute(text: string, vars: Record<string, string> = {}): string {
    if (!text || !text.includes("${")) {
      return text;
    }

    return text.replace(/\$\{([^}]+)\}/g, (match, varName: string) => {
      // 1. 从 vars 参数查找
      if (varName in vars) {
        return vars[varName];
      }
      // 2. 从环境变量查找
      const envValue = process.env[varName];
      if (envValue !== undefined) {
        return envValue;
      }
      // 3. 未找到，保留原始占位符
      return match;
    });
  },

  /**
   * 递归替换对象中所有字符串值的变量。
   *
   * @param obj - 配置对象
   * @param vars - 变量映射
   * @returns 替换后的新对象
   */
  substituteObject<T>(obj: T, vars: Record<string, string> = {}): T {
    if (obj === null || obj === undefined) {
      return obj;
    }
    if (typeof obj === "string") {
      return ConfigVariable.substitute(obj, vars) as unknown as T;
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => ConfigVariable.substituteObject(item, vars)) as unknown as T;
    }
    if (typeof obj === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        result[key] = ConfigVariable.substituteObject(value, vars);
      }
      return result as unknown as T;
    }
    return obj;
  },
};
