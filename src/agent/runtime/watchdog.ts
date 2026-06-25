/**
 * 看门狗服务 (Watchdog)
 *
 * 职责:
 *   - 监控长时间运行的任务，防止系统假死
 *   - 提供超时检测和强制终止机制
 *   - 发送状态终止事件到 UI 层
 *
 * 模块功能:
 *   - Watchdog: 看门狗类
 *   - WatchdogEvent: 看门狗事件类型
 *   - createWatchdog: 创建看门狗实例
 *
 * 使用场景:
 *   - API 超时或无响应时
 *   - 子代理执行卡死
 *   - 长时间无响应的任务
 *
 * 边界:
 *   1. 每个任务独立看门狗实例
 *   2. 支持可配置超时时间
 *   3. 触发后发送强制终止事件
 *   4. 支持暂停和恢复
 *
 * 流程:
 *   1. 创建看门狗实例，设置超时时间
 *   2. 任务开始时启动看门狗
 *   3. 任务正常完成时停止看门狗
 *   4. 超时触发时发送 FORCED_TERMINATE 事件
 *   5. 调用回调函数处理终止逻辑
 */

import { createLogger } from "@/core/logging/logger";
import { WATCHDOG_DEFAULT_TIMEOUT_MS, WATCHDOG_MAX_TIMEOUT_MS } from "@/config";

const log = createLogger("agent:watchdog");

export type WatchdogEventType = "started" | "tick" | "timeout" | "stopped" | "paused" | "resumed";

export interface WatchdogEvent {
  type: WatchdogEventType;
  taskId: string;
  timestamp: number;
  elapsedMs: number;
}

export interface WatchdogConfig {
  taskId: string;
  timeoutMs?: number;
  onTimeout?: (taskId: string, elapsedMs: number) => void;
  onTick?: (taskId: string, elapsedMs: number) => void;
  onEvent?: (event: WatchdogEvent) => void;
}

export class Watchdog {
  private readonly taskId: string;
  private readonly timeoutMs: number;
  private onTimeout?: (taskId: string, elapsedMs: number) => void;
  private onTick?: (taskId: string, elapsedMs: number) => void;
  private onEvent?: (event: WatchdogEvent) => void;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private startTime: number = 0;
  private pausedTime: number = 0;
  private totalPausedMs: number = 0;
  private isRunning: boolean = false;
  private isPaused: boolean = false;

  constructor(config: WatchdogConfig) {
    this.taskId = config.taskId;
    this.timeoutMs = Math.min(config.timeoutMs ?? WATCHDOG_DEFAULT_TIMEOUT_MS, WATCHDOG_MAX_TIMEOUT_MS);
    this.onTimeout = config.onTimeout;
    this.onTick = config.onTick;
    this.onEvent = config.onEvent;
  }

  start(): void {
    if (this.isRunning) {
      log.warn(`看门狗已在运行，忽略启动请求`, { taskId: this.taskId });
      return;
    }

    this.startTime = Date.now();
    this.totalPausedMs = 0;
    this.isRunning = true;
    this.isPaused = false;

    this.emit({ elapsedMs: 0, taskId: this.taskId, timestamp: this.startTime, type: "started" });

    this.scheduleTimeout();
    log.debug(`看门狗已启动`, { taskId: this.taskId, timeoutMs: this.timeoutMs });
  }

  stop(): void {
    if (!this.isRunning) {
      return;
    }

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const elapsed = this.getElapsedMs();
    this.isRunning = false;
    this.isPaused = false;

    this.emit({ elapsedMs: elapsed, taskId: this.taskId, timestamp: Date.now(), type: "stopped" });
    log.debug(`看门狗已停止`, { elapsedMs: elapsed, taskId: this.taskId });
  }

  pause(): void {
    if (!this.isRunning || this.isPaused) {
      return;
    }

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.pausedTime = Date.now();
    this.isPaused = true;

    this.emit({
      elapsedMs: this.getElapsedMs(),
      taskId: this.taskId,
      timestamp: this.pausedTime,
      type: "paused",
    });

    log.debug(`看门狗已暂停`, { taskId: this.taskId });
  }

  resume(): void {
    if (!this.isRunning || !this.isPaused) {
      return;
    }

    this.totalPausedMs += Date.now() - this.pausedTime;
    this.isPaused = false;

    this.emit({
      elapsedMs: this.getElapsedMs(),
      taskId: this.taskId,
      timestamp: Date.now(),
      type: "resumed",
    });

    this.scheduleTimeout();
    log.debug(`看门狗已恢复`, { taskId: this.taskId });
  }

  isActive(): boolean {
    return this.isRunning;
  }

  getElapsedMs(): number {
    if (!this.isRunning) {
      return 0;
    }

    if (this.isPaused) {
      return this.pausedTime - this.startTime - this.totalPausedMs;
    }

    return Date.now() - this.startTime - this.totalPausedMs;
  }

  getRemainingMs(): number {
    return Math.max(0, this.timeoutMs - this.getElapsedMs());
  }

  private scheduleTimeout(): void {
    const remaining = this.getRemainingMs();

    if (remaining <= 0) {
      this.triggerTimeout();
      return;
    }

    this.timer = setTimeout(() => {
      this.triggerTimeout();
    }, remaining);
  }

  private triggerTimeout(): void {
    if (!this.isRunning) {
      return;
    }

    const elapsed = this.getElapsedMs();
    this.isRunning = false;

    this.emit({ elapsedMs: elapsed, taskId: this.taskId, timestamp: Date.now(), type: "timeout" });

    log.warn(`看门狗超时触发`, { elapsedMs: elapsed, taskId: this.taskId, timeoutMs: this.timeoutMs });

    if (this.onTimeout) {
      try {
        this.onTimeout(this.taskId, elapsed);
      } catch (error) {
        log.error(`看门狗超时回调执行失败`, { error, taskId: this.taskId });
      }
    }
  }

  private emit(event: WatchdogEvent): void {
    if (event.type === "tick" && this.onTick) {
      try {
        this.onTick(event.taskId, event.elapsedMs);
      } catch (error) {
        log.error(`看门狗 tick 回调执行失败`, { error, taskId: this.taskId });
      }
    }

    if (this.onEvent) {
      try {
        this.onEvent(event);
      } catch (error) {
        log.error(`看门狗事件回调执行失败`, { error, taskId: this.taskId });
      }
    }
  }

  destroy(): void {
    this.stop();
  }
}

export function createWatchdog(config: WatchdogConfig): Watchdog {
  return new Watchdog(config);
}

export function createTimeoutHandler(
  taskId: string,
  onForcedTerminate: (taskId: string, reason: string) => void,
): (taskId: string, elapsedMs: number) => void {
  return (taskId: string, elapsedMs: number) => {
    const reason = `看门狗超时 (${Math.round(elapsedMs / 1000)}s)`;
    log.error(`任务执行超时，触发强制终止`, { elapsedMs, reason, taskId });
    onForcedTerminate(taskId, reason);
  };
}
