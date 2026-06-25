/**
 * Route 接口定义 — Route 系统的核心抽象。
 *
 * 职责:
 *   - 定义 Route 接口（id, provider, protocol, endpoint, auth, transport, body, model）
 *   - 提供 Route 构建器
 *   - 描述一次 LLM API 请求的完整路由信息
 *
 * 架构层次:
 *   Route（路由描述） → Endpoint（端点配置） → Transport（传输层） → Executor（执行器）
 *
 * 使用场景:
 *   - 声明式描述 LLM API 调用路由
 *   - Provider 适配层将现有配置转换为 Route
 *   - 执行器根据 Route 构建并发送请求
 *
 * 边界:
 *   1. Route 是纯数据描述，不执行请求
 *   2. 作为现有 Provider 系统的可选路径，不破坏现有代码
 *   3. auth 字段支持 apiKey / oauth / aws 三种认证类型
 */

import type { TransportProtocol, Transport } from "./transport";
import type { EndpointConfig } from "./endpoint";
import type { RequestMethod } from "@/schema/config";

/** 认证类型 */
export type AuthType = "api-key" | "oauth" | "aws";

/** Route 认证配置 */
export interface RouteAuth {
  /** 认证类型 */
  type: AuthType;
  /** API Key（api-key 类型使用） */
  apiKey?: string;
  /** OAuth access token（oauth 类型使用） */
  accessToken?: string;
  /** AWS 凭证（aws 类型使用） */
  aws?: {
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
  /** 认证头名称（默认 "Authorization"） */
  headerName?: string;
  /** 认证头值前缀（默认 "Bearer "） */
  headerPrefix?: string;
}

/** Route 请求体类型 */
export interface RouteBody {
  /** 请求体 JSON 内容 */
  json: Record<string, unknown>;
  /** 请求体内容类型（默认 "application/json"） */
  contentType?: string;
}

/** Route 接口 — 描述一次 LLM API 请求的完整路由信息 */
export interface Route {
  /** 路由唯一标识 */
  id: string;
  /** Provider ID（如 "openai", "anthropic"） */
  provider?: string;
  /** 传输协议 */
  protocol: TransportProtocol;
  /** 端点配置 */
  endpoint: EndpointConfig;
  /** 认证配置 */
  auth: RouteAuth;
  /** 传输层实例 */
  transport: Transport;
  /** 请求体 */
  body: RouteBody;
  /** HTTP 方法（默认 "POST"） */
  method?: string;
  /** 请求方法类型（chat / responses / claude / gemini） */
  requestMethod?: RequestMethod;
  /** 模型工厂函数 — 返回模型 ID */
  model: () => string;
  /** 超时毫秒数 */
  timeoutMs?: number;
}

/** Route 构建器选项 */
export interface RouteBuilderOptions {
  id: string;
  provider?: string;
  protocol?: TransportProtocol;
  endpoint: EndpointConfig;
  auth: RouteAuth;
  body: RouteBody;
  method?: string;
  requestMethod?: RequestMethod;
  model: () => string;
  timeoutMs?: number;
  /** 传输类型: "http"(默认) 或 "ws"(WebSocket) */
  transportType?: "http" | "ws";
}

/** 根据认证配置构建认证请求头 */
export function buildAuthHeaders(auth: RouteAuth): Record<string, string> {
  const headers: Record<string, string> = {};
  const headerName = auth.headerName ?? "Authorization";
  const prefix = auth.headerPrefix ?? "Bearer ";

  switch (auth.type) {
    case "api-key": {
      if (auth.apiKey) {
        headers[headerName] = `${prefix}${auth.apiKey}`;
      }
      break;
    }
    case "oauth": {
      if (auth.accessToken) {
        headers[headerName] = `${prefix}${auth.accessToken}`;
      }
      break;
    }
    case "aws": {
      // AWS SigV4 签名由传输层或适配器处理，此处仅设置基础头
      if (auth.aws) {
        headers["x-amz-region"] = auth.aws.region;
      }
      break;
    }
    default: {
      const _exhaustive: never = auth.type;
      throw new Error(`未知认证类型: ${String(_exhaustive)}`);
    }
  }

  return headers;
}

/** 构建 Route 实例 */
export function createRoute(options: RouteBuilderOptions, transport: Transport): Route {
  return {
    id: options.id,
    provider: options.provider,
    protocol: options.protocol ?? "http",
    endpoint: options.endpoint,
    auth: options.auth,
    transport,
    body: options.body,
    method: options.method ?? "POST",
    requestMethod: options.requestMethod,
    model: options.model,
    timeoutMs: options.timeoutMs,
  };
}
