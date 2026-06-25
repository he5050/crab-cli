/**
 * 智能缓存管理器 — 统一的 LRU 缓存实现，支持 TTL、命中率统计和自动清理。
 *
 * 职责:
 *   - 提供统一的缓存接口
 *   - 实现 LRU 淘汰策略
 *   - 统计缓存命中率
 *   - 支持 TTL 自动过期
 *   - 提供缓存预热机制
 *
 * 模块功能:
 *   - CacheManager:缓存管理器类
 *   - createCacheManager:创建缓存管理器
 *   - getCacheManager:获取缓存管理器
 *   - destroyCacheManager:销毁缓存管理器
 *   - getAllCacheStats:获取所有缓存统计
 *   - cleanupAllCaches:清理所有缓存
 *   - webSearchCache:Web 搜索缓存实例
 *   - codebaseSearchCache:代码库搜索缓存实例
 *
 * 使用场景:
 *   - Web 搜索结果缓存
 *   - 代码库搜索结果缓存
 *   - 频繁访问数据的缓存
 *
 * 边界:
 *   1. 纯内存缓存，不涉及持久化
 *   2. 最大条目数由 maxSize 控制
 *   3. TTL 为 0 表示永不过期
 *
 * 流程:
 *   1. 创建缓存管理器时配置参数
 *   2. 使用 get/set 操作缓存数据
 *   3. 自动 LRU 淘汰和 TTL 过期清理
 *   4. 定期获取统计信息监控缓存效果
 */

import { createLogger } from "@/core/logging/logger";

const log = createLogger("cache-manager");

/** 缓存条目 */
interface CacheEntry<T> {
  value: T;
  timestamp: number;
  lastAccess: number;
  ttl?: number; // 毫秒，undefined 表示永不过期
}

/** 缓存统计信息 */
export interface CacheStats {
  name: string;
  size: number;
  maxSize: number;
  hits: number;
  misses: number;
  hitRate: number;
  evictions: number;
  expirations: number;
  avgAccessTime: number; // 毫秒
}

/** 缓存配置 */
export interface CacheConfig {
  /** 缓存名称 */
  name: string;
  /** 最大条目数 */
  maxSize: number;
  /** 默认 TTL(毫秒)，0 表示永不过期 */
  defaultTtl?: number;
  /** 是否启用命中率统计 */
  enableStats?: boolean;
  /** 自动清理间隔(毫秒)，0 表示不自动清理 */
  cleanupInterval?: number;
}

/** 缓存预热数据源 */
export type CachePreloadSource<T> = () => Promise<Map<string, T>>;

class CacheManager<T = unknown> {
  private cache: Map<string, CacheEntry<T>>;
  private config: CacheConfig;
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private expirations = 0;
  private totalAccessTime = 0;
  private accessCount = 0;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: CacheConfig) {
    this.cache = new Map();
    this.config = {
      cleanupInterval: 0,
      defaultTtl: 0,
      enableStats: true,
      ...config,
    };

    // 自动清理
    if (this.config.cleanupInterval && this.config.cleanupInterval > 0) {
      this.startAutoCleanup();
    }

    log.debug(`缓存管理器已创建: ${this.config.name} (max: ${this.config.maxSize})`);
  }

  /** 获取缓存值 */
  get(key: string): T | null {
    const startTime = Date.now();
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    // 检查 TTL
    if (entry.ttl && Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      this.expirations++;
      this.misses++;
      return null;
    }

    // 更新访问时间(LRU)
    entry.lastAccess = Date.now();
    this.hits++;

    this.totalAccessTime += Date.now() - startTime;
    this.accessCount++;

    return entry.value;
  }

  /** 设置缓存值 */
  set(key: string, value: T, ttl?: number): void {
    // 如果缓存已满，删除最旧的条目
    if (this.cache.size >= this.config.maxSize && !this.cache.has(key)) {
      this.evictOldest();
    }

    const entry: CacheEntry<T> = {
      lastAccess: Date.now(),
      timestamp: Date.now(),
      ttl: ttl ?? this.config.defaultTtl ?? 0,
      value,
    };

    this.cache.set(key, entry);
  }

  /** 删除缓存条目 */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /** 清空缓存 */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
    this.expirations = 0;
    log.debug(`缓存已清空: ${this.config.name}`);
  }

  /** 检查键是否存在(考虑 TTL) */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    if (entry.ttl && Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      this.expirations++;
      return false;
    }

    return true;
  }

  /** 获取缓存大小 */
  size(): number {
    return this.cache.size;
  }

  /** 获取所有键 */
  keys(): string[] {
    return [...this.cache.keys()];
  }

  /** 获取所有值 */
  values(): T[] {
    return [...this.cache.values()].map((e) => e.value);
  }

  /** 获取缓存统计信息 */
  getStats(): CacheStats {
    const totalRequests = this.hits + this.misses;
    return {
      avgAccessTime: this.accessCount > 0 ? Math.round((this.totalAccessTime / this.accessCount) * 100) / 100 : 0,
      evictions: this.evictions,
      expirations: this.expirations,
      hitRate: totalRequests > 0 ? Math.round((this.hits / totalRequests) * 10_000) / 100 : 0,
      hits: this.hits,
      maxSize: this.config.maxSize,
      misses: this.misses,
      name: this.config.name,
      size: this.cache.size,
    };
  }

  /** 重置统计信息 */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
    this.expirations = 0;
    this.totalAccessTime = 0;
    this.accessCount = 0;
  }

  /** 清理过期条目 */
  cleanup(): number {
    let cleaned = 0;
    const now = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (entry.ttl && now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      log.debug(`缓存清理: ${this.config.name} 清理了 ${cleaned} 个过期条目`);
    }

    return cleaned;
  }

  /** 缓存预热 */
  async preload(source: CachePreloadSource<T>): Promise<number> {
    try {
      const data = await source();
      let loaded = 0;

      for (const [key, value] of data.entries()) {
        if (this.cache.size < this.config.maxSize) {
          this.set(key, value);
          loaded++;
        } else {
          break;
        }
      }

      log.debug(`缓存预热: ${this.config.name} 加载了 ${loaded} 个条目`);
      return loaded;
    } catch (error) {
      log.error(`缓存预热失败: ${this.config.name}: ${error instanceof Error ? error.message : String(error)}`);
      return 0;
    }
  }

  /** LRU 淘汰最旧条目 */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccess < oldestTime) {
        oldestTime = entry.lastAccess;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.evictions++;
    }
  }

  /** 启动自动清理 */
  private startAutoCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupInterval);
  }

  /** 停止自动清理 */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    log.debug(`缓存管理器已销毁: ${this.config.name}`);
  }
}

