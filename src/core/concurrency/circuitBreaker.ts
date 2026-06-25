/**
 * 熔断器模式 — 防止级联故障，提升系统稳定性。
 *
 * 职责:
 *   - 监控操作失败率
 *   - 失败率达到阈值时熔断，快速失败
 *   - 熔断后进入半开状态，试探性恢复
 *   - 成功后关闭熔断器，恢复正常
 *
 * 模块功能:
 *   - CircuitBreaker:熔断器类
 *   - CircuitBreakerOpenError:熔断器打开错误
 *   - getCircuitBreaker:获取或创建熔断器
 *   - resetAllCircuitBreakers:重置所有熔断器
 *   - getAllCircuitBreakerStats:获取所有熔断器统计
 *
 * 使用场景:
 *   - 外部 API 调用保护
 *   - 数据库连接保护
 *   - 防止级联故障
 *
 * 边界:
 *   1. 仅监控失败率，不处理业务逻辑
 *   2. 超时时间由配置决定
 *   3. 半开状态下试探请求数有限制（互斥锁保护）
 *
 * 流程:
 *   1. CLOSED:正常状态，监控失败次数
 *   2. OPEN:失败达阈值，快速失败
 *   3. HALF_OPEN:超时后试探性恢复
 *   4. 成功后回到 CLOSED，失败后回到 OPEN
 *
 * 状态转换:
 *   CLOSED ──失败累积──→ OPEN ──超时后──→ HALF_OPEN ──成功──→ CLOSED
 *                         ↑                          └──失败──┘
 */

import { createLogger } from "../logging/logger";

const log = createLogger("circuit-breaker");

/** 熔断器状态 */
type CircuitState = "closed" | "open" | "half-open";

/** 熔断器配置 */
export interface CircuitBreakerConfig {
  /** 失败阈值(连续失败次数)，默认 5 */
  failureThreshold: number;
  /** 熔断后超时时间(毫秒)，默认 30000 */
  timeout: number;
  /** 半开状态下允许的试探请求数，默认 1 */
  halfOpenMaxCalls: number;
  /** 成功阈值(半开状态下连续成功次数)，默认 2 */
  successThreshold: number;
}

/** 默认配置 */
const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  halfOpenMaxCalls: 1,
  successThreshold: 2,
  timeout: 30_000,
};

/** 熔断器统计信息 */
export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime: number | null;
  nextRetryTime: number | null;
}

/**
 * 熔断器类
 */
