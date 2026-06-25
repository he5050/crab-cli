/**
 * EventBusQueueRuntime — 事件队列调度运行时。
 *
 * 职责:
 *   - 管理事件队列(RingBuffer)，包含入队/排空/同步排空
 *   - 基于 queueMicrotask 的异步处理循环
 *   - 提供 flush / flushSync 供外部协调节流与分发
 *
 * 边界:
 *   - 不感知具体事件类型与业务语义
 *   - 不感知节流队列内部结构，通过回调与 ThrottleManager 协作
 *   - dispatch 回调由外部注入，本模块仅负责调度时机
 *
 * 不变量:
 *   - isProcessing 确保同一时刻只有一个排空循环在运行
 *   - drainQueue 排空后重新检查队列，防止 dispatch 期间新入队事件死锁
 *   - flushSync 同步排空，用于退出/录制停止等不能丢事件的边界
 */

import { RingBuffer } from "@/core/concurrency/ringBuffer";
import { MAX_EVENT_QUEUE_SIZE } from "./constants";
import { drainDispatchItems } from "./dispatch";
import type { EventPayload, EventQueueItem } from "./types";

export interface EventBusQueueRuntimeOptions {
  dispatch: (type: string, payload: EventPayload<unknown>) => void;
  log: {
    warn: (message: string) => void;
    debug: (message: string) => void;
  };
  flushThrottleToMainQueue: () => void;
  getThrottleSnapshot: () => { size: number; isProcessing: boolean } | null;
}

export class EventBusQueueRuntime {
  private eventQueue = new RingBuffer<EventQueueItem>(MAX_EVENT_QUEUE_SIZE);
  private isProcessing = false;

  constructor(private readonly options: EventBusQueueRuntimeOptions) {}

  get isEmpty(): boolean {
    return this.eventQueue.isEmpty();
  }

  get currentIsProcessing(): boolean {
    return this.isProcessing;
  }

  enqueue(item: EventQueueItem): void {
    if (this.eventQueue.isFull()) {
      this.options.log.warn(`事件队列已满 (${MAX_EVENT_QUEUE_SIZE})，将覆盖最旧事件`);
    }
    this.eventQueue.push(item);
  }

  startProcessing(): void {
    if (this.isProcessing || this.eventQueue.isEmpty()) {
      return;
    }
    this.isProcessing = true;
    queueMicrotask(() => {
      this.drainQueue();
    });
  }

  async flush(timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      this.options.flushThrottleToMainQueue();
      if (
        this.eventQueue.isEmpty() &&
        !this.isProcessing &&
        (!this.options.getThrottleSnapshot() || this.options.getThrottleSnapshot()!.size === 0)
      ) {
        return;
      }
      await new Promise<void>((resolve) => queueMicrotask(resolve));
    }
    this.options.log.warn(`flush 超时(${timeoutMs}ms)：队列或处理尚未完全排空`);
  }

  flushSync(): void {
    this.options.flushThrottleToMainQueue();
    this.drainQueueSync();
    this.isProcessing = false;
  }

  clear(): void {
    this.eventQueue.clear();
    this.isProcessing = false;
  }

  private drainQueue(): void {
    if (this.eventQueue.isEmpty()) {
      this.isProcessing = false;
      return;
    }
    const items = this.eventQueue.toArray();
    this.eventQueue.clear();
    drainDispatchItems(items, (type, payload) => this.options.dispatch(type, payload));
    this.isProcessing = false;

    if (!this.eventQueue.isEmpty()) {
      this.startProcessing();
    }
  }

  private drainQueueSync(): void {
    if (this.eventQueue.isEmpty()) {
      return;
    }
    const items = this.eventQueue.toArray();
    this.eventQueue.clear();
    drainDispatchItems(items, (type, payload) => this.options.dispatch(type, payload));
  }
}
