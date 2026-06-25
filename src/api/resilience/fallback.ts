/**
 * RequestMethod 自动降级探测引擎。
 *
 * 职责:
 *   - 当默认 requestMethod 请求失败时，按降级链依次探测
 *   - 找到可用方法后回写 config.json 并缓存到内存
 *   - 管理降级探测和并发锁
 *
 * 模块功能:
 *   - probeFallback: 执行降级探测(带并发锁)
 *   - getVerifiedMethod: 获取指定 Provider 已验证可用的 requestMethod
 *   - getFallbackChain: 获取降级链
 *   - getProbeTimeout: 获取探测超时
 *   - FallbackTraceContext: 降级追踪上下文接口
 *
 * 缓存层分离:
 *   - 状态/缓存管理 → fallbackCache.ts
 *   - 探测逻辑/DI/并发锁 → 本文件
 *
 * 使用场景:
 *   - API 请求失败时自动降级
 *   - 模型方法探测
 *   - 配置自动优化
 *
 * 边界:
 *   1. 仅管理降级探测和回写，不修改运行中的 Provider 实例
 *   2. 降级链(按顺序):chat → responses → claude → gemini
 *   3. 探测超时(默认 10s)，避免 provider 挂起时无限阻塞
 *   4. 探测并发锁，同一 provider 同时只运行一次探测
 *
 * 流程:
 *   1. 检测请求失败
 *   2. 启动降级探测
 *   3. 按降级链依次探测
 *   4. 找到可用方法后回写配置
 *   5. 缓存到内存
 *   6. 通知 UI
 */
import { streamText } from "ai";
import { type RequestMethod } from "@/schema/config";
import { FALLBACK_PROBE_TIMEOUT_MS, updateModelRequestMethod } from "@/config";
import { createProvider, getProviderConfig } from "../core/provider";
import type { AppConfigSchema } from "@/schema/config";
import { globalBus, type EventBus } from "@/bus";
import { AppEvent } from "@/bus";
import { createLogger } from "@/core/logging/logger";
import {
  getVerifiedEntry,
  setVerifiedMethod,
  clearVerifiedMethods,
  verifiedKey,
  stopFallbackCacheCleanup,
} from "./fallbackCache";

const log = createLogger("fallback");

const fallbackDeps = Object.defineProperties(
  {} as {
    createProvider: typeof createProvider;
    getProviderConfig: typeof getProviderConfig;
    streamText: typeof streamText;
    updateModelRequestMethod: typeof updateModelRequestMethod;
  },
  {
    createProvider: { value: createProvider, writable: false, configurable: true },
    getProviderConfig: { value: getProviderConfig, writable: false, configurable: true },
    streamText: { value: streamText, writable: false, configurable: true },
    updateModelRequestMethod: { value: updateModelRequestMethod, writable: false, configurable: true },
  },
);

export function __setFallbackDepsForTesting(overrides: Partial<typeof fallbackDeps>): void {
  for (const [key, value] of Object.entries(overrides)) {
    Object.defineProperty(fallbackDeps, key, { value, writable: false, configurable: true });
  }
}

export function __resetFallbackDepsForTesting(): void {
  for (const [key, value] of Object.entries({
    streamText,
    createProvider,
    getProviderConfig,
    updateModelRequestMethod,
  })) {
    Object.defineProperty(fallbackDeps, key, { value, writable: false, configurable: true });
  }
  clearVerifiedMethods();
  probingLocks.clear();
}

/** 默认降级链顺序 */
const DEFAULT_FALLBACK_CHAIN: RequestMethod[] = ["chat", "responses", "claude", "gemini"];

function resolveFallbackChain(config: AppConfigSchema): RequestMethod[] {
  return config.fallbackChain ?? DEFAULT_FALLBACK_CHAIN;
}

/** 默认探测超时(毫秒) */
const DEFAULT_PROBE_TIMEOUT = FALLBACK_PROBE_TIMEOUT_MS;

