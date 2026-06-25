/**
 * Agent 心跳检测 — 监控 Agent 执行过程是否存活，防止进程假死。
 *
 * 职责:
 *   - 检测 Agent 执行过程是否响应
 *   - 在心跳超时时触发警告或终止
 *   - 支持暂停/恢复心跳
 *   - 提供心跳状态查询
 *
 * 使用场景:
 *   - 长时间运行的 Agent 任务
 *   - 检测外部进程是否假死
 *   - 自动终止无响应的 Agent
 *
 * 边界:
 *   1. 心跳超时不代表 Agent 已崩溃，只是无响应
 *   2. 可配置超时阈值和检查间隔
 *   3. 心跳中断不影响 Agent 继续执行(仅作为监控)
 */

import { createLogger } from "@/core/logging/logger";

const log = createLogger("agent:heartbeat");

// ─── 类型定义 ─────────────────────────────────────────────────────

/** 心跳状态 */
export type HeartbeatStatus = "stopped" | "running" | "paused" | "timeout" | "terminated";

/** 心跳事件 */
export interface HeartbeatEvent {
  status: HeartbeatStatus;
  lastBeat: number;
  missedBeats: number;
  totalBeats: number;
}

/** 心跳监听器回调 */
export type HeartbeatListener = (event: HeartbeatEvent) => void;

/** 心跳配置 */
export interface HeartbeatConfig {
  /** 检查间隔(毫秒) */
  intervalMs?: number;
  /** 超时阈值(毫秒)，超过此时间没有 ping 则视为超时 */
  timeoutMs?: number;
  /** 最大 missed beats 次数，超过此次数触发警告 */
  maxMissedBeats?: number;
  /** 是否自动终止 Agent */
  autoTerminate?: boolean;
}

// ─── 心跳检测器 ───────────────────────────────────────────────────

export class HeartbeatMonitor {
  private _status: HeartbeatStatus = "stopped";
  private lastBeat: number = 0;
  private totalBeats: number = 0;
  private missedBeats: number = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<HeartbeatListener>();
  private sessionId?: string;
  private config: Required<HeartbeatConfig>;

  constructor(config: HeartbeatConfig = {}) {
    this.config = {
      autoTerminate: false,
      intervalMs: 5000,
      maxMissedBeats: 3,
      timeoutMs: 30_000,
      ...config,
    };
  }

  /** 当前状态 */
  get status(): HeartbeatStatus {
    return this._status;
  }

  /** 上次心跳时间 */
  get lastBeatTime(): number {
    return this.lastBeat;
  }

  /** 总心跳次数 */
  get beatCount(): number {
    return this.totalBeats;
  }

  /** 漏掉的检查次数 */
  get missedBeatCount(): number {
    return this.missedBeats;
  }

  /**
   * 启动心跳监控
   */
  start(sessionId?: string): void {
    if (this._status === "running") {
      log.warn(`心跳监控已在运行，跳过重复启动`);
      return;
    }

    this.sessionId = sessionId;
    this.lastBeat = Date.now();
    this.totalBeats = 0;
    this.missedBeats = 0;
    this._status = "running";

    log.debug(`心跳监控已启动: interval=${this.config.intervalMs}ms, timeout=${this.config.timeoutMs}ms`);

    // 启动定时检查
    this.timer = setInterval(() => this.check(), this.config.intervalMs);
  }

  /**
   * 停止心跳监控
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this._status = "stopped";
    log.debug(`心跳监控已停止: totalBeats=${this.totalBeats}, missedBeats=${this.missedBeats}`);
  }

  /**
   * 暂停心跳监控(但不重置状态)
   */
  pause(): void {
    if (this._status !== "running") {
      return;
    }
    this._status = "paused";
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    log.debug(`心跳监控已暂停`);
  }

  /**
   * 恢复心跳监控
   */
  resume(): void {
    if (this._status !== "paused") {
      return;
    }
    this._status = "running";
    this.timer = setInterval(() => this.check(), this.config.intervalMs);
    this.lastBeat = Date.now(); // 重置心跳，避免立即超时
    log.debug(`心跳监控已恢复`);
  }

  /**
   * 发送心跳(ping)- Agent 运行时定期调用此方法表示仍然存活
   */
  ping(): void {
    if (this._status !== "running") {
      return;
    }

    this.lastBeat = Date.now();
    this.totalBeats++;
    this.missedBeats = 0;

    log.debug(`心跳: ${this.totalBeats}, session=${this.sessionId ?? "unknown"}`);
  }

  /**
   * 注册心跳监听器
   */
  onHeartbeat(listener: HeartbeatListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 获取当前心跳事件
   */
  getEvent(): HeartbeatEvent {
    return {
      lastBeat: this.lastBeat,
      missedBeats: this.missedBeats,
      status: this._status,
      totalBeats: this.totalBeats,
    };
  }

  /**
   * 获取心跳状态摘要
   */
  getSummary(): string {
    const elapsed = this.lastBeat ? Math.round((Date.now() - this.lastBeat) / 1000) : -1;
    return `Heartbeat[${this._status}]: beats=${this.totalBeats}, missed=${this.missedBeats}, last=${elapsed}s ago`;
  }

  /**
   * 内部:检查心跳状态
   */
  private check(): void {
    if (this._status !== "running") {
      return;
    }

    const elapsed = Date.now() - this.lastBeat;

    if (elapsed > this.config.timeoutMs) {
      this.missedBeats++;
      const event: HeartbeatEvent = {
        lastBeat: this.lastBeat,
        missedBeats: this.missedBeats,
        status: "timeout",
        totalBeats: this.totalBeats,
      };

      log.warn(
        `心跳超时: session=${this.sessionId ?? "unknown"}, elapsed=${Math.round(elapsed / 1000)}s, ` +
          `missed=${this.missedBeats}/${this.config.maxMissedBeats}`,
      );

      // 通知监听器
      this.notifyListeners(event);

      // 检查是否超过最大遗漏次数
      if (this.missedBeats >= this.config.maxMissedBeats) {
        log.error(`心跳超时次数超过阈值: ${this.missedBeats} >= ${this.config.maxMissedBeats}`);

        if (this.config.autoTerminate) {
          log.error(`自动终止 Agent: session=${this.sessionId ?? "unknown"}`);
          this._status = "terminated";
          const terminateEvent: HeartbeatEvent = {
            lastBeat: this.lastBeat,
            missedBeats: this.missedBeats,
            status: "terminated",
            totalBeats: this.totalBeats,
          };
          this.notifyListeners(terminateEvent);
          if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
          }
        }
      }
    }
  }

  private notifyListeners(event: HeartbeatEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        log.error(`心跳监听器执行错误: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

// ─── 便捷工厂函数 ─────────────────────────────────────────────────

/**
 * 创建心跳监控器
 */
export function createHeartbeatMonitor(config?: HeartbeatConfig): HeartbeatMonitor {
  return new HeartbeatMonitor(config);
}
