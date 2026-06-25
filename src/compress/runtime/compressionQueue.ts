/**
 * 压缩任务优先级队列 — 管理压缩任务的调度和执行。
 *
 * 职责:
 *   - 管理待执行的压缩任务
 *   - 基于优先级的任务调度
 *   - 并发控制(最多同时执行 N 个压缩)
 *   - 任务取消和超时处理
 *   - 任务状态跟踪
 *
 * 使用场景:
 *   - 多会话并发运行时，优先压缩高优先级会话
 *   - 控制压缩并发数量，避免资源竞争
 *   - 取消已过期的压缩任务
 *
 * 边界:
 *   1. 任务按优先级排序，高优先级先执行
 *   2. 同优先级按 FIFO 顺序执行
 *   3. 支持任务超时自动取消
 *   4. 支持暂停/恢复队列
 */

import { createLogger } from "@/core/logging/logger";
import { RingBuffer } from "@/core/concurrency/ringBuffer";
import { createInternalError } from "@/core/errors/appError";

const log = createLogger("compress:queue");

// ─── 类型定义 ─────────────────────────────────────────────────────

/** 压缩任务优先级 */
export enum CompressionPriority {
  /** 低优先级 - 后台压缩 */
  LOW = 0,
  /** 普通优先级 - 默认 */
  NORMAL = 1,
  /** 高优先级 - 用户等待 */
  HIGH = 2,
  /** 紧急优先级 - 必须立即执行 */
  URGENT = 3,
}

/** 压缩任务状态 */
export type CompressionTaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled" | "timeout";

/** 压缩任务 */
export interface CompressionTask {
  /** 任务 ID */
  id: string;
  /** 会话 ID */
  sessionId: string;
  /** 任务优先级 */
  priority: CompressionPriority;
  /** 任务状态 */
  status: CompressionTaskStatus;
  /** 创建时间 */
  createdAt: number;
  /** 开始执行时间 */
  startedAt?: number;
  /** 完成时间 */
  completedAt?: number;
  /** 预估 token 数 */
  estimatedTokens?: number;
  /** 实际 token 数 */
  actualTokens?: number;
  /** 错误信息 */
  error?: string;
  /** 任务执行函数 */
  execute: () => Promise<void>;
}

/** 压缩队列配置 */
export interface CompressionQueueConfig {
  /** 最大并发数 */
  maxConcurrency?: number;
  /** 任务超时(毫秒) */
  taskTimeoutMs?: number;
  /** 队列满时的策略 */
  onQueueFull?: "reject" | "drop-lowest" | "wait";
  /** 最大队列长度 */
  maxQueueSize?: number;
}

// ─── 压缩队列 ────────────────────────────────────────────────────

/**
 * 压缩任务优先级队列
 */
export class CompressionQueue {
  private queue: RingBuffer<CompressionTask> = new RingBuffer<CompressionTask>(100);
  private runningTasks = new Map<string, CompressionTask>();
  private completedTasks: CompressionTask[] = [];
  private paused: boolean = false;
  private scheduleRequested: boolean = false;
  private config: Required<CompressionQueueConfig>;
  private taskCounter: number = 0;
  private listeners = new Set<() => void>();

  constructor(config: CompressionQueueConfig = {}) {
    this.config = {
      maxConcurrency: config.maxConcurrency ?? 2,
      maxQueueSize: config.maxQueueSize ?? 100,
      onQueueFull: config.onQueueFull ?? "drop-lowest",
      taskTimeoutMs: config.taskTimeoutMs ?? 60_000,
    };
    // 重新构造以匹配用户指定的 maxQueueSize
    this.queue = new RingBuffer<CompressionTask>(this.config.maxQueueSize);
  }

