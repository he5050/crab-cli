/**
 * 声明式重试策略 — 为 LLM 调用提供可配置的重试机制。
 *
 * 职责:
 *   - 定义 RetryPolicy 接口（声明式重试策略）
 *   - 实现指数退避算法（2s → 4s → 8s → ... → 30s）
 *   - 解析 retry-after / retry-after-ms HTTP 头
 *   - 判断错误是否应重试（5xx / 429 重试，ContextOverflow 不重试）
 *   - 提供高阶函数 retryWithBackoff 包装
 *
 * 使用场景:
 *   - LLM streamLlm 中集成重试策略
 *   - HTTP 请求的自动重试
 *   - 限流（429）和服务端错误（5xx）的自动恢复
 *
 * 边界:
 *   1. 与现有 utils/retry.ts 互补：本模块面向 LLM 调用，支持 retry-after 头
 *   2. 保留现有熔断器 + 降级探测作为兜底
 *   3. ContextOverflow（上下文溢出）不重试，因为重试也会溢出
 *
 * 流程:
 *   1. 调用 fn()
 *   2. 失败时调用 shouldRetry(error, attempt) 判断是否重试
 *   3. 解析 retry-after 头获取服务端建议的等待时间
 *   4. 使用指数退避计算延迟（取 retry-after 和退避中的较大值）
 *   5. 等待后重试，直到 maxRetries 耗尽
 */

import { createLogger } from "@/core/logging/logger";
import { extractHttpStatus } from "./errorHandler";

const log = createLogger("llm:retry");

/** 重试条件类型 */
export type RetryCondition = "server-error" | "rate-limit" | "network-error" | "timeout" | "custom";

/** RetryPolicy 接口 — 声明式重试策略 */
export interface RetryPolicy {
  /** 最大重试次数（不含首次调用） */
  maxRetries: number;
  /** 基础延迟（毫秒），首次重试使用此值 */
  baseDelay: number;
  /** 最大延迟上限（毫秒） */
  maxDelay: number;
  /** 退避因子（默认 2，每次延迟翻倍） */
  backoffFactor?: number;
  /** 是否添加随机抖动（默认 true） */
  jitter?: boolean;
  /** 重试条件列表 */
  retryOn: RetryCondition[];
  /** 自定义重试判断函数（优先于 retryOn） */
  retryOnFn?: (error: unknown, attempt: number) => boolean;
  /** 重试前回调（用于日志或监控） */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

/** 默认重试策略 — 指数退避: 2s → 4s → 8s → ... → 30s */
export const defaultRetryPolicy: RetryPolicy = {
  maxRetries: 3,
  baseDelay: 2000,
  maxDelay: 30000,
  backoffFactor: 2,
  jitter: true,
  retryOn: ["server-error", "rate-limit", "network-error", "timeout"],
};

/** 限流专用重试策略 — 更长延迟，更多重试 */
export const rateLimitRetryPolicy: RetryPolicy = {
  maxRetries: 5,
  baseDelay: 5000,
  maxDelay: 60000,
  backoffFactor: 2,
  jitter: true,
  retryOn: ["rate-limit", "server-error"],
};

/** 保守重试策略 — 仅重试网络错误 */
export const conservativeRetryPolicy: RetryPolicy = {
  maxRetries: 2,
  baseDelay: 1000,
  maxDelay: 10000,
  backoffFactor: 2,
  jitter: true,
  retryOn: ["network-error"],
};

/**
 * 解析 retry-after / retry-after-ms HTTP 头。
 *
 * 支持格式:
 *   - retry-after-ms: 5000（毫秒，优先级最高）
 *   - retry-after: 30（秒）
 *   - retry-after: Wed, 21 Oct 2025 07:28:00 GMT（HTTP 日期）
 *
 * @returns 等待毫秒数，无法解析时返回 undefined
 */
export function parseRetryAfter(headers: Record<string, string> | Headers): number | undefined {
  const getHeader = (name: string): string | undefined => {
    if (headers instanceof Headers) {
      return headers.get(name) ?? undefined;
    }
    // 大小写不敏感查找
    const lower = name.toLowerCase();
    const key = Object.keys(headers).find((k) => k.toLowerCase() === lower);
    return key ? headers[key] : undefined;
  };

  // 优先解析 retry-after-ms（毫秒精度）
  const retryAfterMs = getHeader("retry-after-ms");
  if (retryAfterMs) {
    const ms = Number(retryAfterMs);
    if (Number.isFinite(ms) && ms >= 0) {
      return ms;
    }
  }

  // 解析 retry-after（秒或 HTTP 日期）
  const retryAfter = getHeader("retry-after");
  if (retryAfter) {
    // 尝试解析为数字（秒）
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }

    // 尝试解析为 HTTP 日期
    const date = new Date(retryAfter);
    if (!Number.isNaN(date.getTime())) {
      const diff = date.getTime() - Date.now();
      return Math.max(0, diff);
    }
  }

