/**
 * 内存监控与 OOM 保护 — 监控内存使用，防止内存溢出。
 *
 * 职责:
 *   - 监控 Node.js 进程内存使用
 *   - 提供自适应分块大小策略
 *   - OOM 风险检测和预警
 *   - 自动触发垃圾回收或降低负载
 *
 * 使用场景:
 *   - 大文件处理时的内存控制
 *   - 压缩任务并发控制
 *   - 自动降级处理策略
 *
 * 边界:
 *   1. 仅监控 V8 堆内存，不包括外部内存
 *   2. 阈值可根据 Node.js 版本和运行环境调整
 *   3. 保护机制是被动的，需要主动检查
 */

import { freemem, totalmem } from "os";
import { createLogger } from "@/core/logging/logger";
import { RingBuffer } from "@/core/concurrency/ringBuffer";
import { formatBytes } from "@/core/utilities/textUtils";

const log = createLogger("memory");

// ─── 类型定义 ─────────────────────────────────────────────────────

/** 内存状态 */
export interface MemoryStatus {
  /** 当前堆内存使用量(字节) */
  heapUsed: number;
  /** 堆内存总量(字节) */
  heapTotal: number;
  /** 堆内存使用率 */
  heapUsageRatio: number;
  /** 系统总内存(字节) */
  systemTotal: number;
  /** 系统可用内存(字节) */
  systemFree: number;
  /** 进程 resident set size(字节) */
  rss: number;
  /** 外部内存(字节) */
  external: number;
  /** 内存状态等级 */
  level: MemoryLevel;
  /** 采样时间 */
  timestamp: number;
}

/** 内存等级 */
export type MemoryLevel = "safe" | "warning" | "danger" | "critical";

/** 内存监控配置 */
export interface MemoryMonitorConfig {
  /** 警告阈值(堆使用率) */
  warningThreshold?: number;
  /** 危险阈值(堆使用率) */
  dangerThreshold?: number;
  /** 临界阈值(堆使用率) */
  criticalThreshold?: number;
  /** 监控采样间隔(毫秒) */
  sampleIntervalMs?: number;
  /** 是否自动触发 GC */
  autoGC?: boolean;
  /** GC 触发时的降压比例 */
  gcPressureReductionRatio?: number;
}

// ─── 阈值常量 ─────────────────────────────────────────────────────

const DEFAULT_WARNING_THRESHOLD = 0.6; // 60%
const DEFAULT_DANGER_THRESHOLD = 0.75; // 75%
const DEFAULT_CRITICAL_THRESHOLD = 0.9; // 90%
const GC_PRESSURE_REDUCTION_RATIO = 0.5; // GC 触发时减少 50% 的负载

// ─── 内存监控器 ─────────────────────────────────────────────────

/**
 * 内存监控器
 */
export class MemoryMonitor {
  private config: Required<MemoryMonitorConfig>;
  private samples: RingBuffer<MemoryStatus>;
  private maxSamples: number = 60;
  private listeners: ((status: MemoryStatus) => void)[] = [];
  private gcCallback: (() => void) | null = null;

  constructor(config: MemoryMonitorConfig = {}) {
    this.config = {
      autoGC: config.autoGC ?? true,
      criticalThreshold: config.criticalThreshold ?? DEFAULT_CRITICAL_THRESHOLD,
      dangerThreshold: config.dangerThreshold ?? DEFAULT_DANGER_THRESHOLD,
      gcPressureReductionRatio: config.gcPressureReductionRatio ?? GC_PRESSURE_REDUCTION_RATIO,
      sampleIntervalMs: config.sampleIntervalMs ?? 5000,
      warningThreshold: config.warningThreshold ?? DEFAULT_WARNING_THRESHOLD,
    };
    this.samples = new RingBuffer<MemoryStatus>(this.maxSamples);
  }

  /**
   * 获取当前内存状态（纯读取，不产生副作用）。
   *
   * 注意: 如需触发采样记录、监听器通知、自动 GC，
   * 请使用 sample() 方法。
   */
  getStatus(): MemoryStatus {
    return this.buildStatus();
  }

  /**
   * 采样当前内存状态（含副作用: 记录采样、通知监听器、触发 GC）。
   */
  sample(): MemoryStatus {
    const status = this.buildStatus();

    // 记录采样
    this.samples.push(status);

    // 触发监听器
    this.notifyListeners(status);

    // 自动 GC
    if (this.config.autoGC && status.level === "critical") {
      this.triggerGC();
    }

    return status;
  }

  /**
   * 构建内存状态对象（内部共享方法）。
   */
  private buildStatus(): MemoryStatus {
    const memUsage = process.memoryUsage();
    const memInfo = this.getSystemMemory();

    const heapUsageRatio = memUsage.heapTotal > 0 ? memUsage.heapUsed / memUsage.heapTotal : 0;

    let level: MemoryLevel;
    if (heapUsageRatio >= this.config.criticalThreshold) {
      level = "critical";
    } else if (heapUsageRatio >= this.config.dangerThreshold) {
      level = "danger";
    } else if (heapUsageRatio >= this.config.warningThreshold) {
      level = "warning";
    } else {
      level = "safe";
    }

    return {
      external: memUsage.external,
      heapTotal: memUsage.heapTotal,
      heapUsageRatio,
      heapUsed: memUsage.heapUsed,
      level,
      rss: memUsage.rss,
      systemFree: memInfo.free,
      systemTotal: memInfo.total,
      timestamp: Date.now(),
    };
  }

  /**
   * 获取系统内存信息
   */
  private getSystemMemory(): { total: number; free: number } {
    try {
      return { free: freemem(), total: totalmem() };
    } catch {
      return { free: 0, total: 0 };
    }
  }

