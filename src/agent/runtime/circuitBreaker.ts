/**
 * 熔断器服务 (Circuit Breaker)
 *
 * 职责:
 *   - 检测 Agent 陷入死循环(同一错误反复重试)
 *   - 防止 Token 浪费
 *   - 提供强制中断机制
 *
 * 模块功能:
 *   - CircuitBreaker: 熔断器类
 *   - ErrorFingerprint: 错误指纹
 *   - createCircuitBreaker: 创建熔断器实例
 *
 * 使用场景:
 *   - Agent 修复代码失败后反复尝试同一策略
 *   - API 调用持续失败
 *   - 工具执行循环
 *
 * 边界:
 *   1. 每个任务独立熔断器实例
 *   2. 支持可配置阈值
 *   3. 自动重置机制
 *   4. 触发后提供中断回调
 *
 * 流程:
 *   1. 创建熔断器实例
 *   2. 每次错误时调用 recordFailure()
 *   3. 达到阈值时触发熔断
 *   4. 调用回调通知强制中断
 *   5. 超时后自动重置
 */

import { createLogger } from "@/core/logging/logger";
import { CIRCUIT_BREAKER_MAX_HISTORY, CIRCUIT_BREAKER_RESET_TIMEOUT_MS, CIRCUIT_BREAKER_THRESHOLD } from "@/config";

const log = createLogger("agent:circuit-breaker");

export interface ErrorFingerprint {
  hash: string;
  type: string;
  context: string;
  count: number;
  firstOccurrence: number;
  lastOccurrence: number;
}

export interface CircuitBreakerConfig {
  /** 任务 ID */
  taskId: string;
  /** 连续错误阈值(默认 3) */
  threshold?: number;
  /** 重置超时(毫秒，默认 5 分钟) */
  resetTimeoutMs?: number;
  /** 熔断触发回调 */
  onCircuitOpen?: (taskId: string, fingerprint: ErrorFingerprint) => void;
  /** 错误记录回调 */
  onErrorRecorded?: (taskId: string, fingerprint: ErrorFingerprint) => void;
}

export interface CircuitBreakerStats {
  taskId: string;
  isOpen: boolean;
  currentCount: number;
  threshold: number;
  lastError: ErrorFingerprint | null;
  openedAt: number | null;
}

/**
 * 熔断器类
 *
 * 通过错误指纹跟踪同一错误的重复次数，
 * 当超过阈值时触发熔断，防止死循环。
 */
export class CircuitBreaker {
  private readonly taskId: string;
  private readonly threshold: number;
  private readonly resetTimeoutMs: number;
  private onCircuitOpen?: (taskId: string, fingerprint: ErrorFingerprint) => void;
  private onErrorRecorded?: (taskId: string, fingerprint: ErrorFingerprint) => void;

