/**
 * 已验证方法的内存缓存层。
 *
 * 职责:
 *   - 管理 verifiedMethods 内存缓存（带 TTL）
 *   - 定期清理过期缓存项
 *
 * 此模块与 fallback.ts 的分工:
 *   - fallbackCache: 纯缓存/状态管理（Map、TTL、清理定时器）
 *   - fallback:     降级探测逻辑、DI、并发锁、回写配置
 */

import { type RequestMethod } from "@/schema/config";

/** 降级方法缓存项（带时间戳） */
export interface VerifiedMethodEntry {
  method: RequestMethod;
  verifiedAt: number; // 验证时间戳
}

/** 内存缓存:providerId:modelId → 已验证可用的 requestMethod（带 TTL） */
const verifiedMethods = new Map<string, VerifiedMethodEntry>();

/** 缓存 TTL：24 小时（毫秒） */
const VERIFIED_METHOD_TTL_MS = 24 * 60 * 60 * 1000;

/** 缓存键生成 */
export function verifiedKey(providerId: string, modelId?: string): string {
  return `${providerId}:${modelId ?? "*"}`;
}

/** 获取指定 key 的缓存项（带 TTL 检查和过期清理） */
export function getVerifiedEntry(key: string): VerifiedMethodEntry | undefined {
  const entry = verifiedMethods.get(key);
  if (!entry) {
    return undefined;
  }
  if (Date.now() - entry.verifiedAt > VERIFIED_METHOD_TTL_MS) {
    verifiedMethods.delete(key);
    return undefined;
  }
  return entry;
}

/** 设置已验证的方法 */
export function setVerifiedMethod(providerId: string, method: RequestMethod, modelId?: string): void {
  const entry: VerifiedMethodEntry = {
    method,
    verifiedAt: Date.now(),
  };
  verifiedMethods.set(verifiedKey(providerId, modelId), entry);
}

/**
 * 清除所有已验证的方法缓存。
 * 通常在配置变更或健康检查失败时调用。
 */
export function clearVerifiedMethods(): void {
  verifiedMethods.clear();
}

/**
 * 清除指定 provider 的过期缓存项。
 * @param providerId 可选，指定要清理的 provider；不传则清理所有过期项
 */
export function cleanupExpiredVerifiedMethods(providerId?: string): void {
  const now = Date.now();
  for (const [key, entry] of verifiedMethods.entries()) {
    // 如果指定了 providerId，只清理该 provider 的缓存
    if (providerId && !key.startsWith(`${providerId}:`) && key !== providerId) {
      continue;
    }

    // 清理过期的缓存项
    if (now - entry.verifiedAt > VERIFIED_METHOD_TTL_MS) {
      verifiedMethods.delete(key);
    }
  }
}

// ─── 生命周期管理：定期清理过期的 verifiedMethods 缓存 ──────────

/**
 * @internal 仅用于测试：直接写入缓存条目（可指定 verifiedAt 时间戳模拟过期）。
 */
export function _setEntryForTesting(key: string, method: RequestMethod, verifiedAt: number): void {
  verifiedMethods.set(key, { method, verifiedAt });
}

let cleanupTimer: ReturnType<typeof setInterval> | undefined;

/** 启动定期清理（默认每 5 分钟），重复调用安全（仅启动一次） */
function startCleanup(): void {
  if (cleanupTimer) {
    return;
  }
  cleanupTimer = setInterval(() => cleanupExpiredVerifiedMethods(), 5 * 60 * 1000);
  cleanupTimer.unref();
}

/** 停止定期清理（测试 teardown 时调用） */
export function stopFallbackCacheCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = undefined;
  }
}

// 模块加载时自动启动
startCleanup();
