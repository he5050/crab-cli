/**
 * Provider 健康检查 — 独立模块，从 provider.ts 拆分而来。
 *
 * 职责:
 *   - 检查单个 Provider 的健康状态
 *   - 检查所有配置的 Provider 的健康状态
 *
 * 使用场景:
 *   - UI 展示 Provider 状态
 *   - 系统健康检查
 *
 * 边界:
 *   1. 不依赖 Provider 缓存
 *   2. 每个检查独立发起 HTTP 请求
 *   3. 超时默认 10 秒
 */
import type { AppConfigSchema } from "@/schema/config";
import { listConfiguredProviders } from "../core/provider";
import { fetchWithTimeout } from "../utils/fetchTimeout";

/** Provider 健康状态 */
export interface ProviderHealth {
  providerId: string;
  status: "healthy" | "unhealthy" | "unknown";
  latencyMs: number;
  error?: string;
  checkedAt: number;
}

/**
 * 检查 Provider 健康状态。
 * 发送一个简单的请求测试连通性。
 */
export async function checkProviderHealth(config: AppConfigSchema, providerId: string): Promise<ProviderHealth> {
  const startTime = Date.now();
  const pConfig = config.providerConfig[providerId];

  if (!pConfig) {
    return {
      checkedAt: startTime,
      error: "未配置",
      latencyMs: 0,
      providerId,
      status: "unknown",
    };
  }

  try {
    // 按 Provider requestMethod 路由健康检查端点
    const baseURL = pConfig.baseURL?.replace(/\/$/, "") ?? "https://api.openai.com";
    const method = pConfig.requestMethod ?? "chat";

    let url: string;
    let headers: Record<string, string> = { ...pConfig.customHeaders };

    switch (method) {
      case "claude":
        url = baseURL;
        break;
      case "gemini":
        url = `${baseURL}/v1beta/models`;
        headers = {
          ...headers,
          "X-Goog-Api-Key": pConfig.apiKey ?? "",
        };
        break;
      case "chat":
      case "responses":
      default:
        url = `${baseURL}/v1/models`;
        headers = {
          ...(pConfig.apiKey ? { Authorization: `Bearer ${pConfig.apiKey}` } : {}),
          ...headers,
        };
    }

    const response = await fetchWithTimeout(url, {
      headers,
      method: "GET",
      timeoutMs: 10_000,
    });
    const latencyMs = Date.now() - startTime;

    if (response.ok) {
      return {
        checkedAt: Date.now(),
        latencyMs,
        providerId,
        status: "healthy",
      };
    }

    // 401 表示认证失败，但服务是通的
    if (response.status === 401) {
      return {
        checkedAt: Date.now(),
        error: "API Key 无效",
        latencyMs,
        providerId,
        status: "unhealthy",
      };
    }

    // 对于 claude，非 5xx 状态码表示服务可达（端点可能不存在但服务正常）
    if (method === "claude" && response.status < 500) {
      return {
        checkedAt: Date.now(),
        latencyMs,
        providerId,
        status: "healthy",
      };
    }

    return {
      checkedAt: Date.now(),
      error: `HTTP ${response.status}`,
      latencyMs,
      providerId,
      status: "unhealthy",
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);

    return {
      checkedAt: Date.now(),
      error: errorMsg.includes("abort") ? "连接超时" : errorMsg,
      latencyMs,
      providerId,
      status: "unhealthy",
    };
  }
}

/**
 * 检查所有配置的 Provider 健康状态。
 * 使用 Promise.allSettled 并行检查，避免顺序等待。
 */
export async function checkAllProvidersHealth(config: AppConfigSchema): Promise<ProviderHealth[]> {
  const providers = listConfiguredProviders(config);
  const results = await Promise.allSettled(providers.map((providerId) => checkProviderHealth(config, providerId)));
  return results.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : {
          checkedAt: Date.now(),
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
          latencyMs: 0,
          providerId: providers[i] ?? "unknown",
          status: "unhealthy" as const,
        },
  );
}