  return undefined;
}

/** ContextOverflow 错误关键词 */
const CONTEXT_OVERFLOW_KEYWORDS = [
  "context overflow",
  "context length",
  "context window",
  "maximum context",
  "token limit exceeded",
  "context_length_exceeded",
  "prompt is too long",
] as const;

/** 判断错误是否为 ContextOverflow（上下文溢出） */
export function isContextOverflow(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const msg = error.message.toLowerCase();
  return CONTEXT_OVERFLOW_KEYWORDS.some((kw) => msg.includes(kw));
}

/**
 * 判断错误是否应该重试。
 *
 * 重试规则:
 *   - 5xx 服务端错误 → 重试
 *   - 429 限流 → 重试
 *   - 网络错误 → 重试
 *   - 超时 → 重试
 *   - ContextOverflow → 不重试
 *   - 401/403 认证错误 → 不重试
 *   - 其他 4xx → 不重试
 */
export function shouldRetry(error: unknown, attempt: number, policy: RetryPolicy = defaultRetryPolicy): boolean {
  // 自定义判断函数优先
  if (policy.retryOnFn) {
    return policy.retryOnFn(error, attempt);
  }

  // ContextOverflow 不重试
  if (isContextOverflow(error)) {
    log.debug(`ContextOverflow 错误，不重试`, { attempt });
    return false;
  }

  const status = extractHttpStatus(error);
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  // 429 限流
  if (status === 429) {
    return policy.retryOn.includes("rate-limit");
  }

  // 5xx 服务端错误
  if (status !== undefined && status >= 500 && status < 600) {
    return policy.retryOn.includes("server-error");
  }

  // 401/403 认证错误不重试
  if (status === 401 || status === 403) {
    return false;
  }

  // 其他 4xx 不重试
  if (status !== undefined && status >= 400 && status < 500) {
    return false;
  }

  // 网络错误
  if (
    policy.retryOn.includes("network-error") &&
    (msg.includes("econnrefused") ||
      msg.includes("enotfound") ||
      msg.includes("fetch failed") ||
      msg.includes("network"))
  ) {
    return true;
  }

  // 超时
  if (policy.retryOn.includes("timeout") && (msg.includes("timeout") || msg.includes("流式超时"))) {
    return true;
  }

  return false;
}

/**
 * 计算指数退避延迟。
 * 2s → 4s → 8s → 16s → 30s（上限）
 */
export function calculateBackoffDelay(attempt: number, policy: RetryPolicy = defaultRetryPolicy): number {
  const factor = policy.backoffFactor ?? 2;
  const baseDelay = Math.min(policy.baseDelay * factor ** attempt, policy.maxDelay);

  if (policy.jitter === false) {
    return baseDelay;
  }

  // 添加 ±25% 随机抖动
  const jitterFactor = 0.75 + Math.random() * 0.5;
  return Math.round(baseDelay * jitterFactor);
}