/** 探测并发锁:providerId → 正在探测的 Promise */
const probingLocks = new Map<string, Promise<RequestMethod | null>>();

export interface FallbackTraceContext {
  requestId?: string;
  turnId?: string;
  sessionId?: string;
  abortSignal?: AbortSignal;
}

export function getVerifiedMethod(config: AppConfigSchema, providerId: string, modelId?: string): RequestMethod {
  if (modelId) {
    const modelScoped = getVerifiedEntry(verifiedKey(providerId, modelId));
    if (modelScoped) {
      return modelScoped.method;
    }
  }

  const providerScoped = getVerifiedEntry(verifiedKey(providerId));
  if (providerScoped) {
    return providerScoped.method;
  }

  const pConfig = fallbackDeps.getProviderConfig(config, providerId);
  if (modelId && pConfig?.modelRequestMethods?.[modelId]) {
    return pConfig.modelRequestMethods[modelId]!;
  }
  return pConfig?.requestMethod ?? "chat";
}

/**
 * 执行降级探测(带并发锁)。
 * 同一 providerId 同时只允许一次探测，后续调用复用首次结果。
 */
export async function probeFallback(
  config: AppConfigSchema,
  providerId: string,
  failedMethod: RequestMethod,
  modelId: string,
  trace: FallbackTraceContext = {},
  eventBus: EventBus = globalBus,
): Promise<RequestMethod | null> {
  // 并发锁:如果已有探测在进行，复用其结果
  const lockKey = `${providerId}:${modelId}`;
  const existing = probingLocks.get(lockKey);
  if (existing) {
    log.debug(`复用已有的降级探测: provider=${providerId}`);
    return existing;
  }

  const probePromise = doProbeFallback(config, providerId, failedMethod, modelId, trace, eventBus);
  probingLocks.set(lockKey, probePromise);

  try {
    return await probePromise;
  } finally {
    probingLocks.delete(lockKey);
  }
}

/**
 * 实际执行降级探测。
 */
async function doProbeFallback(
  config: AppConfigSchema,
  providerId: string,
  failedMethod: RequestMethod,
  modelId: string,
  trace: FallbackTraceContext,
  eventBus: EventBus = globalBus,
): Promise<RequestMethod | null> {
  log.info(`开始降级探测`, {
    eventType: "llm.fallback.start",
    fallbackFrom: failedMethod,
    modelId,
    providerId,
    requestId: trace.requestId,
    sessionId: trace.sessionId,
    turnId: trace.turnId,
  });

  const chain = resolveFallbackChain(config);
  const candidates = chain.filter((m) => m !== failedMethod);

  for (const method of candidates) {
    // 检查中止信号，避免用户中止后继续探测
    if (trace.abortSignal?.aborted) {
      log.info(`降级探测被中止`, {
        eventType: "llm.fallback.aborted",
        fallbackFrom: failedMethod,
        modelId,
        providerId,
        requestId: trace.requestId,
        sessionId: trace.sessionId,
        turnId: trace.turnId,
      });
      return null;
    }

    log.debug(`探测 requestMethod=${method} ...`, {
      eventType: "llm.fallback.probe",
      fallbackFrom: failedMethod,
      fallbackTo: method,
      modelId,
      providerId,
      requestId: trace.requestId,
      sessionId: trace.sessionId,
      turnId: trace.turnId,
    });

    try {
      const success = await probeOnce(config, providerId, method, modelId);
      if (success) {
        log.info(`降级探测成功`, {
          eventType: "llm.fallback.success",
          fallbackFrom: failedMethod,
          fallbackTo: method,
          modelId,
          providerId,
          requestId: trace.requestId,
          sessionId: trace.sessionId,
          success: true,
          turnId: trace.turnId,
        });

        // 1. 回写 config.json
        const persisted = await fallbackDeps.updateModelRequestMethod(providerId, modelId, method);
        if (!persisted) {
          log.warn(`config.json 回写失败，但降级结果已缓存到内存`, {
            eventType: "llm.fallback.persist-warning",
            fallbackTo: method,
            modelId,
            providerId,
            requestId: trace.requestId,
            sessionId: trace.sessionId,
            turnId: trace.turnId,
          });
        }

        // 2. 缓存到内存（带时间戳）
        setVerifiedMethod(providerId, method, modelId);

        // 3. 通知 UI
        eventBus.publish(AppEvent.Log, {
          level: "info",
          message: `Provider ${providerId} 的模型 ${modelId} 自动切换到 ${method} 模式`,
        });

        return method;
      }
    } catch (error) {
      log.debug(`探测 ${method} 失败: ${(error as Error).message}`, {
        eventType: "llm.fallback.probe-failed",
        fallbackTo: method,
        modelId,
        payload: { error: (error as Error).message },
        providerId,
        requestId: trace.requestId,
        sessionId: trace.sessionId,
        turnId: trace.turnId,
      });
    }
  }

  eventBus.publish(AppEvent.Log, {
    level: "error",
    message: `Provider ${providerId} 所有降级方法均失败`,
  });
  log.warn(`降级探测全部失败`, {
    eventType: "llm.fallback.failure",
    fallbackFrom: failedMethod,
    modelId,
    providerId,
    requestId: trace.requestId,
    sessionId: trace.sessionId,
    success: false,
    turnId: trace.turnId,
  });
  return null;
}