  /**
   * 订阅队列状态变更事件
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 添加压缩任务
   */
  enqueue(
    sessionId: string,
    execute: () => Promise<void>,
    options: {
      priority?: CompressionPriority;
      estimatedTokens?: number;
    } = {},
  ): string {
    // 队列已满
    if (this.queue.size >= this.config.maxQueueSize) {
      if (this.config.onQueueFull === "reject") {
        throw createInternalError("INTERNAL_ERROR", "压缩队列已满");
      }
      if (this.config.onQueueFull === "drop-lowest") {
        // 移除最低优先级的任务
        this.dropLowestPriority();
      }
    }

    const id = `compress-${++this.taskCounter}-${Date.now()}`;
    const task: CompressionTask = {
      createdAt: Date.now(),
      estimatedTokens: options.estimatedTokens,
      execute,
      id,
      priority: options.priority ?? CompressionPriority.NORMAL,
      sessionId,
      status: "pending",
    };

    this.queue.push(task);
    this.sortQueue();

    log.debug(
      `压缩任务入队: ${id}, session=${sessionId}, priority=${CompressionPriority[task.priority]}, ` +
        `队列长度=${this.queue.size}`,
    );

    // 尝试执行
    this.requestSchedule();

    return id;
  }

  /**
   * 取消任务。
   * 注意：RingBuffer 操作在单线程环境下是原子的，
   * 但为了健壮性，使用过滤后一次性重建队列。
   */
  cancel(taskId: string): boolean {
    // 检查等待队列
    const snapshot = this.queue.toArray();
    const index = snapshot.findIndex((t) => t.id === taskId);
    if (index !== -1) {
      snapshot[index]!.status = "cancelled";
      // 一次性过滤重建，避免 clear+push 期间的潜在竞态
      const remaining = snapshot.filter((t) => t.id !== taskId);
      this.queue.clear();
      for (const task of remaining) {
        this.queue.push(task);
      }
      this.notifyListeners();
      log.debug(`压缩任务已取消: ${taskId}`);
      return true;
    }

    // 检查运行中任务
    const running = this.runningTasks.get(taskId);
    if (running) {
      running.status = "cancelled";
      this.runningTasks.delete(taskId);
      this.notifyListeners();
      log.debug(`运行中的压缩任务已标记取消: ${taskId}`);
      return true;
    }

    return false;
  }

  /**
   * 取消会话的所有任务
   */
  cancelSession(sessionId: string): number {
    let count = 0;

    // 取消等待队列中的
    const snapshot = this.queue.toArray();
    this.queue.clear();
    for (const t of snapshot) {
      if (t.sessionId === sessionId) {
        t.status = "cancelled";
        count++;
        continue;
      }
      this.queue.push(t);
    }

    // 标记运行中的
    for (const [, task] of this.runningTasks) {
      if (task.sessionId === sessionId) {
        task.status = "cancelled";
        count++;
      }
    }

    if (count > 0) {
      this.notifyListeners();
    }
    log.debug(`会话 ${sessionId} 的 ${count} 个压缩任务已取消`);
    return count;
  }

  /**
   * 暂停队列
   */
  pause(): void {
    this.paused = true;
    log.debug(`压缩队列已暂停`);
  }

  /**
   * 恢复队列
   */
  resume(): void {
    this.paused = false;
    log.debug(`压缩队列已恢复`);
    this.requestSchedule();
  }

  /**
   * 清空队列
   */
  clear(): void {
    const count = this.queue.size;
    this.queue.clear();
    if (count > 0) {
      this.notifyListeners();
    }
    log.debug(`压缩队列已清空: ${count} 个任务`);
  }

  /**
   * 获取队列长度
   */
  size(): number {
    return this.queue.size;
  }

  /**
   * 获取运行中的任务数
   */
  runningCount(): number {
    return this.runningTasks.size;
  }

  /**
   * 获取队列状态摘要
   */
  getSummary(): {
    pending: number;
    running: number;
    completed: number;
    totalProcessed: number;
    isPaused: boolean;
  } {
    return {
      completed: this.completedTasks.length,
      isPaused: this.paused,
      pending: this.queue.size,
      running: this.runningTasks.size,
      totalProcessed: this.completedTasks.length,
    };
  }

  /**
   * 获取会话的待处理任务
   */
  getSessionTasks(sessionId: string): CompressionTask[] {
    return this.queue.toArray().filter((t) => t.sessionId === sessionId);
  }

  /**
   * 等待所有任务完成
   */
  async waitForAll(): Promise<void> {
    return new Promise<void>((resolve) => {
      // 立即检查
      if (this.queue.size === 0 && this.runningTasks.size === 0) {
        resolve();
        return;
      }

      // 订阅状态变更
      const checkDone = () => {
        if (this.queue.size === 0 && this.runningTasks.size === 0) {
          unsubscribe();
          resolve();
        }
      };

      const unsubscribe = this.subscribe(checkDone);
    });
  }