/**
 * 睡眠指定毫秒数，支持提前取消。
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
  });
}

/** 重试结果 */
export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: unknown;
  attempts: number;
  totalDelayMs: number;
}

/**
 * 高阶函数 — 使用声明式重试策略包装异步操作。
 *
 * @param fn 要执行的异步操作
 * @param policy 重试策略
 * @param abortSignal 外部中止信号
 * @returns 重试结果
 *
 * @example
 * ```typescript
 * const result = await retryWithBackoff(
 *   async () => await fetchApi(url),
 *   defaultRetryPolicy,
 *   abortSignal,
 * );
 * if (result.success) {
 *   console.log(result.result);
 * }
 * ```
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy = defaultRetryPolicy,
  abortSignal?: AbortSignal,
): Promise<RetryResult<T>> {
  let lastError: unknown;
  let totalDelayMs = 0;

  for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
    // 检查中止信号
    if (abortSignal?.aborted) {
      return {
        attempts: attempt,
        error: new Error("操作已中止"),
        success: false,
        totalDelayMs,
      };
    }

    try {
      const result = await fn();

      if (attempt > 0) {
        log.debug(`重试成功`, {
          attempt: attempt + 1,
          eventType: "llm.retry.success",
          totalDelayMs,
        });
      }

      return {
        attempts: attempt + 1,
        result,
        success: true,
        totalDelayMs,
      };
    } catch (error) {
      lastError = error;

      // 最后一次尝试失败
      if (attempt >= policy.maxRetries) {
        log.warn(`重试耗尽`, {
          attempt: attempt + 1,
          error: error instanceof Error ? error.message : String(error),
          eventType: "llm.retry.exhausted",
          maxRetries: policy.maxRetries,
          totalDelayMs,
        });
        return {
          attempts: attempt + 1,
          error: lastError,
          success: false,
          totalDelayMs,
        };
      }

      // 判断是否应该重试
      if (!shouldRetry(error, attempt, policy)) {
        log.debug(`错误不可恢复，停止重试`, {
          attempt: attempt + 1,
          error: error instanceof Error ? error.message : String(error),
          eventType: "llm.retry.non-recoverable",
        });
        return {
          attempts: attempt + 1,
          error: lastError,
          success: false,
          totalDelayMs,
        };
      }

      // 计算延迟：取退避延迟和 retry-after 中的较大值
      let delayMs = calculateBackoffDelay(attempt, policy);

      // 尝试从错误中提取 retry-after 头
      const errorAny = error as unknown as Record<string, unknown>;
      const responseHeaders = errorAny?.responseHeaders ?? errorAny?.headers;
      if (responseHeaders && typeof responseHeaders === "object") {
        const retryAfterMs = parseRetryAfter(responseHeaders as Record<string, string>);
        if (retryAfterMs !== undefined && retryAfterMs > delayMs) {
          delayMs = retryAfterMs;
        }
      }

      totalDelayMs += delayMs;

      // 重试前回调
      policy.onRetry?.(error, attempt + 1, delayMs);

      log.info(`准备重试 LLM 调用`, {
        attempt: attempt + 1,
        delayMs,
        error: error instanceof Error ? error.message : String(error),
        eventType: "llm.retry.scheduled",
        maxRetries: policy.maxRetries,
      });

      await sleep(delayMs, abortSignal);
    }
  }

  // 理论上不会到达
  return {
    attempts: policy.maxRetries + 1,
    error: lastError,
    success: false,
    totalDelayMs,
  };
}

/**
 * 创建可重用的重试包装器。
 *
 * @param policy 重试策略
 * @returns 包装后的异步函数
 */
export function createRetryWrapper<A extends unknown[], T>(
  fn: (...args: A) => Promise<T>,
  policy: RetryPolicy = defaultRetryPolicy,
): (...args: A) => Promise<RetryResult<T>> {
  return async (...args: A) => retryWithBackoff(() => fn(...args), policy);
}
