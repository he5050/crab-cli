/**
 * 背压处理系统 — 防止系统过载的限流和队列管理。
 *
 * 职责:
 *   - 实现令牌桶算法进行请求限流
 *   - 管理请求队列，防止队列溢出
 *   - 提供并发控制
 *   - 监控背压状态
 *
 * 模块功能:
 *   - TokenBucket:令牌桶限流器
 *   - RequestQueue:请求队列管理
 *   - BackpressureMonitor:背压监控器
 *   - tryAcquireExecutionPermit:尝试获取执行许可
 *   - acquireExecutionPermit:异步获取执行许可
 *   - submitToQueue:提交请求到队列
 *
 * 使用场景:
 *   - 工具调用限流
 *   - 并发请求控制
 *   - 系统负载监控
 *
 * 边界:
 *   1. 不影响已有业务逻辑，只提供限流和队列管理
 *   2. 最大并发数由 MAX_CONCURRENT_TOOL_EXECUTION 控制
 *   3. 队列大小由 MAX_REQUEST_QUEUE_SIZE 限制
 *
 * 流程:
 *   1. 请求到达时检查令牌桶
 *   2. 有令牌则立即执行，无令牌则入队等待
 *   3. 队列按优先级排序处理
 *   4. 定期监控背压状态并生成建议
 */

import { createLogger } from "@/core/logging/logger";
import { RingBuffer } from "@/core/concurrency/ringBuffer";
import {
  BACKPRESSURE_THRESHOLD,
  MAX_CONCURRENT_TOOL_EXECUTION,
  MAX_REQUEST_QUEUE_SIZE,
  TOKEN_BUCKET_CAPACITY,
  TOKEN_BUCKET_REFILL_RATE,
} from "@/config";

const log = createLogger("backpressure");

// ─── 令牌桶限流器 ──────────────────────────────────────────────────

export class TokenBucket {
  private tokens: number;
  private capacity: number;
  private refillRate: number; // 每秒补充的令牌数
  private lastRefill: number;
  /** 等待队列:令牌不足时，resolve 回调在此排队等待通知 */
  private waiters: (() => void)[] = [];

  constructor(capacity = TOKEN_BUCKET_CAPACITY, refillRate = TOKEN_BUCKET_REFILL_RATE) {
    this.tokens = capacity;
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.lastRefill = Date.now();
  }

  /** 尝试获取一个令牌 */
  tryAcquire(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /** 等待获取令牌(异步，事件通知驱动) */
  async acquire(): Promise<void> {
    // 快速路径:有令牌直接获取
    if (this.tryAcquire()) {
      return;
    }
    // 慢速路径:注册等待回调，令牌补充时被通知
    await new Promise<void>((resolve) => {
      let resolved = false;
      const waiter = () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };
      this.waiters.push(waiter);
      // 设置超时保护:最长等待 2 秒后强制重试
      setTimeout(() => {
        if (!resolved) {
          const idx = this.waiters.indexOf(waiter);
          if (idx !== -1) {
            this.waiters.splice(idx, 1);
          }
          resolved = true;
          resolve(); // 超时后让调用方重试 tryAcquire
        }
      }, 2000);
    });
  }

  /** 补充令牌 */
  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000; // 秒
    const refill = elapsed * this.refillRate;

    const hadTokens = this.tokens;
    this.tokens = Math.min(this.capacity, this.tokens + refill);
    this.lastRefill = now;

    // 令牌从无到有:通知等待队列中的调用方
    if (hadTokens < 1 && this.tokens >= 1 && this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      waiter();
    }
  }

  /** 获取当前令牌数 */
  getTokens(): number {
    this.refill();
    return this.tokens;
  }

  /** 获取桶状态 */
  getStatus(): { tokens: number; capacity: number; utilization: number } {
    this.refill();
    return {
      capacity: this.capacity,
      tokens: Math.round(this.tokens * 100) / 100,
      utilization: Math.round((1 - this.tokens / this.capacity) * 10_000) / 100,
    };
  }
}

