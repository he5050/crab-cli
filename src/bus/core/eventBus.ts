/**
 * EventBus — 类型安全的发布/订阅事件系统。
 *
 * 核心能力:
 *   - 同步/异步发布与订阅
 *   - 类型/前缀/通配符三种订阅模式
 *   - 事件历史记录(TTL + 容量双约束)
 *   - 高频事件节流(防止 TUI 过载)
 *
 * 边界:
 *   - 纯内存事件分发,不涉及持久化
 *   - 进程退出处理需调用 `installGlobalProcessHandlers(bus)` 显式注册
 *
 * 详细文档:docs/architecture/event-bus.md
 * 高级 API:docs/architecture/bus-advanced-apis.md
 */

import { createLogger } from "@/core/logging/logger";
import { ThrottlePriority } from "@/core/concurrency/throttleQueue";
import { DEFAULT_THROTTLED_EVENT_TYPES } from "./constants";
import { dispatchEventThroughHandlers } from "./dispatch";
import {
  type DurableEventRecord,
  deleteEventsByAggregate,
  getLatestVersion,
  persistEvent,
  replayEvents as replayEventsFromStore,
} from "./durableStore";
import { EventBusHistoryManager } from "./history";
import { EventBusQueueRuntime } from "./queueRuntime";
import { EventBusSubscriptionsManager } from "./subscriptions";
import { EventBusThrottleManager } from "./throttle";
import { type EventDefinition, type EventHandler, type EventHistoryItem, type EventPayload } from "./types";
import { defineEvent, filterExpiredEvents } from "./utils";
const log = createLogger("bus");
export { defineEvent, filterExpiredEvents };
export type { DurableEventRecord, EventDefinition, EventHandler, EventHistoryItem, EventPayload };

export class EventBus {
  private handlers = new Map<string, Set<EventHandler<any>>>();
  private wildcardHandlers = new Set<EventHandler<any>>();
  private eventCount = 0;
  private prefixHandlers = new Map<string, Set<EventHandler<any>>>();
  private readonly queueRuntime: EventBusQueueRuntime;
  private handlerTimeoutMs = 0;
  private _idCounter = 0;
  private validatePayloadInDev: boolean;
  private maxSubscribersPerType: number;
  private readonly historyManager: EventBusHistoryManager;
  private readonly subscriptionsManager: EventBusSubscriptionsManager;
  private readonly throttleManager: EventBusThrottleManager;
  constructor(options?: {
    throttleEnabled?: boolean;
    throttleWindowMs?: number;
    throttledEventTypes?: Set<string>;
    handlerTimeoutMs?: number;
    validatePayloadInDev?: boolean;
    maxSubscribersPerType?: number;
  }) {
    this.handlerTimeoutMs = options?.handlerTimeoutMs ?? 0;
    this.validatePayloadInDev = options?.validatePayloadInDev ?? process.env.NODE_ENV !== "production";
    this.maxSubscribersPerType = options?.maxSubscribersPerType ?? 100;
    this.queueRuntime = new EventBusQueueRuntime({
      dispatch: (type, payload) => this.dispatch(type, payload),
      log,
      flushThrottleToMainQueue: () => this.throttleManager.flushToMainQueue(),
      getThrottleSnapshot: () => this.throttleManager.getSnapshot(),
    });
    this.historyManager = new EventBusHistoryManager({ log });
    this.subscriptionsManager = new EventBusSubscriptionsManager({
      handlers: this.handlers,
      log,
      maxSubscribersPerType: () => this.maxSubscribersPerType,
      prefixHandlers: this.prefixHandlers,
      validatePayloadInDev: () => this.validatePayloadInDev,
      wildcardHandlers: this.wildcardHandlers,
    });
    this.throttleManager = new EventBusThrottleManager({
      enqueueEvent: (item) => this.queueRuntime.enqueue(item),
      hasMainQueueItems: () => !this.queueRuntime.isEmpty,
      isProcessing: () => this.queueRuntime.currentIsProcessing,
      log,
      onMainQueueReady: () => {
        this.queueRuntime.startProcessing();
      },
      throttleEnabled: options?.throttleEnabled,
      throttleWindowMs: options?.throttleWindowMs,
      throttledEventTypes: options?.throttledEventTypes ?? new Set(DEFAULT_THROTTLED_EVENT_TYPES),
    });
  }

