/**
 * 节流队列 (Throttle Queue) — 通用基础设施。
 *
 * 职责:
 *   - 高频事件流的节流和缓冲
 *   - 防止下游消费者被高频更新冲垮
 *   - 合并同类事件减少处理次数
 *   - 支持优先级队列，高优先级消息优先通过
 *
 * 设计:
 *   - 本模块原位于 @ui/throttleQueue，Phase 4 P1-14 抽象到 @core，
 *     供 EventBus、UI 渲染管线、Shell 流输出等通用场景使用。
 *   - 公共 API(ThrottlePriority / ThrottleItem / ThrottleConfig /
 *     ThrottleQueue / createThrottleQueue / createLogThrottleQueue /
 *     createHighPriorityThrottleQueue / createThrottleDecorator)保持不变。
 *   - 旧路径 @ui/throttleQueue 仍可通过 re-export 使用，不破坏调用方。
 *
 * 模块功能:
 *   - ThrottleQueue: 节流队列类
 *   - ThrottleConfig: 节流配置
 *   - ThrottleItem: 队列项
 *   - createThrottleQueue: 创建节流队列实例
 *   - createLogThrottleQueue: 日志专用工厂
 *   - createHighPriorityThrottleQueue: 高优先级工厂
 *   - createThrottleDecorator: 函数节流装饰器
 *
 * 边界:
 *   1. 队列项有优先级，高优先级项优先出队
 *   2. 窗口期内的同类事件会被合并
 *   3. 支持最大队列长度限制，防止内存溢出
 *   4. 支持同步和异步两种消费模式
 */

import { createLogger } from "@/core/logging/logger";
import { RingBuffer } from "@/core/concurrency/ringBuffer";

const log = createLogger("core:throttle-queue");

// ─── 类型定义 ────────────────────────────────────────────────────

/** 消息优先级 */
export enum ThrottlePriority {
  /** 低优先级 - 普通日志 */
  LOW = 0,
  /** 普通优先级 - 信息 */
  NORMAL = 1,
  /** 高优先级 - 警告 */
  HIGH = 2,
  /** 最高优先级 - 错误/关键事件 */
  CRITICAL = 3,
}

/** 队列项 */
export interface ThrottleItem<T = unknown> {
  /** 唯一标识 */
  id: string;
  /** 消息类型 */
  type: string;
  /** 消息内容 */
  payload: T;
  /** 优先级 */
  priority: ThrottlePriority;
  /** 入队时间 */
  enqueuedAt: number;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/** 节流配置 */
export interface ThrottleConfig {
  /** 窗口大小(毫秒)，默认 100ms */
  windowMs?: number;
  /** 最大队列长度，默认 1000 */
  maxQueueSize?: number;
  /** 最大等待时间(毫秒)，默认 1000ms */
  maxWaitMs?: number;
  /** 是否合并同类事件 */
  mergeSimilar?: boolean;
  /** 合并键提取函数 */
  mergeKeyExtractor?: (item: ThrottleItem) => string;
  /** 高优先级跳过等待 */
  priorityBypass?: boolean;
  /** 队列耗尽回调 */
  onQueueEmpty?: () => void;
  /** 队列溢出回调 */
  onOverflow?: (dropped: ThrottleItem[]) => void;
}

/** 解析后的完整配置 */
interface ResolvedThrottleConfig {
  windowMs: number;
  maxQueueSize: number;
  maxWaitMs: number;
  mergeSimilar: boolean;
  mergeKeyExtractor?: (item: ThrottleItem) => string;
  priorityBypass: boolean;
  onQueueEmpty?: () => void;
  onOverflow?: (dropped: ThrottleItem[]) => void;
}

// ─── ID 生成器 ────────────────────────────────────────────────────

let itemCounter = 0;
function generateId(): string {
  return `${Date.now()}-${++itemCounter}`;
}

// ─── 节流队列类 ──────────────────────────────────────────────────

/**
 * 节流队列
 *
 * 用于在高频率事件流和低频率消费之间建立缓冲，
 * 防止高频事件冲垮下游消费者。
 */
export class ThrottleQueue<T = unknown> {
  private readonly config: ResolvedThrottleConfig;
  private queue: RingBuffer<ThrottleItem<T>> = new RingBuffer<ThrottleItem<T>>(1000);
  private mergeMap = new Map<string, ThrottleItem<T>>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastFlushTime: number = 0;
  private isProcessing: boolean = false;
  private isDestroyed: boolean = false;

