/**
 * 代理配置 — HTTP/HTTPS 代理和第三方中转。
 *
 * 职责:
 *   - 管理代理和中转相关的配置
 *   - 提供代理配置查询
 *   - 判断 Provider 是否为第三方中转
 *
 * 模块功能:
 *   - getProxyConfig: 获取全局代理配置
 *   - getProxyUrl: 获取代理 URL(仅在启用时返回)
 *   - getProviderBaseUrl: 获取指定 Provider 的 baseURL
 *   - isRelayProvider: 判断 Provider 是否为第三方中转
 *   - ProxyInfo: 代理信息接口
 *
 * 使用场景:
 *   - API 请求代理配置
 *   - 网络搜索代理配置
 *   - Provider 中转检测
 *
 * 边界:
 *   1. 仅提供配置查询，不负责代理连接
 *   2. 代理配置包括 enabled、url、searchEngine、port、browserDebugPort
 *   3. 中转检测基于 baseURL 与官方域名比较
 *
 * 流程:
 *   1. 从配置中读取代理设置
 *   2. 返回代理信息
 *   3. 检测 Provider 是否为中转
 */
import type { AppConfigSchema, SingleProviderConfig } from "@/schema/config";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("proxy");

/** 代理信息 */
export interface ProxyInfo {
  /** 是否启用代理 */
  enabled: boolean;
  /** 代理 URL */
  url?: string;
  /** 搜索引擎 */
  searchEngine: "duckduckgo" | "bing";
  /** HTTP 代理端口 */
  port: number;
  /** 浏览器调试端口 */
  browserDebugPort: number;
}

/**
 * 获取全局代理配置。
 */
export function getProxyConfig(config: AppConfigSchema): ProxyInfo {
  const enabled = config.proxy?.enabled ?? false;
  const url = config.proxy?.url;
  const searchEngine = config.proxy?.searchEngine ?? "duckduckgo";
  const port = config.proxy?.port ?? 7890;
  const browserDebugPort = config.proxy?.browserDebugPort ?? 9222;

  if (enabled && url) {
    log.debug(`代理已启用: ${url}`);
  }

  return { browserDebugPort, enabled, port, searchEngine, url };
}

/**
 * 获取代理 URL(仅在启用时返回)。
 */
export function getProxyUrl(config: AppConfigSchema): string | undefined {
  const info = getProxyConfig(config);
  if (!info.enabled) {
    return undefined;
  }
  return info.url ?? `http://127.0.0.1:${info.port}`;
}

/**
 * 获取指定 Provider 的 baseURL。
 * 如果配置了第三方中转，返回中转地址。
 */
export function getProviderBaseUrl(config: AppConfigSchema, providerId: string): string | undefined {
  const pConfig = config.providerConfig[providerId];
  return pConfig?.baseURL;
}

/**
 * 判断 Provider 是否为第三方中转。
 * 标准:baseURL 不等于 Provider 官方域名。
 */
export function isRelayProvider(config: AppConfigSchema, providerId: string): boolean {
  const pConfig = config.providerConfig[providerId];
  if (!pConfig?.baseURL) {
    return false;
  }

  const officialDomains: Record<string, string[]> = {
    anthropic: ["api.anthropic.com"],
    google: ["generativelanguage.googleapis.com"],
    openai: ["api.openai.com"],
  };

  const domains = officialDomains[providerId];
  if (!domains) {
    return true;
  } // 非 builtin 一律视为中转
  return !domains.some((d) => pConfig.baseURL?.includes(d) ?? false);
}
