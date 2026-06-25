/**
 * 统一缓存工具 — 通用内存缓存，支持 TTL、LRU 淘汰、批量操作。
 *
 * 职责:
 *   - 提供键值缓存，支持自动过期
 *   - LRU 淘汰策略（达到容量上限时淘汰最久未使用项）
 *   - 批量获取/设置
 *   - 缓存统计（命中率、大小）
 *
 * 使用场景:
 *   - 工具结果缓存
 *   - API 响应缓存
 *   - 计算结果缓存
 *   - 会话状态缓存
 */

export interface CacheEntry<T> {
  value: T;
  expiresAt?: number;
  createdAt: number;
  lastAccessedAt: number;
}

export interface CacheStats {
  size: number;
  capacity: number;
  hits: number;
  misses: number;
  hitRate: number;
  evictions: number;
}

export interface CacheOptions {
  /** 最大容量（条目数），默认 1000 */
  capacity?: number;
  /** 默认 TTL（毫秒），0 表示永不过期 */
  defaultTtlMs?: number;
}

export class Cache<T = unknown> {
  private store = new Map<string, CacheEntry<T>>();
  private capacity: number;
  private defaultTtlMs: number;
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private accessCounter = 0;
  private cleanupIntervalId?: ReturnType<typeof setInterval>;

  constructor(options: CacheOptions = {}) {
    this.capacity = options.capacity ?? 1000;
    this.defaultTtlMs = options.defaultTtlMs ?? 0;

    // 启动后台定时清理（每 5 分钟清理一次过期项）
    this.startBackgroundCleanup();
  }

  /**
   * 启动后台定时清理。
   */
  private startBackgroundCleanup(): void {
    if (this.cleanupIntervalId) {
      return; // 已经启动
    }

    const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 分钟
    this.cleanupIntervalId = setInterval(() => {
      this.cleanupExpired();
    }, CLEANUP_INTERVAL_MS);

    // 防止 Node.js 进程因为未清除的定时器而无法退出
    if (typeof this.cleanupIntervalId.unref === "function") {
      this.cleanupIntervalId.unref();
    }
  }

  /**
   * 停止后台定时清理（用于资源清理）。
   */
  dispose(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = undefined;
    }
  }

  set(key: string, value: T, ttlMs?: number): this {
    this.evictIfNeeded();

    const expiresAt =
      ttlMs !== undefined && ttlMs > 0
        ? Date.now() + ttlMs
        : this.defaultTtlMs > 0
          ? Date.now() + this.defaultTtlMs
          : undefined;

    this.accessCounter++;
    this.store.set(key, {
      value,
      expiresAt,
      createdAt: Date.now(),
      lastAccessedAt: this.accessCounter,
    });

    return this;
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }

    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.misses++;
      return undefined;
    }

    entry.lastAccessedAt = ++this.accessCounter;
    this.hits++;
    return entry.value;
  }

  getOrSet(key: string, factory: () => T, ttlMs?: number): T {
    const existing = this.get(key);
    if (existing !== undefined) {
      return existing;
    }

    const value = factory();
    this.set(key, value, ttlMs);
    return value;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
  }

  size(): number {
    this.cleanupExpired();
    return this.store.size;
  }

  keys(): string[] {
    this.cleanupExpired();
    return Array.from(this.store.keys());
  }

  values(): T[] {
    this.cleanupExpired();
    return Array.from(this.store.values()).map((e) => e.value);
  }

  entries(): Array<[string, T]> {
    this.cleanupExpired();
    return Array.from(this.store.entries()).map(([k, v]) => [k, v.value]);
  }

  setMany(entries: Array<[string, T]>, ttlMs?: number): this {
    for (const [key, value] of entries) {
      this.set(key, value, ttlMs);
    }
    return this;
  }

  getMany(keys: string[]): Array<{ key: string; value: T } | undefined> {
    return keys.map((key) => {
      const value = this.get(key);
      return value !== undefined ? { key, value } : undefined;
    });
  }

  deleteMany(keys: string[]): number {
    let count = 0;
    for (const key of keys) {
      if (this.delete(key)) count++;
    }
    return count;
  }

  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      size: this.store.size,
      capacity: this.capacity,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      evictions: this.evictions,
    };
  }

  private evictIfNeeded(): void {
    if (this.store.size < this.capacity) {
      return;
    }

    let oldestKey: string | undefined;
    let oldestTime = Infinity;

    for (const [key, entry] of this.store) {
      if (entry.lastAccessedAt < oldestTime) {
        oldestTime = entry.lastAccessedAt;
        oldestKey = key;
      }
    }

    if (oldestKey !== undefined) {
      this.store.delete(oldestKey);
      this.evictions++;
    }
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt && now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }
}

const globalCaches = new Map<string, Cache>();

export function getOrCreateCache<T = unknown>(name: string, options?: CacheOptions): Cache<T> {
  const existing = globalCaches.get(name);
  if (existing) {
    return existing as Cache<T>;
  }
  const cache = new Cache<T>(options);
  globalCaches.set(name, cache);
  return cache;
}

export function getCache<T = unknown>(name: string): Cache<T> | undefined {
  return globalCaches.get(name) as Cache<T> | undefined;
}

export function removeCache(name: string): void {
  const cache = globalCaches.get(name);
  if (cache) {
    cache.dispose();
  }
  globalCaches.delete(name);
}

export function clearAllCaches(): void {
  for (const cache of globalCaches.values()) {
    cache.dispose();
  }
  globalCaches.clear();
}