  /**
   * 通知所有监听器队列状态已变更
   */
  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        log.error("Listener error:", { message: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  /**
   * 按优先级排序队列
   */
  private sortQueue(): void {
    // RingBuffer 不支持原地排序；导出快照排序后重建
    const snapshot = this.queue.toArray();
    snapshot.sort((a, b) => {
      // 高优先级在前
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      // 同优先级按创建时间 FIFO
      return a.createdAt - b.createdAt;
    });
    this.queue.clear();
    for (const task of snapshot) {
      this.queue.push(task);
    }
  }

  /**
   * 调度下一个任务
   */
  private requestSchedule(): void {
    if (this.scheduleRequested) {
      return;
    }
    this.scheduleRequested = true;
    queueMicrotask(() => {
      this.scheduleRequested = false;
      this.drainQueue();
    });
  }

  private drainQueue(): void {
    if (this.paused) {
      return;
    }
    while (this.runningTasks.size < this.config.maxConcurrency && !this.queue.isEmpty()) {
      const task = this.queue.shift()!;
      this.executeTask(task);
    }
  }

  /**
   * 执行任务
   */
  private async executeTask(task: CompressionTask): Promise<void> {
    task.status = "running";
    task.startedAt = Date.now();
    this.runningTasks.set(task.id, task);

    log.debug(`压缩任务开始执行: ${task.id}, session=${task.sessionId}`);

    // 设置超时
    const timeoutHandle = setTimeout(() => {
      if (this.runningTasks.has(task.id)) {
        task.status = "timeout";
        task.error = `任务执行超时 (${this.config.taskTimeoutMs}ms)`;
        this.runningTasks.delete(task.id);
        this.completedTasks.push(task);
        if (this.completedTasks.length > 100) {
          this.completedTasks.splice(0, 20);
        }
        log.warn(`压缩任务超时: ${task.id}`);
        this.notifyListeners();
        this.requestSchedule();
      }
    }, this.config.taskTimeoutMs);

    try {
      await task.execute();
      task.status = "completed";
      task.completedAt = Date.now();
      log.debug(`压缩任务完成: ${task.id}, 耗时=${task.completedAt - task.startedAt}ms`);
    } catch (error) {
      task.status = "failed";
      task.error = error instanceof Error ? error.message : String(error);
      log.error(`压缩任务失败: ${task.id}, error=${task.error}`);
    } finally {
      clearTimeout(timeoutHandle);
      // 仅在任务仍被 runningTasks 持有时清理（超时 handler 可能已接管）
      if (this.runningTasks.has(task.id)) {
        this.runningTasks.delete(task.id);
        this.completedTasks.push(task);
        if (this.completedTasks.length > 100) {
          this.completedTasks.splice(0, 20);
        }
        this.notifyListeners();
        this.requestSchedule();
      }
    }
  }

  /**
   * 移除最低优先级任务
   */
  private dropLowestPriority(): void {
    if (this.queue.isEmpty()) {
      return;
    }

    // 找到最低优先级且最早的任务
    const snapshot = this.queue.toArray();
    let lowestIndex = 0;
    let lowestPriority = snapshot[0]!.priority;
    let earliestTime = snapshot[0]!.createdAt;

    for (let i = 1; i < snapshot.length; i++) {
      const task = snapshot[i]!;
      if (task.priority < lowestPriority || (task.priority === lowestPriority && task.createdAt < earliestTime)) {
        lowestIndex = i;
        lowestPriority = task.priority;
        earliestTime = task.createdAt;
      }
    }

    // 重建 queue 排除 lowestIndex
    this.queue.clear();
    for (let i = 0; i < snapshot.length; i++) {
      if (i !== lowestIndex) {
        this.queue.push(snapshot[i]!);
      }
    }
    const removed = snapshot[lowestIndex]!;
    removed.status = "cancelled";
    log.debug(`移除最低优先级任务: ${removed.id}, priority=${CompressionPriority[lowestPriority]}`);
  }
}

// ─── 单例导出 ────────────────────────────────────────────────────

export const compressionQueue = new CompressionQueue();

// ─── 工厂函数 ────────────────────────────────────────────────────

/**
 * 创建压缩队列
 */
export function createCompressionQueue(config?: CompressionQueueConfig): CompressionQueue {
  return new CompressionQueue(config);
}