// ─── 请求队列 ──────────────────────────────────────────────────────

export interface QueuedRequest {
  id: string;
  type: string;
  enqueueTime: number;
  priority?: number; // 0 = 最高优先级
  execute: () => Promise<unknown>;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

export class RequestQueue {
  private queue = new RingBuffer<QueuedRequest>(MAX_REQUEST_QUEUE_SIZE);
  private processing = false;
  private maxConcurrent: number;
  private activeCount = 0;

  constructor(maxConcurrent = MAX_CONCURRENT_TOOL_EXECUTION) {
    this.maxConcurrent = maxConcurrent;
  }

  /** 入队请求 */
  enqueue<T>(request: Omit<QueuedRequest, "enqueueTime" | "resolve" | "reject">): Promise<T> {
    return new Promise((resolve, reject) => {
      const queued: QueuedRequest = {
        ...request,
        enqueueTime: Date.now(),
        reject,
        resolve: resolve as (result: unknown) => void,
      };

      // 检查队列是否已满
      if (this.queue.size >= MAX_REQUEST_QUEUE_SIZE) {
        log.warn(`请求队列已满 (${this.queue.size}/${MAX_REQUEST_QUEUE_SIZE})，拒绝新请求`);
        reject(new Error("请求队列已满，请稍后重试"));
        return;
      }

      this.queue.push(queued);
      log.debug(`请求入队: ${request.id} (队列长度: ${this.queue.size})`);

      this.processQueue();
    });
  }

  /** 处理队列 */
  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.isEmpty()) {
      return;
    }
    if (this.activeCount >= this.maxConcurrent) {
      return;
    }

    this.processing = true;

