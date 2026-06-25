/**
 * Route 模块统一导出。
 *
 * 架构层次:
 *   Route（路由描述） → Endpoint（端点配置） → Transport（传输层） → Executor（执行器）
 *
 * 使用方式:
 *   import { buildRouteFromProvider, executeRoute } from "@/api/route";
 *   const route = buildRouteFromProvider(config, "openai", { modelId: "gpt-4o" });
 *   const result = await executeRoute(route);
 */

export {
  type Route,
  type RouteAuth,
  type RouteBody,
  type AuthType,
  type RouteBuilderOptions,
  createRoute,
  buildAuthHeaders,
} from "./route";

export { type EndpointConfig, buildUrl, mergeHeaders, createEndpoint } from "./endpoint";

export {
  type TransportProtocol,
  type TransportRequest,
  type TransportResponse,
  type Transport,
  type WebSocketTransport,
  HttpTransport,
  defaultHttpTransport,
  createTransport,
} from "./transport";

export { type ExecuteResult, type SseEvent, executeRoute, executeRouteStream } from "./executor";

export { type ProviderRouteOptions, buildRouteFromProvider, isRouteSupported } from "./providerAdapter";
