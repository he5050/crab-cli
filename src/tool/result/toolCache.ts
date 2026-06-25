/**
 * 工具结果缓存 — 缓存工具执行结果，避免重复执行。
 *
 * 职责:
 *   - 缓存工具执行结果
 *   - 支持按工具名 + 参数哈希作为缓存键
 *   - 支持 TTL 和容量限制
 *   - 支持缓存失效和清理
 *
 * 使用场景:
 *   - 缓存文件系统读取结果（如 glob、grep）
 *   - 缓存网络请求结果
 *   - 缓存计算密集型工具的结果
 *
 * 边界:
 *   1. 仅缓存幂等工具的读取操作
 *   2. 写操作（write、edit、bash）不缓存
 *   3. 缓存键基于工具名 + 参数 JSON 哈希
 */
import { createHash } from "node:crypto";
import { Cache, getOrCreateCache } from "@/api";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("tool:cache");

/** 工具缓存条目，存储缓存结果和元信息 */
export interface ToolCacheEntry<T = unknown> {
  result: T;
  cachedAt: number;
  toolName: string;
  paramsHash: string;
}

/** 工具缓存配置项，包括容量、TTL 和工具白/黑名单 */
export interface ToolCacheOptions {
  /** 缓存容量，默认 500 */
  capacity?: number;
  /** 默认 TTL（毫秒），默认 60000（1 分钟） */
  defaultTtlMs?: number;
  /** 需要缓存的工具白名单，为空则缓存所有读取类工具 */
  allowTools?: string[];
  /** 排除的工具黑名单 */
  excludeTools?: string[];
}

const WRITE_TOOLS = new Set(["fs_write", "fs_edit", "fs_batch", "bash", "apply_patch"]);

class ToolResultCache {
  private cache: Cache<ToolCacheEntry>;
  private allowTools?: Set<string>;
  private excludeTools: Set<string>;

  constructor(options: ToolCacheOptions = {}) {
    this.cache = getOrCreateCache<ToolCacheEntry>("tool-results", {
      capacity: options.capacity ?? 500,
      defaultTtlMs: options.defaultTtlMs ?? 60000,
    });
    this.allowTools = options.allowTools ? new Set(options.allowTools) : undefined;
    this.excludeTools = new Set(options.excludeTools ?? []);
  }

  shouldCache(toolName: string): boolean {
    if (WRITE_TOOLS.has(toolName)) return false;
    if (this.excludeTools.has(toolName)) return false;
    if (this.allowTools && !this.allowTools.has(toolName)) return false;
    return true;
  }

  /**
   * 构建缓存 key，包含 sessionId 隔离前缀（防止并发会话共享缓存）。
   * 当 sessionId 为空时使用全局缓存（向后兼容）。
   */
  buildCacheKey(toolName: string, params: unknown, sessionId?: string): string {
    const paramsStr = JSON.stringify(params, (_key, value) => (value === undefined ? null : value));
    const hash = createHash("sha256").update(paramsStr).digest("hex").slice(0, 16);
    const suffix = `${toolName}:${hash}`;
    return sessionId ? `${sessionId}:${suffix}` : suffix;
  }

  get<T = unknown>(toolName: string, params: unknown, sessionId?: string): T | undefined {
    if (!this.shouldCache(toolName)) {
      return undefined;
    }

    const key = this.buildCacheKey(toolName, params, sessionId);
    const entry = this.cache.get(key);
    if (entry) {
      log.debug(`缓存命中: ${toolName} (${key})`);
      return entry.result as T;
    }
    return undefined;
  }

  set<T = unknown>(toolName: string, params: unknown, result: T, ttlMs?: number, sessionId?: string): void {
    if (!this.shouldCache(toolName)) {
      return;
    }

    const key = this.buildCacheKey(toolName, params, sessionId);
    this.cache.set(
      key,
      {
        result,
        cachedAt: Date.now(),
        toolName,
        paramsHash: key,
      },
      ttlMs,
    );
    log.debug(`缓存设置: ${toolName} (${key})`);
  }

  invalidate(toolName?: string): number {
    if (toolName) {
      // 匹配无前缀 key "toolName:hash" 和有 sessionId 前缀的 key "sessionId:toolName:hash"
      const suffix = `:${toolName}:`;
      const prefix = `${toolName}:`;
      const keys = this.cache.keys().filter((k) => k.startsWith(prefix) || k.includes(suffix));
      return this.cache.deleteMany(keys);
    }
    const count = this.cache.keys().length;
    this.cache.clear();
    return count;
  }

  getStats() {
    return this.cache.getStats();
  }
}

let globalToolCache: ToolResultCache | null = null;

/** 获取全局工具结果缓存单例 */
export function getToolResultCache(): ToolResultCache {
  if (!globalToolCache) {
    globalToolCache = new ToolResultCache();
  }
  return globalToolCache;
}

/** 重置全局工具结果缓存，清除所有缓存条目 */
export function resetToolResultCache(): void {
  globalToolCache?.invalidate();
  globalToolCache = null;
}

/** 工具结果缓存类，支持按工具名+参数哈希缓存执行结果 */
export { ToolResultCache };