  private errorHistory = new Map<string, ErrorFingerprint>();
  /** 双向链表头(最老) */
  private listHead: string | null = null;
  /** 双向链表尾(最新) */
  private listTail: string | null = null;
  /** 前驱指针 */
  private nodePrev = new Map<string, string>();
  /** 后继指针 */
  private nodeNext = new Map<string, string>();
  private isOpen: boolean = false;
  private openedFingerprint: ErrorFingerprint | null = null;
  private openedAt: number | null = null;
  private resetTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: CircuitBreakerConfig) {
    this.taskId = config.taskId;
    this.threshold = config.threshold ?? CIRCUIT_BREAKER_THRESHOLD;
    this.resetTimeoutMs = config.resetTimeoutMs ?? CIRCUIT_BREAKER_RESET_TIMEOUT_MS;
    this.onCircuitOpen = config.onCircuitOpen;
    this.onErrorRecorded = config.onErrorRecorded;
  }

  /**
   * 记录一次错误
   *
   * @param errorType - 错误类型(如 "SyntaxError", "TypeError")
   * @param context - 错误上下文(如错误信息、文件路径)
   * @returns 是否触发熔断
   */
  recordFailure(errorType: string, context: string): boolean {
    if (this.isOpen) {
      log.debug(`熔断器已打开，忽略错误记录`, { taskId: this.taskId });
      return false;
    }

    const fingerprint = this.generateFingerprint(errorType, context);

    const existing = this.errorHistory.get(fingerprint.hash);
    if (existing) {
      existing.count++;
      existing.lastOccurrence = Date.now();
      fingerprint.count = existing.count;
      fingerprint.firstOccurrence = existing.firstOccurrence;
      this.moveToTail(fingerprint.hash);
    } else {
      fingerprint.count = 1;
      fingerprint.firstOccurrence = Date.now();
      fingerprint.lastOccurrence = Date.now();

      if (this.errorHistory.size >= CIRCUIT_BREAKER_MAX_HISTORY) {
        this.cleanupOldest();
      }
      this.errorHistory.set(fingerprint.hash, fingerprint);
      this.addToTail(fingerprint.hash);
    }

    log.debug(`记录错误`, {
      count: fingerprint.count,
      errorType,
      taskId: this.taskId,
      threshold: this.threshold,
    });

    if (this.onErrorRecorded) {
      try {
        this.onErrorRecorded(this.taskId, fingerprint);
      } catch (error) {
        log.error(`错误记录回调执行失败`, { error, taskId: this.taskId });
      }
    }

    if (fingerprint.count >= this.threshold) {
      return this.triggerCircuitBreak(fingerprint);
    }

    return false;
  }

  /**
   * 记录一次成功，清除指定指纹的历史
   */
  recordSuccess(errorType: string, context: string): void {
    const fingerprint = this.generateFingerprint(errorType, context);
    const existing = this.errorHistory.get(fingerprint.hash);

    if (existing) {
      existing.count = Math.max(0, existing.count - 1);
      log.debug(`成功记录减少错误计数`, {
        errorType,
        newCount: existing.count,
        taskId: this.taskId,
      });

      if (existing.count === 0) {
        this.removeFromList(fingerprint.hash);
        this.errorHistory.delete(fingerprint.hash);
      }
    }
  }

  /**
   * 检查熔断器是否打开
   */
  isCircuitOpen(): boolean {
    return this.isOpen;
  }

  /**
   * 获取熔断器状态
   */
  getStats(): CircuitBreakerStats {
    return {
      currentCount: this.openedFingerprint?.count ?? 0,
      isOpen: this.isOpen,
      lastError: this.openedFingerprint,
      openedAt: this.openedAt,
      taskId: this.taskId,
      threshold: this.threshold,
    };
  }

  /**
   * 获取错误历史
   */
  getErrorHistory(): ErrorFingerprint[] {
    return [...this.errorHistory.values()].toSorted((a, b) => b.count - a.count);
  }

  /**
   * 重置熔断器
   */
  reset(): void {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }

    this.isOpen = false;
    this.openedFingerprint = null;
    this.openedAt = null;
    this.errorHistory.clear();
    this.listHead = null;
    this.listTail = null;
    this.nodePrev.clear();
    this.nodeNext.clear();

    log.info(`熔断器已重置`, { taskId: this.taskId });
  }

  /**
   * 手动触发熔断
   */
  forceOpen(reason?: string): void {
    const fingerprint: ErrorFingerprint = {
      context: "手动触发",
      count: this.threshold,
      firstOccurrence: Date.now(),
      hash: "manual",
      lastOccurrence: Date.now(),
      type: reason ?? "manual",
    };

    this.triggerCircuitBreak(fingerprint);
  }

  /**
   * 销毁熔断器
   */
  destroy(): void {
    this.reset();
    this.onCircuitOpen = undefined;
    this.onErrorRecorded = undefined;
  }

  /**
   * 生成错误指纹
   */
  private generateFingerprint(errorType: string, context: string): ErrorFingerprint {
    const normalizedContext = this.normalizeContext(context);
    const hash = `${errorType}:${normalizedContext}`;

    return {
      context: normalizedContext,
      count: 0,
      firstOccurrence: Date.now(),
      hash,
      lastOccurrence: Date.now(),
      type: errorType,
    };
  }

  /**
   * 规范化上下文，提取关键特征
   */
  private normalizeContext(context: string): string {
    return context
      .replace(/\d+/g, "N")
      .replace(/['"][^'"]*['"]/g, "'X'")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
  }

  /**
   * 触发熔断
   */
  private triggerCircuitBreak(fingerprint: ErrorFingerprint): boolean {
    this.isOpen = true;
    this.openedFingerprint = fingerprint;
    this.openedAt = Date.now();

    log.warn(`熔断器触发！`, {
      count: fingerprint.count,
      errorType: fingerprint.type,
      taskId: this.taskId,
      threshold: this.threshold,
    });

    if (this.onCircuitOpen) {
      try {
        this.onCircuitOpen(this.taskId, fingerprint);
      } catch (error) {
        log.error(`熔断回调执行失败`, { error, taskId: this.taskId });
      }
    }

    this.scheduleReset();

    return true;
  }

  /**
   * 安排自动重置
   */
  private scheduleReset(): void {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
    }

    this.resetTimer = setTimeout(() => {
      log.info(`熔断器自动重置`, { taskId: this.taskId });
      this.reset();
    }, this.resetTimeoutMs);

    if (this.resetTimer.unref) {
      this.resetTimer.unref();
    }
  }

  /**
   * 清理最老的记录 — O(1) 通过双向链表头删除
   */
  private cleanupOldest(): void {
    if (!this.listHead) {
      return;
    }
    const oldest = this.listHead;
    this.removeFromList(oldest);
    this.errorHistory.delete(oldest);
  }

  /** 添加节点到链表尾部 — O(1) */
  private addToTail(hash: string): void {
    if (!this.listHead) {
      this.listHead = hash;
      this.listTail = hash;
      return;
    }
    if (this.listTail) {
      this.nodeNext.set(this.listTail, hash);
      this.nodePrev.set(hash, this.listTail);
    }
    this.listTail = hash;
  }

  /** 从链表中移除节点 — O(1) */
  private removeFromList(hash: string): void {
    const prev = this.nodePrev.get(hash);
    const next = this.nodeNext.get(hash);

    if (prev) {
      this.nodeNext.set(prev, next!);
    } else {
      this.listHead = next ?? null;
    }

    if (next) {
      this.nodePrev.set(next, prev!);
    } else {
      this.listTail = prev ?? null;
    }

    this.nodePrev.delete(hash);
    this.nodeNext.delete(hash);
  }

  /** 将节点移到链表尾部 — O(1) */
  private moveToTail(hash: string): void {
    if (this.listTail === hash) {
      return;
    }
    this.removeFromList(hash);
    this.addToTail(hash);
  }
}

/**
 * 创建熔断器实例
 */
export function createCircuitBreaker(config: CircuitBreakerConfig): CircuitBreaker {
  return new CircuitBreaker(config);
}

/**
 * 创建死循环检测处理器
 *
 * 当检测到死循环时，返回强制中断消息
 */
export function createDeadLoopHandler(
  taskId: string,
  onDeadLoop: (taskId: string, message: string) => void,
): (errorType: string, context: string) => boolean {
  let circuitBreaker: CircuitBreaker | null = null;

  const getOrCreate = () => {
    if (!circuitBreaker) {
      circuitBreaker = createCircuitBreaker({
        onCircuitOpen: (taskId, fingerprint) => {
          const message = `检测到死循环:同一错误 "${fingerprint.type}" 已连续出现 ${fingerprint.count} 次。请人工介入处理。`;
          log.error(`死循环检测触发`, { fingerprint, taskId });
          onDeadLoop(taskId, message);
        },
        taskId,
        threshold: CIRCUIT_BREAKER_THRESHOLD,
      });
    }
    return circuitBreaker;
  };

  return (errorType: string, context: string): boolean => {
    const cb = getOrCreate();
    return cb.recordFailure(errorType, context);
  };
}
