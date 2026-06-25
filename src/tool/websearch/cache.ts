/**
 * 搜索结果缓存 — LRU 淘汰策略，支持 TTL 过期。
 *
 * 职责:
 *   - 缓存搜索结果
 *   - LRU 淘汰(超出上限时删除最旧条目)
 *   - TTL 过期检查
 */

import { WEB_SEARCH_CACHE_MAX_SIZE, WEB_SEARCH_CACHE_TTL_MS } from "@/config";
import type { CacheEntry } from "./apiTypes";

/** 搜索结果缓存(最多 WEB_SEARCH_CACHE_MAX_SIZE 条，TTL WEB_SEARCH_CACHE_TTL_MS) */
const searchCache = new Map<string, CacheEntry>();

const CACHE_TTL = WEB_SEARCH_CACHE_TTL_MS;

/** 获取缓存结果，过期返回 null */
export function getCachedResult(key: string): Record<string, unknown> | null {
  const entry = searchCache.get(key);
  if (!entry) {
    return null;
  }
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    searchCache.delete(key);
    return null;
  }
  return entry.results;
}

/** 写入缓存，LRU 淘汰(利用 Map 插入顺序，O(1)) */
export function setCachedResult(key: string, results: Record<string, unknown>): void {
  // LRU 淘汰:超过上限时删除最旧的条目（利用 Map 插入顺序，O(1)）
  if (searchCache.size >= WEB_SEARCH_CACHE_MAX_SIZE) {
    const oldestKey = searchCache.keys().next().value;
    if (oldestKey) {
      searchCache.delete(oldestKey);
    }
  }
  // delete+set 刷新插入顺序，使其成为最新访问条目
  searchCache.delete(key);
  searchCache.set(key, { results, timestamp: Date.now() });
}