  constructor(config: ThrottleConfig = {}) {
    this.config = {
      maxQueueSize: config.maxQueueSize ?? 1000,
      maxWaitMs: config.maxWaitMs ?? 1000,
      mergeKeyExtractor: config.mergeKeyExtractor,
      mergeSimilar: config.mergeSimilar ?? true,
      onOverflow: config.onOverflow,
      onQueueEmpty: config.onQueueEmpty,
      priorityBypass: config.priorityBypass ?? true,
      windowMs: config.windowMs ?? 100,
    };

    log.debug(`节流队列初始化: window=${this.config.windowMs}ms, maxSize=${this.config.maxQueueSize}`);
  }

  /**
   * 入队
   */
  enqueue(
    type: string,
    payload: T,
    priority: ThrottlePriority = ThrottlePriority.NORMAL,
    metadata?: Record<string, unknown>,
  ): string {
    if (this.isDestroyed) {
      log.warn("节流队列已销毁，忽略入队");
      return "";
    }

    const id = generateId();
    const item: ThrottleItem<T> = { enqueuedAt: Date.now(), id, metadata, payload, priority, type };

    let mergeKey: string | undefined;

    // 尝试合并
    if (this.config.mergeSimilar && this.config.mergeKeyExtractor) {
      mergeKey = this.config.mergeKeyExtractor(item);
      const existing = this.mergeMap.get(mergeKey);

      if (existing) {
        // 合并:更新已有项，不添加到队列
        existing.payload = payload;
        existing.enqueuedAt = Date.now();
        existing.metadata = metadata;

        // 如果新项优先级更高，提升队列中的优先级
        if (priority > existing.priority) {
          existing.priority = priority;
          this.sortQueue();
        }

        return existing.id;
      }
    }

    // 队列溢出检查(只在添加新项到队列时)
    if (this.queue.size >= this.config.maxQueueSize) {
      const dropped = this.queue.shift()!;
      if (this.config.mergeSimilar && this.config.mergeKeyExtractor) {
        const dropKey = this.config.mergeKeyExtractor(dropped);
        // 只有当 dropKey 与当前 mergeKey 不同时才删除
        // 否则说明溢出的是旧项，而新项已经占用同一个 key
        if (dropKey !== mergeKey) {
          this.mergeMap.delete(dropKey);
        }
      }
      this.config.onOverflow?.([dropped]);
      log.warn(`队列溢出，丢弃: ${dropped.type}`);
    }

    // 添加到 mergeMap(如果是新项且启用合并)
    if (mergeKey !== undefined) {
      this.mergeMap.set(mergeKey, item);
    }

    // 添加到队列
    this.queue.push(item);
    this.sortQueue();

    // 调度刷新
    this.scheduleFlush();

    return id;
  }

  /**
   * 出队(消费)
   */
  dequeue(): ThrottleItem<T> | undefined {
    const item = this.queue.shift();
    if (item && this.config.mergeSimilar && this.config.mergeKeyExtractor) {
      const key = this.config.mergeKeyExtractor(item);
      this.mergeMap.delete(key);
    }
    return item;
  }

  /**
   * 批量出队
   */
  dequeueBatch(count: number): ThrottleItem<T>[] {
    const items: ThrottleItem<T>[] = [];
    for (let i = 0; i < count && this.queue.size > 0; i++) {
      const item = this.queue.shift();
      if (item) {
        items.push(item);
        if (this.config.mergeSimilar && this.config.mergeKeyExtractor) {
          const key = this.config.mergeKeyExtractor(item);
          this.mergeMap.delete(key);
        }
      }
    }
    return items;
  }

  /**
   * 获取队列长度
   */
  size(): number {
    return this.queue.size;
  }

  /**
   * 检查队列是否为空
   */
  isEmpty(): boolean {
    return this.queue.isEmpty();
  }

  /**
   * 清空队列
   */
  clear(): ThrottleItem<T>[] {
    const items = this.queue.toArray();
    this.queue.clear();
    this.mergeMap.clear();
    this.stopTimer();
    return items;
  }

  /**
   * 调度刷新
   */
  private scheduleFlush(delayMs?: number): void {
    // 如果明确指定延迟为0，立即执行
    if (delayMs === 0) {
      this.flush();
      return;
    }

    if (this.timer) {
      // 已有定时器，可能需要更新
      if (delayMs !== undefined && delayMs < this.getRemainingTime()) {
        this.stopTimer();
      } else {
        return;
      }
    }

    // 计算延迟
    let delay: number;
    if (delayMs !== undefined) {
      delay = delayMs;
    } else {
      // 首次刷新时，使用 maxWaitMs
      if (this.lastFlushTime === 0) {
        delay = this.config.maxWaitMs;
      } else {
        const elapsed = Date.now() - this.lastFlushTime;
        delay = Math.min(this.config.windowMs, this.config.maxWaitMs - elapsed);
      }
    }

    if (delay <= 0) {
      this.flush();
      return;
    }

    this.timer = setTimeout(() => {
      this.flush();
    }, delay);
  }

