/**
 * TPS (Tokens Per Second) 实时测速仪
 *
 * 工作原理:
 * - 通过 subscribe 订阅 EventBus ConversationStreamToken 事件获取 tokenCount
 * - 按秒分桶统计，每秒 tick 计算上一秒的 TPS
 * - subscribe/getSnapshot 模式可直接对接 SolidJS createSignal
 */

import type { EventBus } from "@/bus";
import { AppEvent } from "@/bus";

// ─── 类型 ──────────────────────────────────────────────────

export interface TpsSnapshot {
  /** 当前实时 TPS（每秒 token 数），无输出时为 0 */
  tps: number;
  /** 峰值 TPS */
  peakTps: number;
}

type Listener = () => void;

// ─── 常量 ──────────────────────────────────────────────────

const TICK_INTERVAL_MS = 1000;

// ─── Tracker 类 ──────────────────────────────────────────────

class TpsTracker {
  private active = false;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private listeners: Set<Listener> = new Set();

  private snapshot: TpsSnapshot = { tps: 0, peakTps: 0 };
  private snapshotRef: TpsSnapshot = this.snapshot;

  /** 当前秒内累计 token 数 */
  private currentSecondTokens = 0;

  // ─── 公共 API ───────────────────────────────────────────

  start(): void {
    if (this.active) return;
    this.active = true;
    this.resetInternal();
    this.startTicking();
    this.emitChange();
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.stopTicking();
    this.resetInternal();
    this.emitChange();
  }

  isActive(): boolean {
    return this.active;
  }

  /** 记录 token 输出增量（由 EventBus 订阅驱动） */
  recordTokens(tokenCount: number): void {
    if (!this.active || tokenCount <= 0) return;
    this.currentSecondTokens += tokenCount;
  }

  /** 重置当前会话统计 */
  resetSession(): void {
    if (!this.active) return;
    this.resetInternal();
    this.emitChange();
  }

  // ─── subscribe/getSnapshot（SolidJS createSignal 兼容） ───

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): TpsSnapshot => {
    return this.snapshotRef;
  };

  // ─── 内部实现 ───────────────────────────────────────────

  private resetInternal(): void {
    this.currentSecondTokens = 0;
    this.snapshot = { tps: 0, peakTps: 0 };
    this.snapshotRef = this.snapshot;
  }

  private startTicking(): void {
    this.stopTicking();
    this.tickTimer = setInterval(() => this.tick(), TICK_INTERVAL_MS);
  }

  private stopTicking(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private tick(): void {
    if (!this.active) return;

    const tps = this.currentSecondTokens;
    const peakTps = Math.max(this.snapshot.peakTps, tps);

    this.snapshot = { tps, peakTps };
    this.snapshotRef = this.snapshot;
    this.emitChange();
  }

  private emitChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

// ─── 全局单例 ──────────────────────────────────────────────

export const tpsTracker = new TpsTracker();

// ─── EventBus 订阅集成 ─────────────────────────────────────────

let eventBusUnsub: (() => void) | null = null;

/** 将 TPS Tracker 连接到 EventBus，自动从 ConversationStreamToken 事件获取 token 计数 */
export function connectTpsTrackerToEventBus(bus: EventBus): () => void {
  disconnectTpsTrackerFromEventBus();

  eventBusUnsub = bus.subscribe(AppEvent.ConversationStreamToken, (evt) => {
    tpsTracker.recordTokens(evt.properties.tokenCount);
  });

  return disconnectTpsTrackerFromEventBus;
}

function disconnectTpsTrackerFromEventBus(): void {
  if (eventBusUnsub) {
    eventBusUnsub();
    eventBusUnsub = null;
  }
}
