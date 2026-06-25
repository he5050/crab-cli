/**
 * [LSP 性能优化模块]
 *
 * 职责:
 *   - 缓存 LSP 响应结果
 *   - 批处理和队列管理
 *   - 性能监控和统计
 *   - 减少重复请求
 *   - 优化响应时间
 *
 * 模块功能:
 *   - ResponseCache: 响应缓存
 *   - RequestQueue: 请求队列
 *   - PerformanceMonitor: 性能监控
 *   - 批处理和去重
 *
 * 使用场景:
 *   - 频繁的代码补全请求
 *   - 重复的跳转定义请求
 *   - 批量代码分析
 *   - 性能瓶颈分析
 *
 * 边界:
 *   1. 缓存有 TTL 限制(默认 5 秒)
 *   2. 队列有长度限制(默认 100)
 *   3. 缓存键基于请求参数
 *   4. 性能统计定期清理
 *
 * 流程:
 *   1. 请求前检查缓存
 *   2. 缓存命中则直接返回
 *   3. 缓存未命中则加入队列
 *   4. 执行请求并缓存结果
 *   5. 记录性能指标
 *   6. 定期清理过期缓存
 */
import { createLogger } from "@/core/logging/logger";

const log = createLogger("lsp:performance");

/** 缓存条目 */
interface CacheEntry<T> {
  /** 缓存值 */
  value: T;
  /** 创建时间 */
  createdAt: number;
  /** 访问次数 */
  hits: number;
}

/** 性能指标 */
interface PerformanceMetrics {
  /** 请求总数 */
  totalRequests: number;
  /** 缓存命中数 */
  cacheHits: number;
  /** 平均响应时间(毫秒) */
  avgResponseTime: number;
  /** 最慢响应时间(毫秒) */
  maxResponseTime: number;
  /** 队列等待时间(毫秒) */
  avgQueueTime: number;
}

/** 请求统计 */
interface RequestStats {
  /** 请求开始时间 */
  startTime: number;
  /** 入队时间 */
  enqueuedAt: number;
  /** 请求类型 */
  requestType: string;
}

/**
 * 响应缓存类
 *
 * 缓存 LSP 请求的响应结果，避免重复计算。
 */
export class ResponseCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private ttl: number;
  private maxSize: number;
  private enableLogging: boolean;

  constructor(options?: { ttl?: number; maxSize?: number; enableLogging?: boolean }) {
    this.ttl = options?.ttl ?? 5000; // 默认 5 秒
    this.maxSize = options?.maxSize ?? 1000; // 默认 1000 条
    this.enableLogging = options?.enableLogging ?? true;
  }

  /**
   * 生成缓存键
   */
  private generateKey(requestType: string, params: unknown): string {
    const strParams = typeof params === "string" ? params : JSON.stringify(params);
    return `${requestType}:${strParams}`;
  }

  /**
   * 获取缓存
   */
  get(requestType: string, params: unknown): T | null {
    const key = this.generateKey(requestType, params);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // 检查是否过期
    const age = Date.now() - entry.createdAt;
    if (age > this.ttl) {
      this.cache.delete(key);
      if (this.enableLogging) {
        log.debug(`缓存过期: ${requestType}`);
      }
      return null;
    }

    // 更新访问次数
    entry.hits++;

    if (this.enableLogging) {
      log.debug(`缓存命中: ${requestType} (hits: ${entry.hits})`);
    }

    return entry.value;
  }

  /**
   * 设置缓存
   */
  set(requestType: string, params: unknown, value: T): void {
    // 检查缓存大小限制
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }

    const key = this.generateKey(requestType, params);
    const entry: CacheEntry<T> = {
      createdAt: Date.now(),
      hits: 0,
      value,
    };

    this.cache.set(key, entry);

    if (this.enableLogging) {
      log.debug(`缓存设置: ${requestType} (size: ${this.cache.size}/${this.maxSize})`);
    }
  }

  /**
   * 清理过期缓存
   */
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      const age = now - entry.createdAt;
      if (age > this.ttl) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0 && this.enableLogging) {
      log.debug(`清理过期缓存: ${cleaned} 条`);
    }

    return cleaned;
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
    if (this.enableLogging) {
      log.debug("缓存已清空");
    }
  }

  /**
   * 淘汰最老的缓存
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Number.MAX_VALUE;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      if (this.enableLogging) {
        log.debug("淘汰最老缓存");
      }
    }
  }

  /**
   * 获取缓存统计
   */
  getStats(): {
    size: number;
    maxSize: number;
    ttl: number;
    totalHits: number;
  } {
    let totalHits = 0;
    for (const entry of this.cache.values()) {
      totalHits += entry.hits;
    }

    return {
      maxSize: this.maxSize,
      size: this.cache.size,
      totalHits,
      ttl: this.ttl,
    };
  }
}

/**
 * 请求队列类
 *
 * 管理并发请求数量，避免服务器过载。
 */
export class RequestQueue {
  private queue: (() => Promise<unknown>)[] = [];
  private activeRequests = 0;
  private maxConcurrent: number;
  private enableLogging: boolean;

  constructor(options?: { maxConcurrent?: number; enableLogging?: boolean }) {
    this.maxConcurrent = options?.maxConcurrent ?? 10; // 默认 10 个并发
    this.enableLogging = options?.enableLogging ?? true;
  }