  get totalEvents(): number {
    return this.eventCount;
  }

  getHistory(filter?: { type?: string; limit?: number }): EventHistoryItem[] {
    return this.historyManager.getHistory(filter);
  }

  clearHistory(): void {
    this.historyManager.clearHistory();
  }

  setMaxHistorySize(size: number): void {
    this.historyManager.setMaxHistorySize(size);
  }

  publish<T>(
    def: EventDefinition<T>,
    properties: T,
    options?: {
      id?: string;
      throttle?: boolean;
      priority?: ThrottlePriority;
      /** 持久化选项: 将事件写入 durable_events 表用于崩溃恢复/事件溯源 */
      durable?: {
        /** 聚合根 ID(如 sessionId) */
        aggregateId: string;
        /** 聚合内版本号(不传则自动递增) */
        version?: number;
      };
    },
  ): void {
    if (this.validatePayloadInDev && properties == null) {
      log.warn(`事件载荷为 ${properties} (type=${def.type});建议显式传空对象 {}`);
    }

    const payload: EventPayload<T> = {
      id: options?.id ?? `evt_${Date.now().toString(36)}_${(++this._idCounter).toString(36)}`,
      properties,
      type: def.type,
    };

    this.eventCount++;

    this.historyManager.record(def.type, payload);

    // 持久化事件到数据库(用于崩溃恢复/事件溯源)
    if (options?.durable) {
      const { aggregateId, version } = options.durable;
      const resolvedVersion = version ?? getLatestVersion(aggregateId) + 1;
      const seq = persistEvent(payload.id, aggregateId, resolvedVersion, def.type, properties);
      if (seq > 0) {
        log.debug(`事件已持久化: ${def.type} (aggregate=${aggregateId}, seq=${seq}, version=${resolvedVersion})`);
      }
    }

    if (
      !this.throttleManager.enqueueIfNeeded(
        def.type,
        payload as EventPayload<unknown>,
        options?.priority ?? ThrottlePriority.NORMAL,
        options?.throttle,
      )
    ) {
      this.queueRuntime.enqueue({
        payload,
        type: def.type,
        priority: options?.priority ?? ThrottlePriority.NORMAL,
      });

      this.queueRuntime.startProcessing();
    }
  }

  async flush(timeoutMs = 5000): Promise<void> {
    await this.queueRuntime.flush(timeoutMs);
  }

  flushSync(): void {
    this.queueRuntime.flushSync();
  }

  private dispatch(type: string, payload: EventPayload<unknown>): void {
    dispatchEventThroughHandlers({
      handlerTimeoutMs: this.handlerTimeoutMs,
      handlers: this.handlers,
      log,
      payload,
      prefixHandlers: this.prefixHandlers,
      type,
      wildcardHandlers: this.wildcardHandlers,
    });
  }

  setHandlerTimeoutMs(ms: number): void {
    this.handlerTimeoutMs = Math.max(0, ms);
  }

  getHandlerTimeoutMs(): number {
    return this.handlerTimeoutMs;
  }

  subscribe<T>(def: EventDefinition<T>, handler: EventHandler<T>): () => void {
    return this.subscriptionsManager.subscribe(def, handler);
  }

  subscribeOnce<T>(def: EventDefinition<T>, handler: EventHandler<T>): () => void {
    return this.subscriptionsManager.subscribeOnce(def, handler);
  }

  subscribeForSession<T extends { sessionId?: string }>(
    def: EventDefinition<T>,
    sessionId: string,
    handler: EventHandler<T>,
  ): () => void {
    return this.subscriptionsManager.subscribeForSession(def, sessionId, handler);
  }

  subscribeAll(handler: EventHandler<unknown>): () => void {
    return this.subscriptionsManager.subscribeAll(handler);
  }

  subscribePrefix(prefix: string, handler: EventHandler<unknown>): () => void {
    return this.subscriptionsManager.subscribePrefix(prefix, handler);
  }

  clear(): void {
    this.handlers.clear();
    this.wildcardHandlers.clear();
    this.prefixHandlers.clear();
    this.eventCount = 0;
    this.queueRuntime.clear();
    this.historyManager.clearHistory();
    this.throttleManager.clear();
  }

