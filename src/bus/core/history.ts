/**
 * EventBusHistoryManager — 事件历史记录管理。
 *
 * 职责:
 *   - 基于 RingBuffer 的事件历史存储（容量约束）
 *   - 按 TTL 定时清理过期事件
 *   - 提供按类型/数量过滤的历史查询
 *
 * 边界:
 *   - 纯内存存储，不涉及持久化
 *   - 不感知事件语义，仅按时间戳管理生命周期
 *
 * 不变量:
 *   - maxHistorySize <= 0 时停止记录但不阻止旧历史查询
 *   - cleanupTimer 使用 unref()，不阻止进程退出
 */
import { EVENT_HISTORY_TTL_MS, MAX_EVENT_HISTORY_SIZE } from "@/config/constants";
import { RingBuffer } from "@/core/concurrency/ringBuffer";
import { HISTORY_CLEANUP_INTERVAL_MS } from "./constants";
import type { EventHistoryItem, EventPayload } from "./types";

interface EventBusHistoryManagerOptions {
  log: { debug: (message: string) => void };
}

export class EventBusHistoryManager {
  private eventHistory: RingBuffer<EventHistoryItem>;
  private maxHistorySize = MAX_EVENT_HISTORY_SIZE;
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(private readonly options: EventBusHistoryManagerOptions) {
    this.eventHistory = new RingBuffer<EventHistoryItem>(MAX_EVENT_HISTORY_SIZE);
    this.startCleanupTimer();
  }

  get size(): number {
    return this.eventHistory.size;
  }

  get currentMaxHistorySize(): number {
    return this.maxHistorySize;
  }

  record<T>(type: string, payload: EventPayload<T>): void {
    if (this.maxHistorySize <= 0) {
      return;
    }

    this.eventHistory.push({
      payload: { ...payload, properties: { ...payload.properties } },
      timestamp: Date.now(),
      type,
    });
  }

  getHistory(filter?: { type?: string; limit?: number }): EventHistoryItem[] {
    let history = this.eventHistory.toArray();
    if (filter?.type) {
      history = history.filter((item) => item.type === filter.type);
    }
    if (filter?.limit) {
      history = history.slice(-filter.limit);
    }
    return history;
  }

  clearHistory(): void {
    this.eventHistory.clear();
  }

  setMaxHistorySize(size: number): void {
    this.maxHistorySize = size;
    const all = this.eventHistory.toArray();
    if (size <= 0) {
      this.eventHistory.clear();
      return;
    }
    this.eventHistory = new RingBuffer<EventHistoryItem>(size);
    const keep = all.slice(-size);
    for (const item of keep) {
      this.eventHistory.push(item);
    }
  }

  getRecentHistory(limit = 10): EventHistoryItem[] {
    return this.eventHistory.toArray().slice(-limit);
  }

  destroy(): void {
    this.stopCleanupTimer();
    this.clearHistory();
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredHistory();
    }, HISTORY_CLEANUP_INTERVAL_MS);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  private stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  private cleanupExpiredHistory(): void {
    if (this.eventHistory.isEmpty()) {
      return;
    }

    const cutoff = Date.now() - EVENT_HISTORY_TTL_MS;
    let removed = 0;
    while (!this.eventHistory.isEmpty()) {
      const oldest = this.eventHistory.peek()!;
      if (oldest.timestamp >= cutoff) {
        break;
      }
      this.eventHistory.shift();
      removed++;
    }

    if (removed > 0) {
      this.options.log.debug(`清理事件历史: ${removed} 条过期事件已移除`);
    }
  }
}