  /**
   * 添加请求到队列
   */
  async add<T>(request: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const task = async () => {
        try {
          const result = await request();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.activeRequests--;
          this.processQueue();
        }
      };

      this.queue.push(task);

      if (this.enableLogging) {
        log.debug(`请求加入队列: 队列长度 ${this.queue.length}, 活跃 ${this.activeRequests}`);
      }

      this.processQueue();
    });
  }

  /**
   * 处理队列
   */
  private processQueue(): void {
    while (this.queue.length > 0 && this.activeRequests < this.maxConcurrent) {
      const task = this.queue.shift();
      if (task) {
        this.activeRequests++;
        task();
      }
    }
  }

  /**
   * 获取队列统计
   */
  getStats(): {
    queueLength: number;
    activeRequests: number;
    maxConcurrent: number;
  } {
    return {
      activeRequests: this.activeRequests,
      maxConcurrent: this.maxConcurrent,
      queueLength: this.queue.length,
    };
  }

  /**
   * 清空队列
   */
  clear(): void {
    this.queue = [];
    if (this.enableLogging) {
      log.debug("请求队列已清空");
    }
  }
}

/**
 * 性能监控类
 *
 * 记录和分析 LSP 操作的性能指标。
 */
export class PerformanceMonitor {
  private metrics: PerformanceMetrics = {
    avgQueueTime: 0,
    avgResponseTime: 0,
    cacheHits: 0,
    maxResponseTime: 0,
    totalRequests: 0,
  };

  private requestStats = new Map<string, RequestStats>();
  private enableLogging: boolean;

  constructor(options?: { enableLogging?: boolean }) {
    this.enableLogging = options?.enableLogging ?? true;
  }

  /**
   * 开始记录请求
   */
  startRequest(requestId: string, requestType: string): void {
    this.requestStats.set(requestId, {
      enqueuedAt: Date.now(),
      requestType,
      startTime: Date.now(),
    });

    this.metrics.totalRequests++;

    if (this.enableLogging) {
      log.debug(`开始记录请求: ${requestType} (${requestId})`);
    }
  }

  /**
   * 结束记录请求
   */
  endRequest(requestId: string, cacheHit: boolean): number {
    const stats = this.requestStats.get(requestId);
    if (!stats) {
      return 0;
    }

    const endTime = Date.now();
    const responseTime = endTime - stats.startTime;
    const queueTime = stats.startTime - stats.enqueuedAt;

    // 更新最大响应时间
    if (responseTime > this.metrics.maxResponseTime) {
      this.metrics.maxResponseTime = responseTime;
    }

    // 更新平均响应时间(简单移动平均)
    this.metrics.avgResponseTime =
      (this.metrics.avgResponseTime * (this.metrics.totalRequests - 1) + responseTime) / this.metrics.totalRequests;

    // 更新平均队列时间
    this.metrics.avgQueueTime =
      (this.metrics.avgQueueTime * (this.metrics.totalRequests - 1) + queueTime) / this.metrics.totalRequests;

    // 更新缓存命中数
    if (cacheHit) {
      this.metrics.cacheHits++;
    }

    this.requestStats.delete(requestId);

    if (this.enableLogging) {
      log.debug(`结束记录请求: ${stats.requestType} (${requestId}) - ${responseTime}ms`);
    }

    return responseTime;
  }

  /**
   * 记录缓存命中
   */
  recordCacheHit(): void {
    this.metrics.cacheHits++;
  }

  /**
   * 获取性能指标
   */
  getMetrics(): PerformanceMetrics {
    return { ...this.metrics };
  }

  /**
   * 获取缓存命中率
   */
  getCacheHitRate(): number {
    if (this.metrics.totalRequests === 0) {
      return 0;
    }
    return this.metrics.cacheHits / this.metrics.totalRequests;
  }

  /**
   * 重置指标
   */
  reset(): void {
    this.metrics = {
      avgQueueTime: 0,
      avgResponseTime: 0,
      cacheHits: 0,
      maxResponseTime: 0,
      totalRequests: 0,
    };
    this.requestStats.clear();

    if (this.enableLogging) {
      log.debug("性能指标已重置");
    }
  }

  /**
   * 打印性能报告
   */
  printReport(): void {
    const cacheHitRate = this.getCacheHitRate();

    log.info("=== LSP 性能报告 ===");
    log.info(`总请求数: ${this.metrics.totalRequests}`);
    log.info(`缓存命中: ${this.metrics.cacheHits} (${(cacheHitRate * 100).toFixed(1)}%)`);
    log.info(`平均响应时间: ${this.metrics.avgResponseTime.toFixed(0)}ms`);
    log.info(`最大响应时间: ${this.metrics.maxResponseTime}ms`);
    log.info(`平均队列时间: ${this.metrics.avgQueueTime.toFixed(0)}ms`);
  }
}

/**
 * 创建性能优化器
 */
export function createPerformanceCache<T>(options?: {
  ttl?: number;
  maxSize?: number;
  enableLogging?: boolean;
}): ResponseCache<T> {
  return new ResponseCache<T>(options);
}

export function createRequestQueue(options?: { maxConcurrent?: number; enableLogging?: boolean }): RequestQueue {
  return new RequestQueue(options);
}

export function createPerformanceMonitor(options?: { enableLogging?: boolean }): PerformanceMonitor {
  return new PerformanceMonitor(options);
}
