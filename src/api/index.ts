/**
 * API 模块 — 统一出入口
 *
 * 所有外部模块必须通过此文件引用 API 功能，禁止直接引用子目录路径。
 * 内部子模块之间可使用相对路径引用。
 *
 * 模块结构:
 *   - core/          — LLM 引擎、Provider 工厂、错误处理、模型列表
 *   - route/         — Route 抽象层（Route → Endpoint → Transport → Executor）
 *   - stream/        — 流式调用、流中间件、SSE 兼容
 *   - resilience/    — 熔断器、降级探测、健康检查
 *   - specialized/   — Embedding、Rerank
 *   - utils/         — 缓存、请求去重、Token 预算
 */

// ═══════════════════════════════════════════════════════════
// Core — LLM 引擎、Provider、错误处理
// ═══════════════════════════════════════════════════════════
export {
  // Chat 高层接口
  chat,
  chatComplete,
  type ChatResult,
} from "./core/chat";

export {
  // LLM 引擎
  streamLlm,
  completeLlm,
  clearLlmConfigCache,
  type LlmOptions,
  type LlmStreamEvent,
  type LlmTokenUsage,
} from "./core/llm";

export {
  // Provider
  createProvider,
  getProviderConfig,
  getDefaultModelId,
  listConfiguredProviders,
  getProviderModels,
  clearProviderCache,
  resolveRequestMethod,
} from "./core/provider";

export {
  // 错误处理
  toApiAppError,
  extractErrorDetail,
  getFriendlyError,
  isRecoverableError,
  type Locale,
  type ApiErrorType,
  type FriendlyError,
  RECOVERABLE_KEYWORDS,
  NON_RECOVERABLE_KEYWORDS,
  extractHttpStatus,
} from "./core/errorHandler";

// ─── 声明式重试策略（P1-L3）─────────────────────────────────
export {
  defaultRetryPolicy,
  rateLimitRetryPolicy,
  conservativeRetryPolicy,
  parseRetryAfter,
  shouldRetry,
  isContextOverflow,
  calculateBackoffDelay,
  retryWithBackoff as retryWithPolicy,
  createRetryWrapper as createPolicyRetryWrapper,
  type RetryPolicy,
  type RetryCondition,
  type RetryResult as PolicyRetryResult,
} from "./core/retry";

// ─── Token 成本精确计算（P1-L4）─────────────────────────────
export {
  calculateCost,
  createCostAccumulator,
  accumulateUsageDecimal,
  type PricingTable,
  type CostUsage,
  type CostBreakdown,
  type AccumulatedCost,
} from "./core/cost";

// ─── LLM 缓存策略（P2-L5）───────────────────────────────────
export {
  defaultCachePolicy,
  shouldCache,
  shouldCacheSystemPrompt,
  shouldCacheTools,
  buildCacheControl,
  buildSystemPromptWithCache,
  buildToolsCacheOptions,
  resolveCachePolicy,
  type CachePolicy,
  type CacheStrategy,
  type CacheControlParam,
} from "./core/cachePolicy";

// ─── 模型注册表（直接从 modelRegistry 导入） ──────────────────
export {
  listAllModels,
  listModelsByProvider,
  getDefaultModel,
  searchModels,
  getModelCapabilities,
  type ModelInfo,
  type ModelInfoWithCapabilities,
  type ModelCapabilities,
} from "./core/modelRegistry";

// ═══════════════════════════════════════════════════════════
// Stream — 流式处理
// ═══════════════════════════════════════════════════════════
export { doStreamCall } from "./stream/streamHandler";

export { resolveStreamRuntime, type StreamRuntime } from "./stream/visionRouter";

export {
  type StreamEventType,
  type StreamMiddlewareContext,
  type StreamMiddleware,
  StreamMiddlewarePipeline,
  getGlobalMiddlewarePipeline,
  wrapStreamWithMiddleware,
  createSensitiveWordFilter,
  createEventLogger,
  createEventCounter,
  clearGlobalMiddlewarePipeline,
} from "./stream/streamMiddleware";

export { _sseCompat } from "./stream/sseCompat";

// ─── @internal 测试覆写支持（禁止在生产代码中使用） ──────────
/** @internal */
export { _setStreamTextForTesting, _resetStreamTextForTesting } from "./stream/streamHandler";
/** @internal */
export { _compatForTesting } from "./core/provider";
/** @internal */
export { __setFallbackDepsForTesting, __resetFallbackDepsForTesting } from "./resilience/fallback";
/** @internal */
export { __setLlmDepsForTesting, __resetLlmDepsForTesting } from "./core/llm";

// ─── 公开工具函数（供上层模块使用） ───────────────────────────
export { withCircuitBreaker } from "./resilience/circuitBreaker";

export {
  withCircuitBreakerEffect,
  wrapStreamWithCircuitBreakerEffect,
  shouldUseEffectCircuitBreaker,
  CircuitBreakerOpenError,
} from "./resilience/circuitBreakerEffect";
export { classifyError } from "./core/errorHandler";

// ─── Token 估算工具 ────────────────────────────────────────────
export { estimateTextTokens, estimateMessageTokens, estimateMessagesTokens } from "./utils/tokenEstimator";

