/**
 * 端点配置 — Route 系统的端点定义。
 *
 * 职责:
 *   - 封装 baseURL + path + headers
 *   - 提供完整 URL 拼接
 *   - 支持自定义请求头合并
 *
 * 使用场景:
 *   - Route 系统中描述 API 端点
 *   - Provider 适配层构建端点配置
 *
 * 边界:
 *   1. 纯数据描述，不执行网络请求
 *   2. headers 合并优先级: endpoint headers > base headers
 */

/** 端点配置 */
export interface EndpointConfig {
  /** 基础 URL（如 "https://api.openai.com/v1"） */
  baseURL: string;
  /** 请求路径（如 "/chat/completions"） */
  path: string;
  /** 端点级别自定义请求头 */
  headers?: Record<string, string>;
}

/** 构建完整 URL */
export function buildUrl(endpoint: EndpointConfig): string {
  const base = endpoint.baseURL.replace(/\/+$/, "");
  const path = endpoint.path.startsWith("/") ? endpoint.path : `/${endpoint.path}`;
  return `${base}${path}`;
}

/** 合并请求头（后者覆盖前者） */
export function mergeHeaders(...headerSets: Array<Record<string, string> | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const headers of headerSets) {
    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        result[key] = value;
      }
    }
  }
  return result;
}

/** 从 EndpointConfig 创建端点实例 */
export function createEndpoint(config: EndpointConfig): EndpointConfig {
  return { ...config };
}