// ─── 缓存工厂 ──────────────────────────────────────────────────────

/**
 * 缓存管理器非泛型接口（用于注册表存储）。
 * 注册表丢失泛型参数，调用方应持有原始 CacheManager<T> 引用。
 */
interface ICacheManager {
  get(key: string): unknown | null;
  set(key: string, value: unknown, ttl?: number): void;
  delete(key: string): boolean;
  has(key: string): boolean;
  clear(): void;
  size(): number;
  keys(): string[];
  values(): unknown[];
  getStats(): CacheStats;
  resetStats(): void;
  cleanup(): number;
  destroy(): void;
}

/** 缓存管理器注册表 */
const cacheRegistry = new Map<string, ICacheManager>();

/** 创建缓存管理器 */
export function createCacheManager<T = unknown>(config: CacheConfig): CacheManager<T> {
  const manager = new CacheManager<T>(config);
  cacheRegistry.set(config.name, manager);
  return manager;
}

/**
 * 获取缓存管理器（非泛型版本，通过注册表查找）。
 *
 * @warning 返回值丢失了原始泛型类型信息。推荐调用方直接持有
 *          createCacheManager() 返回的引用，而非通过此函数查找。
 */
export function getCacheManager(name: string): ICacheManager | null {
  return cacheRegistry.get(name) ?? null;
}

/** 销毁缓存管理器 */
export function destroyCacheManager(name: string): void {
  const manager = cacheRegistry.get(name);
  if (manager) {
    manager.destroy();
    cacheRegistry.delete(name);
  }
}

/** 获取所有缓存统计 */
export function getAllCacheStats(): CacheStats[] {
  return [...cacheRegistry.values()].map((m) => m.getStats());
}

/** 清理所有缓存的过期条目 */
export function cleanupAllCaches(): number {
  let total = 0;
  for (const manager of cacheRegistry.values()) {
    total += manager.cleanup();
  }
  return total;
}

/** 获取缓存总大小 */
export function getTotalCacheSize(): number {
  let total = 0;
  for (const manager of cacheRegistry.values()) {
    total += manager.size();
  }
  return total;
}

// ─── 预定义缓存实例 ────────────────────────────────────────────────

import {
  WEB_SEARCH_CACHE_MAX_SIZE,
  WEB_SEARCH_CACHE_TTL_MS,
  MAX_CODEBASE_CACHE_SIZE,
  CODEBASE_SEARCH_CACHE_TTL_MS,
} from "@/config";

/** Web 搜索缓存 */
export const webSearchCache = createCacheManager({
  cleanupInterval: 60_000, // 1 分钟
  defaultTtl: WEB_SEARCH_CACHE_TTL_MS,
  maxSize: WEB_SEARCH_CACHE_MAX_SIZE,
  name: "websearch",
});

/** 代码库搜索缓存 */
export const codebaseSearchCache = createCacheManager({
  cleanupInterval: 30_000, // 30 秒
  defaultTtl: CODEBASE_SEARCH_CACHE_TTL_MS,
  maxSize: MAX_CODEBASE_CACHE_SIZE,
  name: "codebase-search",
});

/** 全局缓存清理(应用退出时调用) */
export function cleanupAllCachesOnExit(): void {
  for (const [name, manager] of cacheRegistry.entries()) {
    log.debug(`清理缓存: ${name} (${manager.size()} 条目)`);
    manager.destroy();
  }
  cacheRegistry.clear();
}
