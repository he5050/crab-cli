/**
 * LLM 流式对话引擎 — 统一的 AI 模型调用入口。
 *
 * 职责:
 *   - 封装 streamText 调用
 *   - 通过 EventBus 分发流事件
 *   - 集成 requestMethod 自动降级探测
 *   - 管理 LLM 调用和事件分发
 *
 * 模块功能:
 *   - streamLlm: 流式 LLM 调用
 *   - LlmOptions: LLM 调用选项接口
 *   - LlmStreamEvent: LLM 流事件类型
 *   - ApiMetrics: API 调用性能指标接口
 *   - extractErrorDetail: 提取错误详情
 *   - isRecoverableError: 判断错误是否可恢复
 *   - getFriendlyError: 获取友好错误信息
 *
 * 使用场景:
 *   - AI 对话流式响应
 *   - 工具调用
 *   - 降级处理
 *
 * 边界:
 *   1. 仅负责 LLM 调用和事件分发，不管理对话历史
 *   2. 降级机制:chat → responses → claude → gemini
 *   3. 工具执行策略:仅传递 description + parameters，不传递 execute
 *   4. 默认流式超时 60 秒
 *
 * 流程:
 *   1. 获取 Provider 和模型配置
 *   2. 检查已验证的 requestMethod
 *   3. 调用 streamText 开始流式对话
 *   4. 处理流事件(reasoning、text、tool-call)
 *   5. 发生错误时触发降级探测
 *   6. 完成时返回 usage 统计
 */
import { type ModelMessage, type Tool } from "ai";
import { getDefaultModelId, getProviderModels } from "../core/provider";
import type { AppConfigSchema } from "@/schema/config";
import type { RequestMethod } from "@/schema/config";
import { getVerifiedMethod, probeFallback, setVerifiedMethod } from "../resilience/fallback";
import { getCircuitBreaker, withCircuitBreaker } from "../resilience/circuitBreaker";
import { globalBus, type EventBus } from "@/bus";
import { AppEvent } from "@/bus";
import { createLogger } from "@/core/logging/logger";
import { createId } from "@/core/identity";
import { prefixedId } from "@/core/id";
import { performanceMonitor } from "@monitor";
import { doStreamCall } from "../stream/streamHandler";
import { extractErrorDetail, isRecoverableError, toApiAppError } from "../core/errorHandler";
import { estimateMessagesTokens } from "../utils/tokenEstimator";
import { getValidAccessToken, isTokenExpired, readProviderAuth } from "../auth/oauthStore";
import {
  defaultRetryPolicy,
  retryWithBackoff as retryWithPolicy,
  shouldRetry as shouldRetryWithPolicy,
  type RetryPolicy,
} from "../core/retry";
import {
  buildCacheControl,
  defaultCachePolicy,
  resolveCachePolicy,
  shouldCache,
  type CachePolicy,
} from "../core/cachePolicy";

const log = createLogger("llm");

const llmDeps = Object.defineProperties(
  {} as {
    getDefaultModelId: typeof getDefaultModelId;
    getProviderModels: typeof getProviderModels;
    probeFallback: typeof probeFallback;
    setVerifiedMethod: typeof setVerifiedMethod;
  },
  {
    getDefaultModelId: { value: getDefaultModelId, writable: false, configurable: true },
    getProviderModels: { value: getProviderModels, writable: false, configurable: true },
    probeFallback: { value: probeFallback, writable: false, configurable: true },
    setVerifiedMethod: { value: setVerifiedMethod, writable: false, configurable: true },
  },
);

export function __setLlmDepsForTesting(overrides: Partial<typeof llmDeps>): void {
  for (const [key, value] of Object.entries(overrides)) {
    Object.defineProperty(llmDeps, key, { value, writable: false, configurable: true });
  }
}