  /**
   * 获取内存使用摘要
   */
  getSummary(): string {
    const status = this.getStatus();

    return (
      `内存[${status.level}]: ` +
      `堆=${formatBytes(status.heapUsed)}/${formatBytes(status.heapTotal)} ` +
      `(${Math.round(status.heapUsageRatio * 100)}%) ` +
      `RSS=${formatBytes(status.rss)}`
    );
  }

  /**
   * 检查是否应该降低负载
   */
  shouldReduceLoad(): boolean {
    const status = this.getStatus();
    return status.level === "danger" || status.level === "critical";
  }

  /**
   * 检查是否应该暂停新任务
   */
  shouldPauseNewTasks(): boolean {
    const status = this.getStatus();
    return status.level === "critical";
  }

  /**
   * 计算推荐的分块大小(字节)
   *
   * 基于当前内存状态，动态调整处理块的大小。
   * 内存越紧张，块越小。
   */
  getRecommendedChunkSize(baseSize: number): number {
    const status = this.getStatus();
    let ratio = 1;

    switch (status.level) {
      case "critical": {
        ratio = 0.2; // 减到 20%
        break;
      }
      case "danger": {
        ratio = 0.5; // 减到 50%
        break;
      }
      case "warning": {
        ratio = 0.75; // 减到 75%
        break;
      }
      case "safe": {
        ratio = 1; // 保持全量
        break;
      }
    }

    const recommended = Math.max(1, Math.floor(baseSize * ratio));
    log.debug(`推荐分块大小: ${baseSize} → ${recommended} (ratio=${ratio}, level=${status.level})`);

    return recommended;
  }

  /**
   * 获取推荐的最大并发数
   */
  getRecommendedConcurrency(baseConcurrency: number): number {
    const status = this.getStatus();
    let ratio = 1;

    switch (status.level) {
      case "critical": {
        ratio = 0.25; // 只用 25%
        break;
      }
      case "danger": {
        ratio = 0.5; // 用 50%
        break;
      }
      case "warning": {
        ratio = 0.75; // 用 75%
        break;
      }
      case "safe": {
        ratio = 1; // 全量
        break;
      }
    }

    return Math.max(1, Math.floor(baseConcurrency * ratio));
  }

  /**
   * 注册内存状态监听器
   */
  onStatusChange(listener: (status: MemoryStatus) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index !== -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * 设置 GC 回调
   */
  setGCCallback(callback: () => void): void {
    this.gcCallback = callback;
  }

  /**
   * 触发垃圾回收
   */
  private triggerGC(): void {
    log.warn("内存达到临界值，触发 GC...");

    if (this.gcCallback) {
      try {
        this.gcCallback();
      } catch (error) {
        log.error(`GC 回调执行失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // 尝试手动触发 GC(如果可用)
    if (global.gc) {
      try {
        global.gc();
        log.info("手动 GC 执行完成");
      } catch {
        // GC 不可用
      }
    }
  }

  /**
   * 获取历史采样
   */
  getHistory(): MemoryStatus[] {
    return this.samples.toArray();
  }

  /**
   * 获取平均内存使用率
   */
  getAverageUsage(): number {
    const arr = this.samples.toArray();
    if (arr.length === 0) {
      return 0;
    }
    const sum = arr.reduce((acc, s) => acc + s.heapUsageRatio, 0);
    return sum / arr.length;
  }

  /**
   * 重置采样
   */
  resetHistory(): void {
    this.samples.clear();
    log.debug("内存采样历史已重置");
  }

  private notifyListeners(status: MemoryStatus): void {
    for (const listener of this.listeners) {
      try {
        listener(status);
      } catch (error) {
        log.error(`内存监听器执行失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

// ─── 自适应分块器 ─────────────────────────────────────────────────

/**
 * 自适应分块器 — 根据内存状态动态调整分块大小
 */
export class AdaptiveChunker<T> {
  private monitor: MemoryMonitor;
  private baseChunkSize: number;
  private items: T[] = [];

  constructor(monitor: MemoryMonitor, baseChunkSize: number) {
    this.monitor = monitor;
    this.baseChunkSize = baseChunkSize;
  }

  /**
   * 设置要分块的数据
   */
  setItems(items: T[]): void {
    this.items = items;
  }

  /**
   * 获取当前推荐的分块大小
   */
  getChunkSize(): number {
    return this.monitor.getRecommendedChunkSize(this.baseChunkSize);
  }

  /**
   * 获取分块数量
   */
  getChunkCount(): number {
    const chunkSize = this.getChunkSize();
    return Math.ceil(this.items.length / chunkSize);
  }

  /**
   * 获取指定分块
   */
  getChunk(index: number): T[] {
    const chunkSize = this.getChunkSize();
    const start = index * chunkSize;
    return this.items.slice(start, start + chunkSize);
  }

  /**
   * 迭代所有分块
   */
  *iterateChunks(): Generator<T[], void, unknown> {
    const chunkSize = this.getChunkSize();
    for (let i = 0; i < this.items.length; i += chunkSize) {
      yield this.items.slice(i, i + chunkSize);
    }
  }
}

// ─── 单例导出 ────────────────────────────────────────────────────

export const memoryMonitor = new MemoryMonitor();

// ─── 工厂函数 ────────────────────────────────────────────────────

/**
 * 创建内存监控器
 */
export function createMemoryMonitor(config?: MemoryMonitorConfig): MemoryMonitor {
  return new MemoryMonitor(config);
}

/**
 * 创建自适应分块器
 */
export function createAdaptiveChunker<T>(monitor: MemoryMonitor, baseChunkSize: number): AdaptiveChunker<T> {
  return new AdaptiveChunker(monitor, baseChunkSize);
}
