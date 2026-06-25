/**
 * ACE 服务生命周期管理 — 从 aceService.ts 拆分
 *
 * 职责:
 *   - 空闲清理与内存管理
 *   - 内容缓存管理(添加、驱逐、字节追踪、按大小裁剪)
 *   - 内存压力检测与强制清理
 *   - 索引构建锁(序列化并发 re-entrant 索引构建)
 *   - 排除模式与命令可用性缓存
 *   - Git 仓库状态缓存
 */

import * as path from "node:path";
import { promises as fs } from "node:fs";

import { createLogger } from "@/core/logging/logger";
import {
  INDEX_CACHE_DURATION,
  MAX_CONTENT_CACHE_BYTES,
  MEMORY_CHECK_INTERVAL_MS,
  MEMORY_PRESSURE_THRESHOLD_BYTES,
} from "./constants";
import { type ContentCacheCallbacks, loadExclusionPatterns } from "./filesystem";
import { isCommandAvailable } from "./search";
import { getCodebaseSearchErrorMessage } from "@/tool/codebaseSearch/errors";

const log = createLogger("tool:ace-service");

/**
 * ACE 服务状态容器 — 从 ACECodeSearchService 拆出，用于管理生命周期相关的内部状态。
 */
/** ACEServiceState */
export interface ACEServiceState {
  indexCache: Map<string, any[]>;
  lastIndexTime: number;
  allIndexedFiles: Set<string>;
  fileModTimes: Map<string, number>;
  customExcludes: string[];
  excludesLoaded: boolean;
  isIndexTruncated: boolean;
  indexBuildQueue: Promise<void>;
  fileContentCache: Map<string, { content: string; mtime: number }>;
  regexCache: Map<string, RegExp>;
  commandAvailabilityCache: Map<string, boolean>;
  isGitRepoCache: boolean | null;
  fileStatCache: Map<string, { mtimeMs: number; cachedAt: number }>;
  fileContentCacheBytes: number;
  lastMemoryCheckTime: number;
}

/**
 * 创建 ACE 服务初始状态。
 */
/** createACEServiceState 的实现 */
export function createACEServiceState(): ACEServiceState {
  return {
    allIndexedFiles: new Set(),
    commandAvailabilityCache: new Map(),
    customExcludes: [],
    excludesLoaded: false,
    fileContentCache: new Map(),
    fileContentCacheBytes: 0,
    fileModTimes: new Map(),
    fileStatCache: new Map(),
    indexBuildQueue: Promise.resolve(),
    indexCache: new Map(),
    isGitRepoCache: null,
    isIndexTruncated: false,
    lastIndexTime: 0,
    lastMemoryCheckTime: 0,
    regexCache: new Map(),
  };
}

/**
 * 内容缓存回调构建器。
 */
/** buildContentCacheCallbacks 的实现 */
export function buildContentCacheCallbacks(state: ACEServiceState): ContentCacheCallbacks {
  return {
    onAdd: (_filePath, content) => {
      state.fileContentCacheBytes += content.length * 2;
      trimContentCacheByBytes(state);
    },
    onEvict: (filePath) => {
      const entry = state.fileContentCache.get(filePath);
      if (entry) {
        state.fileContentCacheBytes -= entry.content.length * 2;
      }
    },
  };
}

// ─── 索引构建锁 ──────────────────────────────────────────────

