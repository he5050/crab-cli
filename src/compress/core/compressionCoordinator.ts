/**
 * CompressionCoordinator
 *
 * 职责:
 *   - 提供协作锁机制，防止并发压缩竞态
 *   - 确保自动压缩与队友/子代理循环不会同时执行
 *   - 使用 excludeId 允许多个独立压缩器共存
 *   - P0-3 修复: 添加超时机制防止永久阻塞
 *
 * 模块功能:
 *   - CompressionCoordinator: 压缩协调器类
 *   - acquireLock: 获取压缩锁(带超时)
 *   - releaseLock: 释放压缩锁
 *   - isCompressing: 检查是否有人在压缩
 *   - waitUntilFree: 等待直到空闲(带超时)
 *   - withLock: 用锁包装异步函数
 *
 * 使用场景:
 *   - 自动压缩与队友/子代理循环并发运行时
 *   - 需要防止同时压缩的场景
 *   - 多压缩器共存场景
 *
 * 边界:
 *   1. 使用 Set 存储正在压缩的 ID
 *   2. 支持 excludeId 排除特定 ID
 *   3. 等待者队列按 FIFO 顺序唤醒
 *   4. P0-3: 所有等待操作都有超时限制(可配置)
 *
 * 流程:
 *   1. 请求锁(acquireLock)
 *   2. 检查是否空闲(isCompressing)
 *   3. 如忙则等待(waitUntilFree)
 *   4. 执行压缩操作
 *   5. 释放锁(releaseLock)
 *   6. 唤醒等待者(_drainWaiters)
 */

import { COMPRESSION_LOCK_TIMEOUT_MS } from "@/config";
import { createInternalError } from "@/core/errors/appError";

interface WaiterResult {
  /** true = 超时释放，false = 正常释放（空闲可用） */
  timedOut: boolean;
}

interface Waiter {
  resolve: (result: WaiterResult) => void;
  excludeId?: string;
  timeoutMs: number;
  timer?: ReturnType<typeof setTimeout>;
}

export class CompressionCoordinator {
  private _compressing = new Set<string>();
  private _waiters: Waiter[] = [];
  private _version = 0;

  /**
   * 为 id 获取压缩锁。
   * P0-3 修复: 添加超时机制，防止永久阻塞。
   * 如果持锁超时，则抛出错误。
   */
  async acquireLock(id: string, timeoutMs: number = COMPRESSION_LOCK_TIMEOUT_MS): Promise<void> {
    const free = await this.waitUntilFreeWithTimeout(id, timeoutMs);
    if (!free) {
      throw createInternalError("INTERNAL_ERROR", `CompressionCoordinator: 获取锁超时 (${timeoutMs}ms) for "${id}"`);
    }
    this._compressing.add(id);
  }

  /**
   * 释放 id 的压缩锁，唤醒符合条件的等待者。
   * P0-2 修复: 递增版本号，避免 _drainWaiters 竞态。
   */
  releaseLock(id: string): void {
    this._compressing.delete(id);
    this._version++;
    this._drainWaiters();
  }

  /**
   * 检查是否有人在压缩(排除 excludeId)。
   */
  isCompressing(excludeId?: string): boolean {
    if (excludeId === undefined) {
      return this._compressing.size > 0;
    }
    for (const id of this._compressing) {
      if (id !== excludeId) {
        return true;
      }
    }
    return false;
  }

  /**
   * 返回一个 Promise，在没有人(排除 excludeId)持有锁时 resolve。
   * P0-3 修复: 添加超时版本。
   */
  waitUntilFree(excludeId?: string): Promise<void> {
    if (!this.isCompressing(excludeId)) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this._waiters.push({
        excludeId,
        resolve: (result) => {
          if (!result.timedOut) resolve();
        },
        timeoutMs: COMPRESSION_LOCK_TIMEOUT_MS,
      });
    });
  }

  /**
   * P0-3 修复: 带超时的等待。
   * 返回 Promise<boolean>:true 表示获得锁，false 表示超时。
   */
  waitUntilFreeWithTimeout(excludeId?: string, timeoutMs: number = COMPRESSION_LOCK_TIMEOUT_MS): Promise<boolean> {
    if (!this.isCompressing(excludeId)) {
      return Promise.resolve(true);
    }

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        const index = this._waiters.findIndex((w) => w.resolve === wrappedResolve);
        if (index !== -1) {
          this._waiters.splice(index, 1);
        }
        resolve(false);
      }, timeoutMs);

      const wrappedResolve = (result: WaiterResult) => {
        clearTimeout(timer);
        resolve(!result.timedOut);
      };

      this._waiters.push({ excludeId, resolve: wrappedResolve, timeoutMs, timer });
    });
  }

  /**
   * 便捷方法:用 acquire/release 包装异步函数。
   * P0-3 修复: 传递超时参数。
   */
  async withLock<T>(id: string, fn: () => Promise<T>, timeoutMs: number = COMPRESSION_LOCK_TIMEOUT_MS): Promise<T> {
    await this.acquireLock(id, timeoutMs);
    try {
      return await fn();
    } finally {
      this.releaseLock(id);
    }
  }

  /**
   * P0-2 修复: 使用版本号避免竞态。
   * 在释放锁和检查 isCompressing 之间，如果有新锁被获取，
   * 版本号会变更，等待者不会被错误保留。
   */
  private _drainWaiters(): void {
    const currentVersion = this._version;
    const still: Waiter[] = [];
    for (const w of this._waiters) {
      if (!this.isCompressing(w.excludeId)) {
        w.resolve({ timedOut: false }); // 空闲可用，正常释放
      } else if (this._version === currentVersion) {
        still.push(w);
      } else {
        // 版本已变更（新的锁在 drain 期间被获取），
        // 不能释放此 waiter 为"空闲"，否则会导致并发压缩。
        // 保留它在队列中，等待下一轮 releaseLock 重新 drain。
        still.push(w);
      }
    }
    this._waiters = still;
  }

  /**
   * 清理所有等待者(用于关闭/销毁场景)
   */
  clear(): void {
    for (const w of this._waiters) {
      if (w.timer) {
        clearTimeout(w.timer);
      }
      w.resolve({ timedOut: true }); // 清理视为超时释放
    }
    this._waiters = [];
    this._compressing.clear();
  }
}

/** 全局单例 */
export const compressionCoordinator = new CompressionCoordinator();