export function __resetLlmDepsForTesting(): void {
  for (const [key, value] of Object.entries({
    getDefaultModelId,
    getProviderModels,
    probeFallback,
    setVerifiedMethod,
  })) {
    Object.defineProperty(llmDeps, key, { value, writable: false, configurable: true });
  }
  clearLlmConfigCache();
}

/** LLM 事件回调类型 */
export type LlmEventCallback = (event: LlmEvent) => void;

/** LLM 事件类型 */
export type LlmEvent =
  | {
      type: "provider-status";
      payload: {
        method?: string;
        model?: string;
        provider: string;
        status: "calling" | "success" | "error";
        error?: string;
      };
    }
  | { type: "llm-retry"; payload: { fallbackFrom: string; fallbackTo: string; reason: string; sessionId?: string } };

/** 性能监控回调 */
export interface PerfCallbacks {
  onStart: (id: string, operation: string, metadata: Record<string, unknown>) => void;
  onEnd: (id: string, success: boolean, errorMessage?: string) => void;
}

/** 分发 LLM 事件，优先使用回调函数，否则通过全局事件总线发布。 */
function publishEvent(options: LlmOptions, event: LlmEvent, eventBus: EventBus = globalBus): void {
  if (options.onEvent) {
    options.onEvent(event);
  } else {
    if (event.type === "provider-status") {
      eventBus.publish(AppEvent.ProviderStatus, event.payload);
    } else if (event.type === "llm-retry") {
      eventBus.publish(AppEvent.LlmRetry, event.payload);
    }
  }
}

/** LLM 调用选项 */
export interface LlmOptions {
  /** 系统提示词 */
  system?: string;
  /** 最大 token 数 */
  maxTokens?: number;
  /** 温度 */
  temperature?: number;
  /** TopP */
  topP?: number;
  /** 使用的 Provider ID(不传则使用默认) */
  providerId?: string;
  /** 使用的模型 ID(不传则使用默认) */
  modelId?: string;
  /** 自定义工具集 */
  tools?: Record<string, Tool>;
  /** 流式超时(毫秒)，超时自动中断。默认 60000 */
  timeout?: number;
  /** 外部中止信号 */
  abortSignal?: AbortSignal;
  /** 关联用会话 ID */
  sessionId?: string;
  /** 关联用轮次 ID */
  turnId?: string;
  /** 关联用请求 ID */
  requestId?: string;
  /** 可选的事件回调，提供时替代全局 EventBus */
  onEvent?: LlmEventCallback;
  /** 可选的性能监控回调，提供时替代全局 performanceMonitor */
  perfCallbacks?: PerfCallbacks;
  /** 可选的流片段回调，提供时替代全局 EventBus 的 ChatChunk/ChatReasoning 事件 */
  onChunk?: (event: { type: "text" | "reasoning"; chunk: string }) => void;
  /** 可选的 Token 预算控制器，提供时在调用前做预算预检查 */
  budget?: import("../utils/tokenBudget").TokenBudgetController;
  /** 缓存策略，控制 system prompt 和工具定义的缓存行为。默认 ephemeral */
  cachePolicy?: CachePolicy;
}

/** LLM Token 使用量 */
export interface LlmTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  cachedTokens?: number;
}

/** LLM 流事件 */
export type LlmStreamEvent =
  | { type: "reasoning-delta"; text: string }
  | { type: "text-delta"; text: string }
  | { type: "tool-call"; toolName: string; toolCallId: string; args: unknown }
  | {
      type: "done";
      fullText: string;
      usage?: LlmTokenUsage;
      thinking?: { thinking: string; signature?: string };
      reasoning_content?: string;
    }
  | { type: "error"; error: Error };

/**
 * API 调用性能指标已统一通过 @core/performanceMonitor 收集，
 * 不再需要独立的 setMetricsCallback / getMetricsCallback 旁路。
 * 如需自定义处理，订阅 @core/performanceMonitor 的事件即可。
 */

/**
 * 使用新方法重试 LLM 调用。
 * 从 streamLlm 的 fallback 逻辑中提取，降低 catch 块嵌套深度。
 */
