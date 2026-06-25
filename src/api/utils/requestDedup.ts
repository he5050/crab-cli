/**
 * 请求去重缓存。
 *
 * 防止并发重复请求：当多个相同的 LLM 请求同时发起时，
 * 只有第一个请求会实际执行，后续相同请求共享同一个响应流。
 *
 * 去重键基于 (providerId, modelId, messages 哈希) 生成。
 * 缓存结果在请求完成后保留短暂时间（默认 5s），期间相同请求直接返回缓存结果。
 */
import { createLogger } from "@/core/logging/logger";

const log = createLogger("requestDedup");

interface PendingRequest {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  createdAt: number;
}

interface CachedResult {
  value: unknown;
  cachedAt: number;
  ttlMs: number;
}

const pendingRequests = new Map<string, PendingRequest>();
const resultCache = new Map<string, CachedResult>();

const DEFAULT_TTL_MS = 5000;
const PENDING_CLEANUP_INTERVAL_MS = 60000;
/** pending request 最大存活时间(ms)，防止异常请求永远挂起 */
const PENDING_MAX_AGE_MS = 120_000;

/**
 * 在去重保护下执行异步操作。
 * 如果已有相同请求在途，则等待该请求完成并共享结果。
 * 如果已有缓存结果且在 TTL 内，直接返回缓存。
 */
export function withRequestDedup<T>(key: string, factory: () => Promise<T>, options?: { ttlMs?: number }): Promise<T> {
  const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;

  // 检查缓存
  const cached = resultCache.get(key);
  if (cached && Date.now() - cached.cachedAt < cached.ttlMs) {
    return Promise.resolve(cached.value as T);
  }
  resultCache.delete(key);

  // 检查在途请求（带 TTL 保护，防止异常挂起的请求永远阻塞）
  const existing = pendingRequests.get(key);
  if (existing) {
    // 若 pending 请求已超过最大存活时间，视为死请求并清理
    if (Date.now() - existing.createdAt > PENDING_MAX_AGE_MS) {
      pendingRequests.delete(key);
      log.warn(`pending request expired (${PENDING_MAX_AGE_MS}ms), key=${key}`);
    } else {
      return existing.promise as Promise<T>;
    }
  }

  // 创建新请求
  let resolveFn: (value: unknown) => void;
  let rejectFn: (error: Error) => void;
  const sharedPromise = new Promise<unknown>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });

  const pending: PendingRequest = {
    promise: sharedPromise,
    resolve: resolveFn!,
    reject: rejectFn!,
    createdAt: Date.now(),
  };
  pendingRequests.set(key, pending);

  // Execute factory and wire up resolution/rejection
  factory()
    .then((result) => {
      resultCache.set(key, { value: result, cachedAt: Date.now(), ttlMs });
      pending.resolve(result);
    })
    .catch((error: unknown) => {
      // 克隆 Error 对象：防止同一个 Error 实例被多个消费者共享和污染
      const original = error instanceof Error ? error : new Error(String(error));
      const cloned = new Error(original.message);
      cloned.stack = original.stack;
      for (const key of Object.keys(original)) {
        (cloned as unknown as Record<string, unknown>)[key] = (original as unknown as Record<string, unknown>)[key];
      }
      pending.reject(cloned);
    })
    .finally(() => {
      pendingRequests.delete(key);
    });

  return sharedPromise as Promise<T>;
}

/** 清理过期的缓存结果 */
export function cleanupResultCache(): void {
  const now = Date.now();
  for (const [key, cached] of resultCache.entries()) {
    if (now - cached.cachedAt > cached.ttlMs) {
      resultCache.delete(key);
    }
  }
}

/** 清理所有缓存和待处理请求 */
export function clearRequestDedup(): void {
  pendingRequests.clear();
  resultCache.clear();
}

/** 获取去重统计信息 */
export function getRequestDedupStats(): {
  pendingCount: number;
  cachedCount: number;
} {
  cleanupResultCache();
  return {
    pendingCount: pendingRequests.size,
    cachedCount: resultCache.size,
  };
}

/** 清理超龄挂起的 pending 请求，防止死请求永久阻塞消费者 */
function cleanupStalePendingRequests(): void {
  const now = Date.now();
  for (const [key, pending] of pendingRequests.entries()) {
    if (now - pending.createdAt > PENDING_MAX_AGE_MS) {
      pendingRequests.delete(key);
      pending.reject(new Error(`Pending request expired (${PENDING_MAX_AGE_MS}ms), key=${key}`));
      log.warn(`Cleaned up stale pending request`, {
        eventType: "requestDedup.stale-cleanup",
        ageMs: now - pending.createdAt,
        key,
      });
    }
  }
}

// ─── 生命周期管理：定期清理 ────────────────────────────────────────

let dedupCleanupTimer: ReturnType<typeof setInterval> | undefined;

/** 启动定期清理（默认每 60 秒），重复调用安全（仅启动一次） */
function startDedupCleanup(): void {
  if (dedupCleanupTimer) {
    return;
  }
  dedupCleanupTimer = setInterval(() => {
    cleanupResultCache();
    cleanupStalePendingRequests();
  }, PENDING_CLEANUP_INTERVAL_MS);
  dedupCleanupTimer.unref();
}

/** 停止定期清理（测试 teardown 时调用） */
export function stopDedupCleanup(): void {
  if (dedupCleanupTimer) {
    clearInterval(dedupCleanupTimer);
    dedupCleanupTimer = undefined;
  }
}

// 模块加载时自动启动
startDedupCleanup();