  /**
   * 获取剩余等待时间
   */
  private getRemainingTime(): number {
    if (!this.timer) {
      return Infinity;
    }
    return Math.max(0, this.config.windowMs - (Date.now() - this.lastFlushTime));
  }

  /**
   * 停止定时器
   */
  private stopTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * 刷新队列
   */
  /**
   * 刷新队列，返回出队的所有 items 供消费者处理。
   * @returns 出队的 item 列表（可能为空）
   */
  flush(): ThrottleItem<T>[] {
    if (this.isProcessing || this.isDestroyed) {
      return [];
    }

    this.stopTimer();
    this.isProcessing = true;
    this.lastFlushTime = Date.now();

    // 批量出队
    const items = this.dequeueBatch(this.queue.size);
    this.isProcessing = false;

    if (items.length > 0) {
      log.debug(`刷新队列: ${items.length} 项`);
    }

    // 队列为空回调
    if (this.isEmpty()) {
      this.config.onQueueEmpty?.();
    }

    // 如果队列还有内容，调度下一次刷新
    if (!this.isEmpty()) {
      this.scheduleFlush();
    }

    return items;
  }

  /**
   * 强制刷新(立即)
   */
  forceFlush(): ThrottleItem<T>[] {
    this.stopTimer();
    const items = this.clear();
    this.lastFlushTime = Date.now();
    return items;
  }

  /**
   * 暂停入队
   */
  pause(): void {
    this.stopTimer();
  }

  /**
   * 恢复入队
   * 注意:恢复时不会立即刷新队列，只是重新开始计时
   */
  resume(): void {
    if (!this.isEmpty()) {
      // 只重新调度刷新计时器，不立即刷新
      this.scheduleFlush(this.config.windowMs);
    }
  }

  /**
   * 销毁队列
   */
  destroy(): void {
    this.isDestroyed = true;
    this.stopTimer();
    this.queue.clear();
    this.mergeMap.clear();
    log.debug("节流队列已销毁");
  }

  /**
   * 按优先级排序队列
   */
  private sortQueue(): void {
    // RingBuffer 不支持原地排序；导出快照排序后重建
    const sorted = this.queue.toArray().toSorted((a, b) => {
      // 优先级高的在前
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      // 早入队的在前
      return a.enqueuedAt - b.enqueuedAt;
    });
    this.queue.clear();
    for (const item of sorted) {
      this.queue.push(item);
    }
  }

  /**
   * 获取队列快照(用于调试)
   */
  getSnapshot(): {
    size: number;
    isProcessing: boolean;
    lastFlushTime: number;
    nextFlushIn: number;
  } {
    return {
      isProcessing: this.isProcessing,
      lastFlushTime: this.lastFlushTime,
      nextFlushIn: this.getRemainingTime(),
      size: this.queue.size,
    };
  }
}

/**
 * 创建节流队列
 */
export function createThrottleQueue<T = unknown>(config?: ThrottleConfig): ThrottleQueue<T> {
  return new ThrottleQueue<T>(config);
}

/**
 * 创建日志专用节流队列
 *
 * 特点:
 * - 100ms 窗口
 * - 合并相同日志类型的消息
 * - 最大 1000 条缓冲
 */
export function createLogThrottleQueue<T = unknown>(config?: ThrottleConfig): ThrottleQueue<T> {
  return new ThrottleQueue<T>({
    maxQueueSize: 1000,
    mergeKeyExtractor: (item) => item.type,
    mergeSimilar: true,
    priorityBypass: true,
    windowMs: 100,
    ...config,
  });
}

/**
 * 创建高优先级节流队列
 *
 * 特点:
 * - 低延迟(50ms)
 * - 不合并消息
 * - 高优先级消息立即通过
 */
export function createHighPriorityThrottleQueue<T = unknown>(config?: ThrottleConfig): ThrottleQueue<T> {
  return new ThrottleQueue<T>({
    maxQueueSize: 100,
    mergeSimilar: false,
    priorityBypass: true,
    windowMs: 50,
    ...config,
  });
}

/**
 * 节流装饰器工厂
 *
 * 用于装饰函数，自动进行节流。
 */
export function createThrottleDecorator<T extends (...args: unknown[]) => unknown>(fn: T, config?: ThrottleConfig): T {
  const queue = new ThrottleQueue<T>(config);
  let pendingArgs: Parameters<T> | null = null;

  queue.enqueue = (type: string, payload: unknown) => {
    pendingArgs = payload as Parameters<T>;
    return type;
  };

  return ((...args: Parameters<T>) => {
    pendingArgs = args;
    return queue.flush();
  }) as T;
}