// ═══════════════════════════════════════════════════════════
// Resilience — 容错与弹性
// ═══════════════════════════════════════════════════════════
export {
  CircuitBreaker,
  getCircuitBreaker,
  clearCircuitBreakers,
  type CircuitBreakerOptions,
  type CircuitState,
} from "./resilience/circuitBreaker";

export {
  getVerifiedMethod,
  probeFallback,
  setVerifiedMethod,
  clearVerifiedMethods,
  cleanupExpiredVerifiedMethods,
  getFallbackChain,
  getProbeTimeout,
  stopCleanup as stopFallbackCleanup,
} from "./resilience/fallback";

export { stopFallbackCacheCleanup } from "./resilience/fallbackCache";

export { checkProviderHealth, checkAllProvidersHealth, type ProviderHealth } from "./resilience/providerHealth";

// ═══════════════════════════════════════════════════════════
// Specialized — 专用 API
// ═══════════════════════════════════════════════════════════
export {
  EMBEDDING_PROVIDER_DEFAULTS,
  embedTexts,
  embedText,
  getEmbeddingConfig,
  getEmbeddingConfigForProvider,
  createEmbeddingModel,
  type NormalizedEmbeddingConfig,
  type EmbeddingOptions,
  type EmbeddingResult,
} from "./specialized/embedding";

export {
  rerank,
  fitDocumentsToContext,
  type RerankRequest,
  type RerankResultItem,
  type RerankResult,
  type FitDocumentsOptions,
  type FitDocumentsResult,
  type FittedDocument,
} from "./specialized/rerank";

// ═══════════════════════════════════════════════════════════
// Utils — 通用工具
// ═══════════════════════════════════════════════════════════
export {
  Cache,
  getOrCreateCache,
  clearAllCaches,
  removeCache,
  getCache,
  type CacheEntry,
  type CacheStats,
  type CacheOptions,
} from "./utils/cache";

export { withRequestDedup, cleanupResultCache, clearRequestDedup, getRequestDedupStats } from "./utils/requestDedup";
export { stopDedupCleanup } from "./utils/requestDedup";

export { fetchWithTimeout, type FetchWithTimeoutOptions } from "./utils/fetchTimeout";

export {
  TokenBudgetController,
  getOrCreateBudget,
  getBudget,
  clearAllBudgets,
  removeBudget,
  createBudgetMiddleware,
  type TokenUsage,
  type TokenBudgetOptions,
  type BudgetState,
} from "./utils/tokenBudget";

export { retryWithBackoff, createRetryWrapper, type RetryOptions, type RetryResult } from "./utils/retry";

// ═══════════════════════════════════════════════════════════
// Providers — 扩展 Provider 适配器
// ═══════════════════════════════════════════════════════════
export {
  OPENROUTER_DEFAULTS,
  createOpenRouterConfig,
  fetchOpenRouterModels,
  AZURE_API_VERSION,
  AZURE_DEFAULTS,
  buildAzureBaseURL,
  buildAzureRequestPath,
  buildAzureAuthHeaders,
  createAzureConfig,
  BEDROCK_DEFAULTS,
  BEDROCK_MODELS,
  signSigV4,
  buildBedrockUrl,
  createBedrockConfig,
  type AwsCredentials,
  XAI_DEFAULTS,
  XAI_MODELS,
  createXaiConfig,
  COPILOT_OAUTH_CONFIG,
  COPILOT_DEFAULTS,
  COPILOT_MODELS,
  requestDeviceCode,
  pollForToken,
  getCopilotToken,
  exchangeCopilotToken,
  createCopilotConfig,
  EXTENDED_PROVIDERS,
  type ExtendedProviderMeta,
} from "./providers";

// ═══════════════════════════════════════════════════════════
// Auth — 认证链与 OAuth
// ═══════════════════════════════════════════════════════════
export {
  AuthChain,
  getGlobalAuthChain,
  resetGlobalAuthChain,
  resolveAuthHeaders,
  isAuthExpired,
  readProviderAuth,
  writeProviderAuth,
  removeProviderAuth,
  isTokenExpired,
  refreshProviderToken,
  getValidAccessToken,
  generatePkcePair,
  generateState,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  startOAuthFlow,
  type AuthInfo,
  type AuthProvider,
  type ProviderOAuthToken,
  type ProviderOAuthConfig,
  type PkcePair,
} from "./auth";

// ═══════════════════════════════════════════════════════════
// Route — Route 抽象层（P1-L2）
// ═══════════════════════════════════════════════════════════
export {
  type Route,
  type RouteAuth,
  type RouteBody,
  type AuthType,
  type RouteBuilderOptions,
  createRoute,
  buildAuthHeaders,
  type EndpointConfig,
  buildUrl,
  mergeHeaders,
  createEndpoint,
  type TransportProtocol,
  type TransportRequest,
  type TransportResponse,
  type Transport,
  type WebSocketTransport,
  HttpTransport,
  defaultHttpTransport,
  createTransport,
  type ExecuteResult,
  type SseEvent,
  executeRoute,
  executeRouteStream,
  type ProviderRouteOptions,
  buildRouteFromProvider,
  isRouteSupported,
} from "./route";