export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failures = 0;
  private successes = 0;
  private lastFailureTime: number | null = null;
  private halfOpenCalls = 0;
  private config: CircuitBreakerConfig;
  private name: string;
  /** 半开状态互斥锁，防止并发试探请求超过限制 */
  private halfOpenMutex: Promise<void> = Promise.resolve();

  constructor(name: string, config: Partial<CircuitBreakerConfig> = {}) {
    this.name = name;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 执行受保护的操作
   * @param operation 要执行的操作
   * @returns 操作结果
   * @throws CircuitBreakerOpenError 熔断器打开时抛出
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      if (this.shouldAttemptReset()) {
        this.transitionTo("half-open");
      } else {
        const remaining = this.getRemainingTimeout();
        log.warn(`熔断器 [${this.name}] 打开，拒绝请求，${remaining}ms 后重试`);
        throw new CircuitBreakerOpenError(
          `熔断器 [${this.name}] 已打开，请 ${Math.ceil(remaining / 1000)} 秒后再试`,
          remaining,
        );
      }
    }

    if (this.state === "half-open") {
      // 使用互斥锁保护半开状态计数器，防止并发试探超过限制
      // 模式：先抢占新槽位，再等待前一个操作完成，确保串行化
      const previousMutex = this.halfOpenMutex;
      let releaseMutex!: () => void;
      this.halfOpenMutex = new Promise<void>((r) => {
        releaseMutex = r;
      });
      await previousMutex;
      try {
        if (this.halfOpenCalls >= this.config.halfOpenMaxCalls) {
          throw new CircuitBreakerOpenError(`熔断器 [${this.name}] 半开状态，试探请求已满`);
        }
        this.halfOpenCalls++;
      } finally {
        releaseMutex();
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * 同步执行受保护的操作
   */
  executeSync<T>(operation: () => T): T {
    if (this.state === "open") {
      if (this.shouldAttemptReset()) {
        this.transitionTo("half-open");
      } else {
        const remaining = this.getRemainingTimeout();
        log.warn(`熔断器 [${this.name}] 打开，拒绝请求`);
        throw new CircuitBreakerOpenError(
          `熔断器 [${this.name}] 已打开，请 ${Math.ceil(remaining / 1000)} 秒后再试`,
          remaining,
        );
      }
    }

    try {
      const result = operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * 手动强制打开熔断器
   */
  forceOpen(): void {
    this.transitionTo("open");
    this.lastFailureTime = Date.now();
    log.warn(`熔断器 [${this.name}] 被强制打开`);
  }

  /**
   * 手动强制关闭熔断器
   */
  forceClose(): void {
    this.reset();
    this.transitionTo("closed");
    log.info(`熔断器 [${this.name}] 被强制关闭`);
  }

  /**
   * 获取当前状态
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * 获取统计信息
   */
  getStats(): CircuitBreakerStats {
    return {
      failures: this.failures,
      lastFailureTime: this.lastFailureTime,
      nextRetryTime: this.state === "open" ? (this.lastFailureTime ?? 0) + this.config.timeout : null,
      state: this.state,
      successes: this.successes,
    };
  }

  /**
   * 重置熔断器
   */
  reset(): void {
    this.failures = 0;
    this.successes = 0;
    this.halfOpenCalls = 0;
    this.lastFailureTime = null;
  }

  private onSuccess(): void {
    if (this.state === "half-open") {
      this.successes++;
      if (this.successes >= this.config.successThreshold) {
        this.transitionTo("closed");
        this.reset();
        log.info(`熔断器 [${this.name}] 恢复关闭状态`);
      }
    } else {
      this.failures = 0;
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.state === "half-open") {
      this.transitionTo("open");
      log.warn(`熔断器 [${this.name}] 半开状态失败，重新打开`);
    } else if (this.failures >= this.config.failureThreshold) {
      this.transitionTo("open");
      log.warn(`熔断器 [${this.name}] 失败次数达阈值，已打开 (失败 ${this.failures} 次)`);
    }
  }

  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;

    if (newState === "half-open") {
      this.halfOpenCalls = 0;
      this.successes = 0;
    }

    log.debug(`熔断器 [${this.name}] 状态: ${oldState} → ${newState}`);
  }

  private shouldAttemptReset(): boolean {
    if (!this.lastFailureTime) {
      return true;
    }
    return Date.now() - this.lastFailureTime >= this.config.timeout;
  }

  private getRemainingTimeout(): number {
    if (!this.lastFailureTime) {
      return 0;
    }
    const elapsed = Date.now() - this.lastFailureTime;
    return Math.max(0, this.config.timeout - elapsed);
  }
}

/**
 * 熔断器打开错误
 */
export class CircuitBreakerOpenError extends Error {
  readonly remainingTime: number;

  constructor(message: string, remainingTime = 0) {
    super(message);
    this.name = "CircuitBreakerOpenError";
    this.remainingTime = remainingTime;
  }
}

/**
 * 全局熔断器注册表
 */
const circuitBreakers = new Map<string, CircuitBreaker>();

/**
 * 获取或创建熔断器
 */
export function getCircuitBreaker(name: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
  if (!circuitBreakers.has(name)) {
    circuitBreakers.set(name, new CircuitBreaker(name, config));
  }
  return circuitBreakers.get(name)!;
}

/**
 * 重置所有熔断器
 */
export function resetAllCircuitBreakers(): void {
  for (const cb of circuitBreakers.values()) {
    cb.forceClose();
  }
  circuitBreakers.clear();
}

/**
 * 获取所有熔断器统计
 */
export function getAllCircuitBreakerStats(): Record<string, CircuitBreakerStats> {
  const stats: Record<string, CircuitBreakerStats> = {};
  for (const [name, cb] of circuitBreakers) {
    stats[name] = cb.getStats();
  }
  return stats;
}