async function* retryWithNewMethod(
  retryConfig: AppConfigSchema,
  providerId: string,
  modelId: string,
  messages: ModelMessage[],
  options: LlmOptions,
  currentMethod: RequestMethod,
  newMethod: RequestMethod,
  eventBus: EventBus,
): AsyncGenerator<LlmStreamEvent> {
  log.info(`使用 ${newMethod} 重试...`, {
    eventType: "llm.request.retry",
    fallbackFrom: currentMethod,
    fallbackTo: newMethod,
    modelId,
    providerId,
    requestId: options.requestId,
    sessionId: options.sessionId,
    turnId: options.turnId,
  });

  publishEvent(
    options,
    {
      type: "provider-status",
      payload: {
        method: newMethod,
        model: modelId,
        provider: providerId,
        status: "calling",
      },
    },
    eventBus,
  );

  try {
    // 降级重试绕过熔断器：主调用失败后应允许尝试不同方法，
    // 否则同一 circuitBreaker 实例因主调用失败而打开时会拒绝重试
    for await (const event of doStreamCall(retryConfig, providerId, modelId, messages, options)) {
      yield event;
    }

    publishEvent(
      options,
      {
        type: "provider-status",
        payload: {
          method: newMethod,
          model: modelId,
          provider: providerId,
          status: "success",
        },
      },
      eventBus,
    );

    log.info(`LLM 重试完成`, {
      eventType: "llm.request.done",
      fallbackFrom: currentMethod,
      fallbackTo: newMethod,
      modelId,
      providerId,
      requestId: options.requestId,
      requestMethod: newMethod,
      sessionId: options.sessionId,
      success: true,
      turnId: options.turnId,
    });
  } catch (retryError) {
    const retryMsg = retryError instanceof Error ? retryError.message : String(retryError);
    log.error(`降级后重试仍然失败: ${retryMsg}`, {
      eventType: "llm.request.retry-failed",
      fallbackFrom: currentMethod,
      fallbackTo: newMethod,
      modelId,
      payload: { error: retryMsg },
      providerId,
      requestId: options.requestId,
      requestMethod: newMethod,
      sessionId: options.sessionId,
      success: false,
      turnId: options.turnId,
    });
    publishEvent(
      options,
      {
        type: "provider-status",
        payload: {
          error: retryMsg,
          method: newMethod,
          model: modelId,
          provider: providerId,
          status: "error",
        },
      },
      eventBus,
    );

    yield {
      error: toApiAppError(retryError, {
        fallbackFrom: currentMethod,
        modelId,
        providerId,
        requestId: options.requestId,
        requestMethod: newMethod,
        sessionId: options.sessionId,
        turnId: options.turnId,
      }),
      type: "error",
    };
  }
}

/**
 * 流式调用 LLM(带自动降级)。
 */
