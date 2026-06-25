/**
 * 熔断器（Circuit Breaker）— 防止持续失败的提供商浪费资源。
 *
 * 状态机:
 *   CLOSED → OPEN: 失败次数达到阈值
 *   OPEN → HALF_OPEN: 恢复超时到期
 *   HALF_OPEN → CLOSED: 探测成功
 *   HALF_OPEN → OPEN: 探测失败，重置超时
 *
 * 使用场景:
 *   - 提供商持续失败时快速失败，避免每次调用都尝试所有降级路径
 *   - 给失败提供商恢复时间，周期性探测
 *
 * 用法:
 *   const breaker = new CircuitBreaker({ threshold: 5, timeoutMs: 60000 });
 *   breaker.recordSuccess();
 *   breaker.recordFailure();
 *   if (breaker.isOpen()) { // 跳过或快速失败
 */

export interface CircuitBreakerOptions {
  /** 触发熔断的失败次数阈值（默认 5） */
  threshold?: number;
  /** 熔断后等待多久再探测（默认 60000ms） */
  timeoutMs?: number;
  /** 半开状态下允许的最大探测请求数（默认 1） */
  halfOpenMaxAttempts?: number;
}

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failureCount = 0;
  private lastFailureTime = 0;
  private successCountInHalfOpen = 0;
  private readonly threshold: number;
  private readonly timeoutMs: number;
  private readonly halfOpenMaxAttempts: number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.threshold = options.threshold ?? 5;
    this.timeoutMs = options.timeoutMs ?? 60000;
    this.halfOpenMaxAttempts = options.halfOpenMaxAttempts ?? 1;
  }

  /** 获取当前状态 */
  getState(): CircuitState {
    // 自动检查是否应该从 OPEN 转为 HALF_OPEN
    if (this.state === "OPEN" && Date.now() - this.lastFailureTime >= this.timeoutMs) {
      this.state = "HALF_OPEN";
      this.successCountInHalfOpen = 0;
    }
    return this.state;
  }

  /** 是否处于 OPEN 状态（应跳过调用） */
  isOpen(): boolean {
    return this.getState() === "OPEN";
  }

  /** 记录成功 */
  recordSuccess(): void {
    if (this.state === "HALF_OPEN") {
      this.successCountInHalfOpen++;
      if (this.successCountInHalfOpen >= this.halfOpenMaxAttempts) {
        this.state = "CLOSED";
        this.failureCount = 0;
      }
    } else {
      this.failureCount = 0;
    }
  }

  /** 记录失败 */
  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === "HALF_OPEN") {
      // 半开状态探测失败，回到 OPEN
      this.state = "OPEN";
    } else if (this.failureCount >= this.threshold) {
      this.state = "OPEN";
    }
  }

  /** 获取统计信息（用于调试） */
  getStats(): {
    state: CircuitState;
    failureCount: number;
    lastFailureTime: number;
    timeUntilRetryMs: number;
  } {
    const state = this.getState();
    const timeUntilRetryMs = state === "OPEN" ? Math.max(0, this.timeoutMs - (Date.now() - this.lastFailureTime)) : 0;
    return {
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      state,
      timeUntilRetryMs,
    };
  }

  /** 重置为初始状态 */
  reset(): void {
    this.state = "CLOSED";
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.successCountInHalfOpen = 0;
  }
}

/** 按 (providerId, modelId) 维护熔断器 */
const breakers = new Map<string, CircuitBreaker>();
/** 熔断器注册表上限，防止无界增长 */
const MAX_BREAKERS = 1000;

function makeKey(providerId: string, modelId?: string): string {
  return modelId ? `${providerId}/${modelId}` : providerId;
}

export function getCircuitBreaker(providerId: string, modelId?: string): CircuitBreaker {
  const key = makeKey(providerId, modelId);
  let breaker = breakers.get(key);
  if (!breaker) {
    // 防止无界增长：超出上限时淘汰最早注册的条目
    if (breakers.size >= MAX_BREAKERS) {
      const oldestKey = breakers.keys().next().value;
      if (oldestKey !== undefined) {
        breakers.delete(oldestKey);
      }
    }
    breaker = new CircuitBreaker();
    breakers.set(key, breaker);
  }
  return breaker;
}

export function clearCircuitBreakers(): void {
  breakers.clear();
}

/**
 * 在熔断器保护下执行异步生成器。
 * 如果熔断器打开则抛出快速失败错误。
 */
export async function* withCircuitBreaker<T>(
  breaker: CircuitBreaker,
  genFactory: () => AsyncGenerator<T>,
  options?: { providerId?: string; modelId?: string },
): AsyncGenerator<T> {
  if (breaker.isOpen()) {
    const stats = breaker.getStats();
    const location = options ? `provider=${options.providerId}, model=${options.modelId}` : "";
    throw new Error(
      `Circuit breaker is OPEN (${location}): state=${stats.state}, failures=${stats.failureCount}, retryIn=${stats.timeUntilRetryMs}ms`,
    );
  }

  try {
    for await (const item of genFactory()) {
      yield item;
    }
    breaker.recordSuccess();
  } catch (error) {
    breaker.recordFailure();
    throw error;
  }
}
