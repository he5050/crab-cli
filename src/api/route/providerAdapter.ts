/**
 * Provider 适配器 — 将现有 Provider 系统适配到 Route 系统。
 *
 * 职责:
 *   - 从 AppConfigSchema 和 SingleProviderConfig 构建 Route
 *   - 支持 chat / responses / claude / gemini 四种 requestMethod
 *   - 自动选择正确的端点路径和请求头
 *
 * 使用场景:
 *   - 现有 Provider 配置转换为 Route
 *   - Route 系统作为现有 Provider 的可选路径
 *
 * 边界:
 *   1. 不修改现有 Provider 代码，仅新增适配层
 *   2. 适配器生成的 Route 可通过 executor 执行
 *   3. 认证信息从 SingleProviderConfig 提取
 */

import type { AppConfigSchema, SingleProviderConfig, RequestMethod } from "@/schema/config";
import { resolveRequestMethod } from "../core/provider";
import { createEndpoint, type EndpointConfig } from "./endpoint";
import { defaultHttpTransport, createTransport } from "./transport";
import { createRoute, type Route, type RouteAuth, type RouteBody } from "./route";
import { createId } from "@/core/identity";

/** requestMethod → 端点路径映射 */
const METHOD_PATHS: Record<RequestMethod, string> = {
  chat: "/chat/completions",
  responses: "/responses",
  claude: "/messages",
  gemini: "", // Gemini 路径需要动态拼接 model
};

/** requestMethod → 默认 baseURL 映射 */
const DEFAULT_BASE_URLS: Record<RequestMethod, string> = {
  chat: "https://api.openai.com/v1",
  responses: "https://api.openai.com/v1",
  claude: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
};

/** 根据 provider 配置和 requestMethod 构建端点配置 */
function buildEndpoint(
  providerId: string,
  pConfig: SingleProviderConfig,
  method: RequestMethod,
  modelId: string,
): EndpointConfig {
  const baseURL = pConfig.baseURL ?? DEFAULT_BASE_URLS[method];

  let path = METHOD_PATHS[method];
  if (method === "gemini") {
    path = `/models/${modelId}:generateContent`;
  }

  return createEndpoint({
    baseURL,
    headers: pConfig.customHeaders,
    path,
  });
}

/** 根据 provider 配置构建认证配置 */
function buildAuth(pConfig: SingleProviderConfig): RouteAuth {
  const authType = pConfig.authType ?? "api-key";

  switch (authType) {
    case "api-key": {
      return {
        type: "api-key",
        apiKey: pConfig.apiKey,
      };
    }
    case "oauth": {
      // OAuth token 由上层通过 accessToken 注入
      return {
        type: "oauth",
        accessToken: pConfig.apiKey, // 临时使用 apiKey 字段，实际由适配器调用方注入
      };
    }
    case "aws": {
      if (!pConfig.aws) {
        throw new Error("AWS 认证类型需要配置 aws 字段");
      }
      return {
        type: "aws",
        aws: {
          accessKeyId: pConfig.aws.accessKeyId,
          region: pConfig.aws.region,
          secretAccessKey: pConfig.aws.secretAccessKey,
          ...(pConfig.aws.sessionToken !== undefined ? { sessionToken: pConfig.aws.sessionToken } : {}),
        },
      };
    }
    default: {
      const _exhaustive: never = authType;
      throw new Error(`未知认证类型: ${String(_exhaustive)}`);
    }
  }
}

/** 构建请求体（基础结构，具体由调用方扩展） */
function buildBody(method: RequestMethod, modelId: string): RouteBody {
  const json: Record<string, unknown> = { model: modelId };

  if (method === "gemini") {
    // Gemini API 请求体结构不同
    return {
      json: {
        contents: [],
        ...(modelId ? { model: modelId } : {}),
      },
    };
  }

  return { json };
}

/** Provider 适配器选项 */
export interface ProviderRouteOptions {
  /** 模型 ID */
  modelId: string;
  /** 自定义请求体（覆盖默认） */
  body?: Record<string, unknown>;
  /** OAuth access token（oauth 认证类型时使用） */
  accessToken?: string;
  /** 超时毫秒数 */
  timeoutMs?: number;
  /** 中止信号 */
  abortSignal?: AbortSignal;
}

/**
 * 从应用配置构建 Route。
 * 将现有 Provider 配置适配为 Route 系统格式。
 */
export function buildRouteFromProvider(
  config: AppConfigSchema,
  providerId: string,
  options: ProviderRouteOptions,
): Route {
  const pConfig = config.providerConfig[providerId];
  if (!pConfig) {
    throw new Error(`Provider 配置缺失: ${providerId}`);
  }

  const method = resolveRequestMethod(config, providerId, options.modelId);
  const endpoint = buildEndpoint(providerId, pConfig, method, options.modelId);
  let auth = buildAuth(pConfig);

  // OAuth token 注入
  if (auth.type === "oauth" && options.accessToken) {
    auth = { ...auth, accessToken: options.accessToken };
  }

  const defaultBody = buildBody(method, options.modelId);
  const json = options.body ?? defaultBody.json;

  const routeId = createId("route");
  const transport = createTransport("http");

  return createRoute(
    {
      id: routeId,
      provider: providerId,
      protocol: "http",
      endpoint,
      auth,
      body: { json },
      method: "POST",
      requestMethod: method,
      model: () => options.modelId,
      timeoutMs: options.timeoutMs,
    },
    transport,
  );
}

/** 检查 Provider 是否支持 Route 系统 */
export function isRouteSupported(config: AppConfigSchema, providerId: string): boolean {
  const pConfig = config.providerConfig[providerId];
  if (!pConfig) {
    return false;
  }
  // 所有配置了 baseURL 或 apiKey 的 Provider 都支持
  return Boolean(pConfig.baseURL || pConfig.apiKey);
}

/** 导出默认传输实例供外部使用 */
export { defaultHttpTransport };