/**
 * 用指定 requestMethod 执行一次轻量探测。
 * 发送极简消息("hi"，maxOutputTokens=5)，带超时保护。
 */
async function probeOnce(
  config: AppConfigSchema,
  providerId: string,
  method: RequestMethod,
  modelId: string,
): Promise<boolean> {
  const tempConfig: AppConfigSchema = {
    ...config,
    providerConfig: {
      ...config.providerConfig,
      [providerId]: {
        ...(config.providerConfig[providerId] ?? { requestMethod: method }),
        requestMethod: method,
      },
    },
  };

  const getModel = fallbackDeps.createProvider(tempConfig, providerId, modelId);
  const model = getModel(modelId);

  // 超时控制
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_PROBE_TIMEOUT);

  let result: Awaited<ReturnType<typeof fallbackDeps.streamText>> | undefined;

  try {
    result = fallbackDeps.streamText({
      abortSignal: controller.signal,
      maxOutputTokens: 5,
      messages: [{ content: "hi", role: "user" }],
      model,
    });

    let gotText = false;
    for await (const chunk of result.fullStream) {
      if (chunk.type === "text-delta") {
        if (chunk.text && chunk.text.trim().length > 0) {
          gotText = true;
          break; // 拿到第一个非空文本 chunk 即可确认方法可用
        }
      } else if (chunk.type === "tool-call") {
        if (chunk.toolName) {
          gotText = true; // 工具调用也算成功响应
          break;
        }
      }
    }

    // 必须收到实际内容，空流不算成功
    if (!gotText) {
      log.debug(`probeOnce: ${method} 返回空流，视为不可用`);
      return false;
    }
    return true;
  } finally {
    clearTimeout(timer);
    // 确保流被完全消费，释放底层资源（reader lock、网络连接等）
    if (result?.consumeStream) {
      try {
        await result.consumeStream();
      } catch {
        // consumeStream 失败不影响探测结果
      }
    }
  }
}

// ─── 导出工具函数 ─────────────────────────────────────────────

export { setVerifiedMethod, clearVerifiedMethods, cleanupExpiredVerifiedMethods } from "./fallbackCache";

export function getFallbackChain(config?: AppConfigSchema): RequestMethod[] {
  return config ? [...resolveFallbackChain(config)] : [...DEFAULT_FALLBACK_CHAIN];
}

/** 获取探测超时(供测试覆盖) */
export function getProbeTimeout(): number {
  return DEFAULT_PROBE_TIMEOUT;
}

/** 停止降级探测清理（同时停止 fallbackCache 的清理定时器） */
export function stopCleanup(): void {
  stopFallbackCacheCleanup();
}