export async function* streamLlm(
  config: AppConfigSchema,
  messages: ModelMessage[],
  options: LlmOptions = {},
  eventBus: EventBus = globalBus,
): AsyncGenerator<LlmStreamEvent> {
  const providerId = options.providerId ?? config.defaultProvider.provider;
  const modelId = options.modelId ?? llmDeps.getDefaultModelId(config, providerId);
  const requestId = options.requestId ?? createId("req");

  // Token 预算预检查：在调用前估算所需 token 并验证预算是否充足
  if (options.budget) {
    const estimatedInputTokens = estimateMessagesTokens(messages);
    // 预留输出 token（通常为输入的 50%-100%，这里保守估计为输入的两倍）
    const estimatedTotalTokens = estimatedInputTokens * 2;

    if (!options.budget.canAllocate(estimatedTotalTokens)) {
      const remaining = options.budget.getRemaining();
      const error = new Error(`Token 预算不足: 预估需要 ${estimatedTotalTokens} tokens，但仅剩 ${remaining} tokens`);
      log.warn(`Token 预算预检查失败`, {
        eventType: "token-budget.exhausted",
        estimatedTotalTokens,
        remaining,
        requestId,
        sessionId: options.sessionId,
      });
      yield { type: "error", error };
      return;
    }
  }

  const availableModels = llmDeps.getProviderModels(config, providerId);
  if (modelId && availableModels.length > 0 && !availableModels.includes(modelId)) {
    log.warn(
      `当前 provider [${providerId}] 不支持模型 "${modelId}"。可用模型: ${availableModels.join(", ")}。请检查配置或更换模型。`,
    );
  }

  // 优先使用已验证的 requestMethod
  const currentMethod = getVerifiedMethod(config, providerId, modelId);
  log.debug(`LLM 调用`, {
    eventType: "llm.request.start",
    modelId,
    providerId,
    requestId,
    requestMethod: currentMethod,
    sessionId: options.sessionId,
    turnId: options.turnId,
  });

  const effectiveConfig = buildEffectiveConfig(config, providerId, modelId, currentMethod);
  log.debug(`构建有效配置完成`, {
    eventType: "llm.config.built",
    hasSystemPrompt: Boolean(options.system),
    messageCount: messages.length,
    modelId,
    providerId,
    requestId,
    requestMethod: currentMethod,
  });

  // 通知 UI 当前调用的 provider/model/method
  publishEvent(
    options,
    {
      type: "provider-status",
      payload: {
        method: currentMethod,
        model: modelId,
        provider: providerId,
        status: "calling",
      },
    },
    eventBus,
  );

  const breaker = getCircuitBreaker(providerId, modelId);
  const cbKey = `${providerId}/${modelId}/${currentMethod}`;

  // 性能监控：可选回调注入，默认使用全局 performanceMonitor
  const perfCallbacks = options.perfCallbacks;
  const perfId = perfCallbacks
    ? prefixedId("perf")
    : performanceMonitor.start("api", "llm.stream", {
        messageCount: messages.length,
        modelId,
        providerId,
        requestMethod: currentMethod,
      });

  if (perfCallbacks) {
    perfCallbacks.onStart(perfId, "llm.stream", {
      messageCount: messages.length,
      modelId,
      providerId,
      requestMethod: currentMethod,
    });
  }

  try {
    for await (const event of withCircuitBreaker(
      breaker,
      () => doStreamCall(effectiveConfig, providerId, modelId, messages, options),
      { modelId, providerId },
    )) {
      yield event;
    }
    publishEvent(
      options,
      {
        type: "provider-status",
        payload: {
          method: currentMethod,
          model: modelId,
          provider: providerId,
          status: "success",
        },
      },
      eventBus,
    );
    if (perfCallbacks) {
      perfCallbacks.onEnd(perfId, true);
    } else {
      performanceMonitor.end(perfId, true);
    }
    log.info(`LLM 调用完成`, {
      eventType: "llm.request.done",
      modelId,
      providerId,
      requestId,
      requestMethod: currentMethod,
      sessionId: options.sessionId,
      success: true,
      turnId: options.turnId,
    });
  } catch (primaryError) {
    // 熔断器快速失败时，记录额外日志
    if (breaker.isOpen()) {
      const stats = breaker.getStats();
      log.warn(`熔断器已打开，跳过调用 (key=${cbKey})`, {
        eventType: "circuit-breaker.open",
        modelId,
        providerId,
        requestId,
        state: stats.state,
        failures: stats.failureCount,
        retryInMs: stats.timeUntilRetryMs,
      });
    }
    const primaryAppError = toApiAppError(primaryError, {
      modelId,
      providerId,
      requestId,
      requestMethod: currentMethod,
      sessionId: options.sessionId,
      turnId: options.turnId,
    });
    const errMsg = primaryError instanceof Error ? primaryError.message : String(primaryError);
    if (perfCallbacks) {
      perfCallbacks.onEnd(perfId, false, errMsg);
    } else {
      performanceMonitor.end(perfId, false, errMsg);
    }
    // 尝试提取更多错误细节(如 API 响应体)
    const errDetail = primaryError instanceof Error ? extractErrorDetail(primaryError) : null;
    const fullMsg = errDetail
      ? `${errMsg} — ${typeof errDetail === "string" ? errDetail : JSON.stringify(errDetail)}`
      : errMsg;
    log.warn(`LLM 调用失败 (method=${currentMethod}): ${fullMsg}`, {
      eventType: "llm.request.failed",
      modelId,
      payload: { error: fullMsg },
      providerId,
      requestId,
      requestMethod: currentMethod,
      sessionId: options.sessionId,
      success: false,
      turnId: options.turnId,
    });

    // ── 声明式重试策略（P1-L3）──
    // 在降级探测之前，先尝试使用重试策略（指数退避 + retry-after 头解析）
    // 保留熔断器 + 降级探测作为兜底
    // 注意：仅在未设置 abortSignal 或 abortSignal 未触发时启用
    if (
      shouldRetryWithPolicy(primaryError, 0, defaultRetryPolicy) &&
      !options.abortSignal?.aborted &&
      !breaker.isOpen()
    ) {
      log.info(`触发声明式重试策略（指数退避）`, {
        eventType: "llm.retry.policy.triggered",
        modelId,
        providerId,
        requestId,
        requestMethod: currentMethod,
      });

      // 使用零延迟重试策略，避免阻塞流式响应
      // 实际延迟由 SDK 内部 maxRetries 处理，此处仅作为额外重试层
      const zeroDelayPolicy: RetryPolicy = {
        ...defaultRetryPolicy,
        maxRetries: 1,
        baseDelay: 0,
        maxDelay: 0,
        jitter: false,
      };

      const retryResult = await retryWithPolicy(
        async () => {
          const events: LlmStreamEvent[] = [];
          for await (const event of withCircuitBreaker(
            breaker,
            () => doStreamCall(effectiveConfig, providerId, modelId, messages, options),
            { modelId, providerId },
          )) {
            events.push(event);
          }
          return events;
        },
        zeroDelayPolicy,
        options.abortSignal,
      );

      if (retryResult.success && retryResult.result) {
        // 重试成功，yield 所有事件
        for (const event of retryResult.result) {
          yield event;
        }
        publishEvent(
          options,
          {
            type: "provider-status",
            payload: {
              method: currentMethod,
              model: modelId,
              provider: providerId,
              status: "success",
            },
          },
          eventBus,
        );
        log.info(`LLM 调用完成（重试成功，共 ${retryResult.attempts} 次尝试）`, {
          eventType: "llm.request.done",
          modelId,
          providerId,
          requestId,
          requestMethod: currentMethod,
          retryAttempts: retryResult.attempts,
          sessionId: options.sessionId,
          success: true,
          turnId: options.turnId,
        });
        return;
      }

      log.warn(`声明式重试策略耗尽，尝试降级探测`, {
        eventType: "llm.retry.policy.exhausted",
        modelId,
        providerId,
        requestId,
        retryAttempts: retryResult.attempts,
        requestMethod: currentMethod,
      });
    }

    if (isRecoverableError(primaryError)) {
      log.info(`触发降级探测...`, {
        eventType: "llm.fallback.triggered",
        fallbackFrom: currentMethod,
        modelId,
        providerId,
        requestId,
        sessionId: options.sessionId,
        turnId: options.turnId,
      });
      const newMethod = await llmDeps.probeFallback(config, providerId, currentMethod, modelId, {
        abortSignal: options.abortSignal,
        requestId,
        sessionId: options.sessionId,
        turnId: options.turnId,
      });

      if (newMethod) {
        // 如果 abortSignal 已触发，跳过重试
        if (options.abortSignal?.aborted) {
          log.warn(`abortSignal 已触发，跳过降级重试`, {
            eventType: "llm.request.retry-skipped",
            requestId,
          });
          throw primaryError;
        }
        if (options.sessionId) {
          publishEvent(
            options,
            {
              type: "llm-retry",
              payload: {
                fallbackFrom: currentMethod,
                fallbackTo: newMethod,
                reason: `llm fallback ${currentMethod} -> ${newMethod}`,
                sessionId: options.sessionId,
              },
            },
            eventBus,
          );
        }
        const retryConfig = buildEffectiveConfig(config, providerId, modelId, newMethod);
        llmDeps.setVerifiedMethod(providerId, newMethod, modelId);

        yield* retryWithNewMethod(
          retryConfig,
          providerId,
          modelId,
          messages,
          options,
          currentMethod,
          newMethod,
          eventBus,
        );
        return;
      }
    }

    publishEvent(
      options,
      {
        type: "provider-status",
        payload: {
          error: fullMsg,
          method: currentMethod,
          model: modelId,
          provider: providerId,
          status: "error",
        },
      },
      eventBus,
    );
    yield {
      error: primaryAppError,
      type: "error",
    };
  }
}

