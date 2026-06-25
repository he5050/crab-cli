/**
 * Tavily 配置加载 — 支持环境变量和配置文件，带 TTL 缓存。
 *
 * 职责:
 *   - 从环境变量或 ~/.crab/config.json 加载 Tavily API Key
 *   - 配置缓存避免重复读取文件
 *
 * 优先级:
 *   1. 环境变量 TAVILY_API_KEY / TAVILY_BASE_URL
 *   2. ~/.crab/config.json 中的 tavilyApiKey / tavilyBaseURL
 */

import { createLogger } from "@/core/logging/logger";
import { readJsonFile } from "@/core/utilities/fileUtils";
import { getGlobalConfigPath, WEB_SEARCH_CACHE_TTL_MS } from "@/config";

const log = createLogger("tool:websearch");

/** Tavily 配置缓存 */
let tavilyConfigCache: { apiKey?: string; baseURL?: string } | null = null;
let tavilyConfigCacheTime = 0;
const CONFIG_CACHE_TTL = WEB_SEARCH_CACHE_TTL_MS; // 30 秒缓存

/**
 * 从配置文件加载 Tavily 配置。
 * 优先使用环境变量，其次读取 ~/.crab/config.json。
 */
export async function loadTavilyConfig(): Promise<{ apiKey?: string; baseURL?: string }> {
  // 环境变量优先
  const envKey = process.env.TAVILY_API_KEY;
  const envURL = process.env.TAVILY_BASE_URL;

  if (envKey) {
    return { apiKey: envKey, baseURL: envURL };
  }

  // 检查缓存
  if (tavilyConfigCache && Date.now() - tavilyConfigCacheTime < CONFIG_CACHE_TTL) {
    return tavilyConfigCache;
  }

  try {
    const configPath = getGlobalConfigPath();
    const config = await readJsonFile(configPath);
    if (config && typeof config === "object" && !Array.isArray(config)) {
      const cfg = config as Record<string, unknown>;
      const apiKey = typeof cfg.tavilyApiKey === "string" ? cfg.tavilyApiKey : undefined;
      const baseURL = typeof cfg.tavilyBaseURL === "string" ? cfg.tavilyBaseURL : undefined;
      tavilyConfigCache = {
        apiKey: apiKey || undefined,
        baseURL: baseURL || undefined,
      };
      tavilyConfigCacheTime = Date.now();
      return tavilyConfigCache;
    }
  } catch (error) {
    log.debug("加载 Tavily 配置失败", { error: error instanceof Error ? error.message : String(error) });
  }

  return {};
}