  destroy(): void {
    this.historyManager.destroy();
    this.throttleManager.destroy();
    this.clear();
  }

  setThrottleEnabled(enabled: boolean): void {
    this.throttleManager.setEnabled(enabled);
  }

  isThrottleEnabled(): boolean {
    return this.throttleManager.isEnabled();
  }

  getThrottleSnapshot(): { size: number; isProcessing: boolean } | null {
    return this.throttleManager.getSnapshot();
  }

  debug(): void {
    const throttleSnapshot = this.getThrottleSnapshot();
    const lines: string[] = [
      "=== EventBus 调试信息 ===",
      `总事件数: ${this.eventCount}`,
      `历史记录数: ${this.historyManager.size}/${this.historyManager.currentMaxHistorySize}`,
      `订阅类型数: ${this.handlers.size}`,
      `通配符订阅数: ${this.wildcardHandlers.size}`,
      `前缀订阅数: ${this.prefixHandlers.size}`,
      `节流启用: ${this.throttleManager.isEnabled()}`,
      `节流事件数: ${this.throttleManager.currentThrottledCount}`,
      throttleSnapshot ? `节流队列: ${throttleSnapshot.size} 项` : "节流队列: 未初始化",
      "",
      "订阅类型列表:",
    ];
    for (const [type, handlers] of this.handlers) {
      lines.push(`  ${type}: ${handlers.size} 个订阅者`);
    }
    lines.push("", "最近 10 条事件:");
    const recent = this.historyManager.getRecentHistory(10);
    for (const item of recent) {
      lines.push(`  [${new Date(item.timestamp).toLocaleTimeString()}] ${item.type}`);
    }
    lines.push("========================");
    log.info(lines.join("\n"));
  }

  getMetrics(): {
    totalEvents: number;
    historySize: number;
    subscriberTypes: number;
    wildcardSubscribers: number;
    prefixSubscribers: number;
    throttledCount: number;
    throttleEnabled: boolean;
  } {
    return {
      historySize: this.historyManager.size,
      subscriberTypes: this.handlers.size,
      throttleEnabled: this.throttleManager.isEnabled(),
      throttledCount: this.throttleManager.currentThrottledCount,
      totalEvents: this.eventCount,
      wildcardSubscribers: this.wildcardHandlers.size,
      prefixSubscribers: this.prefixHandlers.size,
    };
  }

  // ─── Durable Event API ────────────────────────────────────

  /**
   * 回放指定聚合根的持久化事件。
   *
   * 从 durable_events 表读取事件记录，并按 seq 升序重新分发到当前 EventBus 的订阅者。
   * 用于会话恢复、崩溃恢复场景。
   *
   * @param aggregateId - 聚合根 ID(如 sessionId)
   * @param fromSeq - 从哪个 seq 开始回放(默认 0 = 全部)
   * @returns 回放的事件数量
   */
  replayEvents(aggregateId: string, fromSeq = 0): number {
    const records = replayEventsFromStore(aggregateId, fromSeq);
    for (const record of records) {
      const payload: EventPayload<unknown> = {
        id: record.id,
        properties: record.data,
        type: record.definition,
      };
      this.eventCount++;
      this.historyManager.record(record.definition, payload);
      dispatchEventThroughHandlers(
        record.definition,
        payload,
        this.handlers,
        this.wildcardHandlers,
        this.prefixHandlers,
      );
    }
    log.info(`回放 ${records.length} 条持久化事件 (aggregate=${aggregateId}, fromSeq=${fromSeq})`);
    return records.length;
  }

  /**
   * 获取指定聚合根的持久化事件记录(不重新分发)。
   *
   * 用于查询/审计场景，不会触发订阅者。
   */
  getDurableEvents(aggregateId: string, fromSeq = 0): DurableEventRecord[] {
    return replayEventsFromStore(aggregateId, fromSeq);
  }

  /**
   * 删除指定聚合根的所有持久化事件。
   *
   * 用于会话清理场景。
   */
  deleteDurableEvents(aggregateId: string): number {
    return deleteEventsByAggregate(aggregateId);
  }
}

export const globalBus = new EventBus();