// BuildEffectiveConfig 缓存:按配置对象隔离，避免热更新后误复用旧凭据
let configCache = new WeakMap<AppConfigSchema, Map<string, AppConfigSchema>>();

export function clearLlmConfigCache(): void {
  configCache = new WeakMap();
}

/** 生成有效配置缓存键，由 provider + model + method 三元组组成。 */
function buildEffectiveConfigCacheKey(providerId: string, modelId: string, method: RequestMethod): string {
  return `${providerId}:${modelId}:${method}`;
}

/**
 * 构造使用指定 requestMethod 的临时配置。
 * 带 WeakRef 缓存，避免同一 (providerId, method) 重复展开对象。
 */
function buildEffectiveConfig(
  config: AppConfigSchema,
  providerId: string,
  modelId: string,
  method: RequestMethod,
): AppConfigSchema {
  const key = buildEffectiveConfigCacheKey(providerId, modelId, method);
  let providerScopedCache = configCache.get(config);
  if (!providerScopedCache) {
    providerScopedCache = new Map();
    configCache.set(config, providerScopedCache);
  }

  const cached = providerScopedCache.get(key);
  if (cached) {
    return cached;
  }

  const existing = config.providerConfig[providerId] ?? { requestMethod: method };
  const result: AppConfigSchema = {
    ...config,
    providerConfig: {
      ...config.providerConfig,
      [providerId]: {
        ...existing,
        modelRequestMethods: {
          ...existing.modelRequestMethods,
          [modelId]: method,
        },
        requestMethod: existing.requestMethod ?? method,
      },
    },
  };

  providerScopedCache.set(key, result);
  return result;
}

/**
 * 非流式调用 LLM(等待完整响应)。
 * abortSignal 触发时提前返回已聚合的部分结果。
 */
export async function completeLlm(
  config: AppConfigSchema,
  messages: ModelMessage[],
  options: LlmOptions = {},
): Promise<{ text: string; reasoning?: string; usage?: LlmTokenUsage }> {
  const textParts: string[] = [];
  const reasoningParts: string[] = [];
  let usage: LlmTokenUsage | undefined;

  for await (const event of streamLlm(config, messages, options)) {
    // 支持中途取消：abortSignal 触发时提前返回已聚合的部分结果
    if (options.abortSignal?.aborted) {
      break;
    }
    if (event.type === "text-delta") {
      textParts.push(event.text);
    }
    if (event.type === "reasoning-delta") {
      reasoningParts.push(event.text);
    }
    if (event.type === "done") {
      usage = event.usage;
    }
    if (event.type === "error") {
      throw event.error;
    }
  }

  const text = textParts.join("");
  const reasoning = reasoningParts.join("");
  return {
    reasoning: reasoning || undefined,
    text,
    usage,
  };
}
