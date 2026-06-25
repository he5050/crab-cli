/**
 * 指数退避重试工具 — 为网络请求提供智能重试策略。
 *
 * 职责:
 *   - 实现指数退避算法（Exponential Backoff）
 *   - 支持可配置的初始延迟、最大延迟、最大重试次数
 *   - 仅对可恢复错误进行重试
 *   - 添加随机抖动（Jitter）避免雪崩效应
 *
 * 使用场景:
 *   - API 调用失败后的自动重试
 *   - 网络不稳定时的容错处理
 *   - 服务暂时不可用时的等待重试
 *
 * 边界:
 *   1. 仅重试可恢复错误（network、timeout、5xx）
 *   2. 不重试认证错误（401/403）和业务逻辑错误
 *   3. 最大重试次数默认 3 次
 *   4. 初始延迟默认 1 秒，最大延迟默认 30 秒
 */

import { createLogger } from "@/core/logging/logger";
import { isRecoverableError } from "../core/errorHandler";

const log = createLogger("retry");

export interface RetryOptions {
  /** 最大重试次数（默认 3） */
  maxRetries?: number;
  /** 初始延迟毫秒数（默认 1000） */
  initialDelayMs?: number;
  /** 最大延迟毫秒数（默认 30000） */
  maxDelayMs?: number;
  /** 退避因子（默认 2，即每次延迟翻倍） */
  backoffFactor?: number;
  /** 是否添加随机抖动（默认 true） */
  jitter?: boolean;
  /** 自定义重试判断函数（可选） */
  shouldRetry?: (error: Error, attempt: number) => boolean;
  /** 重试前回调（可选，用于日志或监控） */
  onRetry?: (error: Error, attempt: number, delayMs: number) => void;
  /** 外部中止信号（可选，用于在等待期间提前取消） */
  abortSignal?: AbortSignal;
}

export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: number;
  totalDelayMs: number;
}

/**
 * 计算带抖动的延迟时间。
 *
 * @param baseDelay 基础延迟时间
 * @param jitter 是否添加随机抖动
 * @returns 实际延迟时间
 */
function calculateDelay(baseDelay: number, jitter: boolean = true): number {
  if (!jitter) {
    return baseDelay;
  }

  // 添加 ±25% 的随机抖动，避免多个客户端同时重试导致雪崩
  const jitterFactor = 0.75 + Math.random() * 0.5; // [0.75, 1.25]
  return Math.round(baseDelay * jitterFactor);
}

/**
 * 睡眠指定毫秒数，支持提前取消。
 * 若 abortSignal 在等待期间触发，立即返回而不等待剩余时间。
 */
function sleep(ms: number, abortSignal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (abortSignal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    abortSignal?.addEventListener("abort", onAbort, { once: true });
    // 注意: timer 到达后 listener 仍会残留，但不影响行为
    // 若 Timer 先触发，abort listener 将在 GC 时自动回收
  });
}

/**
 * 执行带指数退避重试的异步操作。
 *
 * @param operation 要执行的异步操作
 * @param options 重试配置选项
 * @returns 操作结果
 *
 * @example
 * ```typescript
 * const result = await retryWithBackoff(
 *   async () => await fetchApi(url),
 *   {
 *     maxRetries: 3,
 *     initialDelayMs: 1000,
 *     onRetry: (err, attempt, delay) => {
 *       console.log(`Retry ${attempt}: ${err.message}, next in ${delay}ms`);
 *     }
 *   }
 * );
 *
 * if (result.success) {
 *   console.log('Success:', result.result);
 * } else {
 *   console.error('Failed after', result.attempts, 'attempts');
 * }
 * ```
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<RetryResult<T>> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 30000,
    backoffFactor = 2,
    jitter = true,
    shouldRetry,
    onRetry,
  } = options;

  let lastError: Error | undefined;
  let totalDelayMs = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await operation();

      // 首次尝试成功
      if (attempt === 0) {
        return {
          attempts: 1,
          result,
          success: true,
          totalDelayMs: 0,
        };
      }

      // 重试后成功
      log.debug(`重试成功`, {
        attempt: attempt + 1,
        eventType: "retry.success",
        totalAttempts: attempt + 1,
        totalDelayMs,
      });

      return {
        attempts: attempt + 1,
        result,
        success: true,
        totalDelayMs,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // 最后一次尝试失败，直接返回错误
      if (attempt >= maxRetries) {
        log.warn(`重试耗尽`, {
          attempt: attempt + 1,
          error: lastError.message,
          eventType: "retry.exhausted",
          maxRetries,
          totalDelayMs,
        });

        return {
          attempts: attempt + 1,
          error: lastError,
          success: false,
          totalDelayMs,
        };
      }

      // 检查是否应该重试
      const customShouldRetry = shouldRetry ?? ((err) => isRecoverableError(err));
      if (!customShouldRetry(lastError, attempt + 1)) {
        log.debug(`错误不可恢复，停止重试`, {
          attempt: attempt + 1,
          error: lastError.message,
          eventType: "retry.non-recoverable",
        });

        return {
          attempts: attempt + 1,
          error: lastError,
          success: false,
          totalDelayMs,
        };
      }

      // 计算下次延迟时间
      const baseDelay = Math.min(initialDelayMs * backoffFactor ** attempt, maxDelayMs);
      const delayMs = calculateDelay(baseDelay, jitter);
      totalDelayMs += delayMs;

      // 调用重试前回调
      onRetry?.(lastError, attempt + 1, delayMs);

      log.info(`准备重试`, {
        attempt: attempt + 1,
        delayMs,
        error: lastError.message,
        eventType: "retry.scheduled",
        maxRetries,
      });

      // 等待后重试
      await sleep(delayMs, options.abortSignal);
    }
  }

  // 理论上不会到达这里
  return {
    attempts: maxRetries + 1,
    error: lastError,
    success: false,
    totalDelayMs,
  };
}

/**
 * 创建可重用的重试包装器。
 *
 * @param options 重试配置选项
 * @returns 包装后的异步函数
 *
 * @example
 * ```typescript
 * const fetchWithRetry = createRetryWrapper(
 *   async (url: string) => await fetch(url),
 *   { maxRetries: 3, initialDelayMs: 500 }
 * );
 *
 * const response = await fetchWithRetry("https://api.example.com/data");
 * ```
 */
export function createRetryWrapper<A extends unknown[], T>(
  operation: (...args: A) => Promise<T>,
  options: RetryOptions = {},
): (...args: A) => Promise<RetryResult<T>> {
  return async (...args: A) => retryWithBackoff(() => operation(...args), options);
}
