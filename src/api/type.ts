/**
 * API 模块纯类型导出桶 — 专为 tree-shaking 优化。
 *
 * 存在理由:
 *   消费方仅需类型时，从此文件导入可确保打包工具将整个 import 标记为
 *   type-only，从而在产物中完全消除 API 模块的运行时代码。
 *   若直接从 index.ts 导入类型，部分打包器可能因 index.ts 同时导出
 *   运行时函数而保留不必要的代码。
 *
 * 所有类型定义的 canonical source 仍在各子模块中，本文件仅做 re-export。
 */

export type { LlmOptions, LlmStreamEvent, LlmTokenUsage, LlmEventCallback, LlmEvent } from "./core/llm";

export type { ModelInfo, ModelInfoWithCapabilities, ModelCapabilities } from "./core/modelRegistry";

export type { Locale, ApiErrorType, FriendlyError, ErrorClassification, ApiErrorContext } from "./core/errorHandler";

export type { StreamEventType, StreamMiddlewareContext, StreamMiddleware } from "./stream/streamMiddleware";

export type { StreamRuntime } from "./stream/visionRouter";

export type { CircuitBreakerOptions, CircuitState } from "./resilience/circuitBreaker";

export type { ProviderHealth } from "./resilience/providerHealth";

export type { NormalizedEmbeddingConfig, EmbeddingOptions, EmbeddingResult } from "./specialized/embedding";

export type {
  RerankRequest,
  RerankResultItem,
  RerankResult,
  FitDocumentsOptions,
  FitDocumentsResult,
  FittedDocument,
} from "./specialized/rerank";

export type { CacheEntry, CacheStats, CacheOptions } from "./utils/cache";

export type { TokenUsage, TokenBudgetOptions, BudgetState } from "./utils/tokenBudget";

export type { RetryOptions, RetryResult } from "./utils/retry";

export type { RetryPolicy, RetryCondition, RetryResult as PolicyRetryResult } from "./core/retry";

export type { PricingTable, CostUsage, CostBreakdown, AccumulatedCost } from "./core/cost";

export type {
  Route,
  RouteAuth,
  RouteBody,
  AuthType,
  RouteBuilderOptions,
  EndpointConfig,
  TransportProtocol,
  TransportRequest,
  TransportResponse,
  Transport,
  WebSocketTransport,
  ExecuteResult,
  SseEvent,
  ProviderRouteOptions,
} from "./route";

export type { FetchWithTimeoutOptions } from "./utils/fetchTimeout";

export type { ChatResult } from "./core/chat";