    // 一次性快照 + 排序，得出本轮消费顺序(按优先级从高到低)
    const ordered = this.queue.toArray().toSorted((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

    for (const request of ordered) {
      if (this.activeCount >= this.maxConcurrent) {
        break;
      }
      // 检查该请求是否仍在 queue 中(可能在 await 期间被 clear 移除)
      const stillThere = this.findInQueue(request);
      if (!stillThere) {
        continue;
      }
      this.removeFromQueue(request);
      this.activeCount++;
      // 异步执行，不阻塞队列处理
      this.executeRequest(request).finally(() => {
        this.activeCount--;
        this.processQueue();
      });
    }

    this.processing = false;
  }

  /** 通过引用在 queue 中查找(O(n))；返回 true 表示仍在 */
  private findInQueue(target: QueuedRequest): boolean {
    for (const item of this.queue) {
      if (item === target) {
        return true;
      }
    }
    return false;
  }

  /** 从 queue 中移除指定请求(O(n))；保持其余元素顺序 */
  private removeFromQueue(target: QueuedRequest): void {
    const current = this.queue.toArray();
    this.queue.clear();
    for (const item of current) {
      if (item !== target) {
        this.queue.push(item);
      }
    }
  }

  /** 执行单个请求 */
  private async executeRequest(request: QueuedRequest): Promise<void> {
    const startTime = Date.now();
    const waitTime = startTime - request.enqueueTime;

    try {
      const result = await request.execute();
      request.resolve(result);
      log.debug(`请求完成: ${request.id} (等待: ${waitTime}ms)`);
    } catch (error) {
      request.reject(error instanceof Error ? error : new Error(String(error)));
      log.error(`请求失败: ${request.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** 获取队列状态 */
  getStatus(): {
    queueLength: number;
    activeCount: number;
    maxConcurrent: number;
    utilization: number;
    backlog: number;
  } {
    return {
      activeCount: this.activeCount,
      backlog: this.queue.size,
      maxConcurrent: this.maxConcurrent,
      queueLength: this.queue.size,
      utilization: Math.round((this.activeCount / this.maxConcurrent) * 10_000) / 100,
    };
  }

  /** 清空队列 */
  clear(): void {
    const count = this.queue.size;
    for (const request of this.queue) {
      request.reject(new Error("队列已清空"));
    }
    this.queue.clear();
    log.debug(`请求队列已清空: ${count} 个请求`);
  }
}

// ─── 背压监控器 ────────────────────────────────────────────────────

export interface BackpressureStatus {
  isBackpressured: boolean;
  pressureLevel: "none" | "low" | "medium" | "high" | "critical";
  queueUtilization: number;
  tokenBucketUtilization: number;
  recommendations: string[];
}

export class BackpressureMonitor {
  private tokenBucket: TokenBucket;
  private requestQueue: RequestQueue;

  constructor() {
    this.tokenBucket = new TokenBucket();
    this.requestQueue = new RequestQueue();
  }

  /** 获取令牌桶 */
  getBucket(): TokenBucket {
    return this.tokenBucket;
  }

  /** 获取请求队列 */
  getQueue(): RequestQueue {
    return this.requestQueue;
  }

  /** 检查背压状态 */
  getStatus(): BackpressureStatus {
    const queueStatus = this.requestQueue.getStatus();
    const bucketStatus = this.tokenBucket.getStatus();
    const queueUtilization = queueStatus.utilization / 100;
    const bucketUtilization = bucketStatus.utilization / 100;

    // 计算综合压力水平
    const combinedPressure = (queueUtilization + bucketUtilization) / 2;

    let pressureLevel: "none" | "low" | "medium" | "high" | "critical";
    if (combinedPressure < 0.3) {
      pressureLevel = "none";
    } else if (combinedPressure < 0.5) {
      pressureLevel = "low";
    } else if (combinedPressure < 0.7) {
      pressureLevel = "medium";
    } else if (combinedPressure < 0.9) {
      pressureLevel = "high";
    } else {
      pressureLevel = "critical";
    }

    const isBackpressured = combinedPressure > BACKPRESSURE_THRESHOLD;

    // 生成建议
    const recommendations: string[] = [];
    if (queueUtilization > 0.8) {
      recommendations.push("请求队列使用率高，考虑增加并发数或优化请求处理速度");
    }
    if (bucketUtilization > 0.8) {
      recommendations.push("令牌桶接近耗尽，考虑降低请求频率或增加令牌补充速率");
    }
    if (pressureLevel === "critical") {
      recommendations.push("系统压力临界，建议立即减少负载或扩容");
    }

    return {
      isBackpressured,
      pressureLevel,
      queueUtilization: Math.round(queueUtilization * 10_000) / 100,
      recommendations,
      tokenBucketUtilization: Math.round(bucketUtilization * 10_000) / 100,
    };
  }

  /** 尝试获取执行许可 */
  tryAcquire(): boolean {
    return this.tokenBucket.tryAcquire();
  }

  /** 等待获取执行许可 */
  async acquire(): Promise<void> {
    return this.tokenBucket.acquire();
  }

  /** 提交请求到队列 */
  async submit<T>(request: Omit<QueuedRequest, "enqueueTime" | "resolve" | "reject">): Promise<T> {
    return this.requestQueue.enqueue<T>(request);
  }
}

// ─── 全局实例 ──────────────────────────────────────────────────────

export const globalBackpressure = new BackpressureMonitor();

/** 获取全局背压状态(用于 TUI 显示) */
export function getBackpressureStatus(): BackpressureStatus {
  return globalBackpressure.getStatus();
}

/** 尝试获取执行许可(同步) */
export function tryAcquireExecutionPermit(): boolean {
  return globalBackpressure.tryAcquire();
}

/** 等待获取执行许可(异步) */
export async function acquireExecutionPermit(): Promise<void> {
  return globalBackpressure.acquire();
}

/** 提交请求到队列 */
export async function submitToQueue<T>(request: Omit<QueuedRequest, "enqueueTime" | "resolve" | "reject">): Promise<T> {
  return globalBackpressure.submit<T>(request);
}
