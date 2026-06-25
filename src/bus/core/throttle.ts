import { ThrottlePriority, type ThrottleQueue, createLogThrottleQueue } from "@/core/concurrency/throttleQueue";
import type { EventPayload, EventQueueItem } from "./types";

interface EventBusThrottleManagerOptions {
  throttleEnabled?: boolean;
  throttleWindowMs?: number;
  throttledEventTypes?: Set<string>;
  enqueueEvent: (item: EventQueueItem) => void;
  isProcessing: () => boolean;
  hasMainQueueItems: () => boolean;
  onMainQueueReady: () => void;
  log: { warn: (message: string) => void };
}

export class EventBusThrottleManager {
  private _throttleQueue?: ThrottleQueue<EventPayload<unknown>>;
  private _throttleConfig?: { windowMs?: number };
  private throttleEnabled = true;
  private throttledCount = 0;
  private readonly throttledEventTypes: Set<string>;

  constructor(private readonly options: EventBusThrottleManagerOptions) {
    this.throttledEventTypes = options.throttledEventTypes ?? new Set();
    if (options.throttleEnabled !== false) {
      this.throttleEnabled = true;
      this._throttleConfig = { windowMs: options.throttleWindowMs ?? 100 };
    } else {
      this.throttleEnabled = false;
    }
  }

  get currentThrottledCount(): number {
    return this.throttledCount;
  }

  enqueueIfNeeded(
    type: string,
    payload: EventPayload<unknown>,
    priority: ThrottlePriority,
    throttleOverride?: boolean,
  ): boolean {
    const shouldThrottle = throttleOverride ?? this.throttledEventTypes.has(type);
    const throttleQueue = this.getThrottleQueue();
    if (!shouldThrottle || !throttleQueue) {
      return false;
    }

    throttleQueue.enqueue(type, payload, priority);
    this.throttledCount++;
    this.scheduleConsume();
    return true;
  }

  flushToMainQueue(): void {
    const throttleQueue = this.getThrottleQueue();
    let moved = false;
    while (throttleQueue && throttleQueue.size() > 0) {
      const item = throttleQueue.dequeue();
      if (item) {
        this.options.enqueueEvent({
          payload: item.payload,
          priority: item.priority ?? ThrottlePriority.NORMAL,
          type: item.type,
        });
        moved = true;
      }
    }
    if (moved && this.options.hasMainQueueItems()) {
      this.options.onMainQueueReady();
    }
  }

  setEnabled(enabled: boolean): void {
    this.throttleEnabled = enabled;
    if (!enabled) {
      this._throttleQueue?.clear();
    }
  }

  isEnabled(): boolean {
    return this.throttleEnabled;
  }

  getSnapshot(): { size: number; isProcessing: boolean } | null {
    const queue = this.getThrottleQueue();
    return queue?.getSnapshot() ?? null;
  }

  clear(): void {
    this._throttleQueue?.clear();
    this.throttledCount = 0;
  }

  destroy(): void {
    this._throttleQueue?.destroy();
    this._throttleQueue = undefined;
    this.throttledCount = 0;
  }

  private getThrottleQueue(): ThrottleQueue<EventPayload<unknown>> | undefined {
    if (!this.throttleEnabled) {
      return undefined;
    }

    if (!this._throttleQueue) {
      this._throttleQueue = createLogThrottleQueue<EventPayload<unknown>>({
        maxQueueSize: 500,
        mergeKeyExtractor: (item: { type: string }) => item.type,
        mergeSimilar: true,
        onOverflow: (dropped: unknown[]) => {
          this.options.log.warn(`节流队列溢出，丢弃 ${dropped.length} 个事件`);
        },
        onQueueEmpty: () => {},
        priorityBypass: true,
        windowMs: this._throttleConfig?.windowMs ?? 100,
      });
    }

    return this._throttleQueue;
  }

  private scheduleConsume(): void {
    const throttleQueue = this.getThrottleQueue();
    if (!throttleQueue || throttleQueue.size() === 0) {
      return;
    }
    queueMicrotask(() => this.consume());
  }

  private consume(): void {
    const throttleQueue = this.getThrottleQueue();
    if (!throttleQueue || this.options.isProcessing()) {
      return;
    }

    const batchSize = 50;
    let itemCount = 0;
    while (throttleQueue.size() > 0 && itemCount < batchSize) {
      const item = throttleQueue.dequeue();
      if (item) {
        this.options.enqueueEvent({
          payload: item.payload,
          priority: item.priority ?? ThrottlePriority.NORMAL,
          type: item.type,
        });
        itemCount++;
      }
    }

    if (throttleQueue.size() > 0) {
      queueMicrotask(() => this.consume());
    }

    if (itemCount > 0) {
      this.options.onMainQueueReady();
    }
  }
}