/** 使用索引构建锁序列化并发索引构建请求 */
export async function withIndexBuildLock<T>(state: ACEServiceState, fn: () => Promise<T>): Promise<T> {
  const next = state.indexBuildQueue.then(fn, fn);
  state.indexBuildQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/** 标记索引已被截断，仅在首次截断时输出警告日志 */
export function markIndexTruncated(state: ACEServiceState, message: string): void {
  if (!state.isIndexTruncated) {
    log.warn(message);
  }
  state.isIndexTruncated = true;
}

// ─── 空闲清理与内存管理 ───────────────────────────────────────

/** 调度空闲清理定时器，到期后执行清理回调 */
export function scheduleIdleCleanup(
  _state: ACEServiceState,
  isDisposed: boolean,
  idleCleanupMs: number,
  timerRef: { timer: NodeJS.Timeout | undefined },
  onCleanup: () => void,
): void {
  if (isDisposed || idleCleanupMs <= 0) {
    return;
  }

  if (timerRef.timer) {
    clearTimeout(timerRef.timer);
  }

  timerRef.timer = setTimeout(() => {
    onCleanup();
  }, idleCleanupMs);
  timerRef.timer.unref?.();
}

/** 标记服务活跃，检查内存压力并重置空闲清理定时器 */
export function markActivity(
  state: ACEServiceState,
  _basePath: string,
  idleCleanupMs: number,
  timerRef: { timer: NodeJS.Timeout | undefined },
  onCleanup: () => void,
): void {
  checkMemoryPressure(state);
  scheduleIdleCleanup(state, false, idleCleanupMs, timerRef, onCleanup);
}

/** 从内容缓存中移除指定文件并更新字节计数 */
export function removeFromContentCache(state: ACEServiceState, filePath: string): void {
  const existing = state.fileContentCache.get(filePath);
  if (existing) {
    state.fileContentCacheBytes -= existing.content.length * 2;
    state.fileContentCache.delete(filePath);
  }
}

/** 清空全部内容缓存并重置字节计数 */
export function clearContentCache(state: ACEServiceState): void {
  state.fileContentCache.clear();
  state.fileContentCacheBytes = 0;
}

/** 按字节上限裁剪内容缓存，驱逐最早的条目直到低于阈值 */
export function trimContentCacheByBytes(state: ACEServiceState): void {
  if (state.fileContentCacheBytes <= MAX_CONTENT_CACHE_BYTES) {
    return;
  }

  const entries = [...state.fileContentCache.entries()];
  let i = 0;
  while (state.fileContentCacheBytes > MAX_CONTENT_CACHE_BYTES && i < entries.length) {
    const entry = entries[i];
    if (entry) {
      state.fileContentCacheBytes -= entry[1].content.length * 2;
      state.fileContentCache.delete(entry[0]);
    }
    i++;
  }

  if (state.fileContentCacheBytes < 0) {
    state.fileContentCacheBytes = 0;
  }
}

function checkMemoryPressure(state: ACEServiceState): void {
  const now = Date.now();
  if (now - state.lastMemoryCheckTime < MEMORY_CHECK_INTERVAL_MS) {
    return;
  }
  state.lastMemoryCheckTime = now;

  const rss = process.memoryUsage.rss();
  if (rss > MEMORY_PRESSURE_THRESHOLD_BYTES) {
    log.warn(`检测到 ACE 内存压力(RSS: ${Math.round(rss / 1024 / 1024)}MB)，将触发强制清理`);
    clearContentCache(state);
    state.fileStatCache.clear();
  }
}

/**
 * 获取内存使用统计。
 */
/** getMemoryStats 的实现 */
export function getMemoryStats(state: ACEServiceState): {
  indexedFiles: number;
  cachedSymbols: number;
  contentCacheEntries: number;
  contentCacheBytes: number;
  statCacheEntries: number;
  regexCacheEntries: number;
  rssBytes: number;
} {
  let cachedSymbols = 0;
  for (const symbols of state.indexCache.values()) {
    cachedSymbols += symbols.length;
  }
  return {
    cachedSymbols,
    contentCacheBytes: state.fileContentCacheBytes,
    contentCacheEntries: state.fileContentCache.size,
    indexedFiles: state.allIndexedFiles.size,
    regexCacheEntries: state.regexCache.size,
    rssBytes: process.memoryUsage.rss(),
    statCacheEntries: state.fileStatCache.size,
  };
}

/**
 * 清理全部缓存。
 */
/** clearCaches 的实现 */
export function clearCaches(
  state: ACEServiceState,
  options?: { preserveExclusions?: boolean; preserveCommandCache?: boolean },
): void {
  state.indexCache.clear();
  state.fileModTimes.clear();
  state.allIndexedFiles.clear();
  clearContentCache(state);
  state.fileStatCache.clear();
  state.lastIndexTime = 0;
  state.isIndexTruncated = false;
  state.indexBuildQueue = Promise.resolve();

  if (!options?.preserveExclusions) {
    state.customExcludes = [];
    state.excludesLoaded = false;
    state.regexCache.clear();
  }
  if (!options?.preserveCommandCache) {
    state.commandAvailabilityCache.clear();
    state.isGitRepoCache = null;
  }
}

// ─── 排除模式与命令检测 ──────────────────────────────────────

/** 按需加载排除模式（仅首次加载，后续使用缓存） */
export async function loadExclusionPatternsIfNeeded(state: ACEServiceState, basePath: string): Promise<void> {
  if (state.excludesLoaded) {
    return;
  }
  state.customExcludes = await loadExclusionPatterns(basePath);
  state.excludesLoaded = true;
}

/** 带缓存的命令可用性检测 */
export async function isCommandAvailableCached(state: ACEServiceState, command: string): Promise<boolean> {
  const cached = state.commandAvailabilityCache.get(command);
  if (cached !== undefined) {
    return cached;
  }
  const available = await isCommandAvailable(command);
  state.commandAvailabilityCache.set(command, available);
  return available;
}

/** 带缓存的 Git 仓库检测 */
export async function isGitRepository(state: ACEServiceState, directory: string): Promise<boolean> {
  if (state.isGitRepoCache !== null) {
    return state.isGitRepoCache;
  }
  try {
    const gitDir = path.join(directory, ".git");
    const stats = await fs.stat(gitDir);
    const isRepo = stats.isDirectory();
    state.isGitRepoCache = isRepo;
    return isRepo;
  } catch (error) {
    log.debug("ACE service Git repository detection failed", {
      directory,
      error: getCodebaseSearchErrorMessage(error),
    });
    state.isGitRepoCache = false;
    return false;
  }
}

/**
 * 检查索引是否可以使用缓存。
 */
/** canUseIndexCache 的实现 */
export function canUseIndexCache(state: ACEServiceState, forceRefresh: boolean): boolean {
  if (forceRefresh) {
    return false;
  }
  if (state.indexCache.size === 0) {
    return false;
  }
  if (Date.now() - state.lastIndexTime >= INDEX_CACHE_DURATION) {
    return false;
  }
  return true;
}

/** 更新索引的最后访问时间戳 */
export function updateLastIndexTime(state: ACEServiceState): void {
  state.lastIndexTime = Date.now();
}
