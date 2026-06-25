/**
 * 资源监控模块 — 周期采集 CPU/内存并发布 ResourceUpdate 事件。
 *
 * 职责:
 *   - 周期采集内存(RSS)与 CPU 使用率
 *   - 维护内存与 CPU 的环形历史并计算趋势/统计
 *   - 命中阈值时输出告警日志(含冷却)
 *   - 暴露运行时状态快照(version/uptime/pid)
 *   - 生成可读的资源使用报告
 *
 * 模块功能:
 *   - ResourceMonitor: 资源监控器类（封装全部状态与逻辑）
 *   - resourceMonitor: 模块级单例实例
 *   - getMemoryUsageMB / getCpuUsagePercent: 实时采集（静态方法，无状态依赖）
 *   - startResourceMonitor / pauseResourceMonitor / resumeResourceMonitor: 监控生命周期
 *   - getResourceStatus / getUptime: 运行时快照
 *   - setAlertThresholds / getAlertThresholds: 告警阈值管理
 *   - addMemorySample / getMemoryStats / getMemoryTrend: 内存历史与趋势
 *   - recordResourceSample / generateResourceReport / resetResourceReport: 报告生成
 *
 * 使用场景:
 *   - 进程内统一资源指标采集，被 metricsCollector 聚合
 *   - CLI 健康检查/状态面板
 *
 * 边界:
 *   1. 仅采集进程级(不感知子进程/容器)
 *   2. 告警冷却 30s
 *   3. 监控可暂停:暂停时停止采集与发布
 *   4. 不做告警通知(仅 log.warn + 内部计数)
 *
 * 流程:
 *   1. startResourceMonitor 启动 setInterval
 *   2. 每个 tick 采集内存与 CPU
 *   3. checkAlert 判定告警(含冷却)
 *   4. recordResourceSample 写入环形历史
 *   5. globalBus.publish AppEvent.ResourceUpdate
 */
import os from "node:os";
import { MEMORY_TREND_WINDOW_SIZE, MEMORY_WARNING_THRESHOLD_MB, RESOURCE_MONITOR_INTERVAL_MS } from "@/config";
import { createLogger } from "@/core/logging/logger";
import { RingBuffer } from "@/core/concurrency/ringBuffer";
import { globalBus } from "@/bus";
import { AppEvent } from "@/bus";
import { VERSION } from "@/config/version";
import { CpuSampler } from "../shared/cpuSampler";

const log = createLogger("resource-status");

// ─── 静态工具函数（无状态依赖，可独立调用）─────────────────────

/** 获取当前进程 RSS 内存使用量（MB），精确到 0.1MB */
export function getMemoryUsageMB(): number {
  try {
    const mem = process.memoryUsage();
    return Math.round((mem.rss / 1024 / 1024) * 10) / 10;
  } catch (error) {
    log.debug(`获取内存使用失败: ${error instanceof Error ? error.message : String(error)}`);
    return 0;
  }
}

/**
 * 获取当前进程 CPU 使用率（%），基于两次调用间的增量计算。
 * 无状态版本，仅返回百分比数值（向后兼容）。
 */
export function getCpuUsagePercent(): number {
  try {
    const now = Date.now();
    const elapsedMs = now - cpuUsageLastTime;
    const delta = process.cpuUsage(cpuUsageLastUsage);
    if (!delta || elapsedMs <= 0) {
      return 0;
    }
    const totalMicros = delta.user + delta.system;
    const cpuCount = os.cpus().length || 1;
    const percent = (totalMicros / 1000 / elapsedMs / cpuCount) * 100;
    return Math.min(Math.max(Math.round(percent * 10) / 10, 0), 100 * cpuCount);
  } catch (error) {
    log.debug(`获取 CPU 使用失败: ${error instanceof Error ? error.message : String(error)}`);
    return 0;
  }
}

// ── 模块级 CPU 增量状态（供 getCpuUsagePercent 静态函数使用） ───
let cpuUsageLastTime = Date.now();
let cpuUsageLastUsage: NodeJS.CpuUsage | undefined = process.cpuUsage?.();

// ─── 导出类型 ─────────────────────────────────────────────────

export interface AlertThresholds {
  memoryMB: number;
  cpuPercent: number;
}

export interface ResourceStatus {
  version: string;
  memoryMB: number;
  cpuPercent: number;
  uptime: number;
  pid: number;
}

export interface ResourceReport {
  period: {
    start: number;
    end: number;
    durationMs: number;
  };
  memory: {
    current: number;
    avg: number;
    min: number;
    max: number;
    trend: string;
    alerts: number;
  };
  cpu: {
    current: number;
    avg: number;
    max: number;
    alerts: number;
  };
  summary: string;
  recommendations: string[];
}

// ─── ResourceMonitor 类 ────────────────────────────────────────

const ALERT_COOLDOWN_MS = 30_000;
const DEFAULT_THRESHOLDS: AlertThresholds = {
  cpuPercent: 80,
  memoryMB: MEMORY_WARNING_THRESHOLD_MB,
};

export class ResourceMonitor {
  private startTime = Date.now();
  private timer: ReturnType<typeof setInterval> | null = null;
  private paused = false;
  private cpuSampler = new CpuSampler();

  private thresholds: AlertThresholds = { ...DEFAULT_THRESHOLDS };
  private lastAlertTime = 0;

  private memoryHistory: RingBuffer<{ timestamp: number; value: number }> = new RingBuffer<{
    timestamp: number;
    value: number;
  }>(MEMORY_TREND_WINDOW_SIZE);
  private cpuHistory: RingBuffer<number> = new RingBuffer<number>(MEMORY_TREND_WINDOW_SIZE);

  private reportStartTime = Date.now();
  private memoryAlertCount = 0;
  private cpuAlertCount = 0;

  // ── 生命周期 ──────────────────────────────────────────────

  /** 启动资源监控（返回 stop 函数） */
  start(intervalMs = RESOURCE_MONITOR_INTERVAL_MS): () => void {
    if (this.timer) {
      return () => {};
    }
    try {
      this.cpuSampler = new CpuSampler();
    } catch (error) {
      log.debug(`初始化 CPU 使用失败: ${error instanceof Error ? error.message : String(error)}`);
    }
    log.debug(`资源监控已启动，间隔 ${intervalMs}ms`);
    this.timer = setInterval(() => {
      this.tick();
    }, intervalMs);
    return () => this.stop();
  }

  /** 停止资源监控 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      log.debug("资源监控已停止");
    }
  }

  /** 暂停监控（不停止定时器，跳过采集） */
  pause(): void {
    this.paused = true;
    log.debug("资源监控已暂停");
  }

  /** 恢复监控 */
  resume(): void {
    this.paused = false;
    log.debug("资源监控已恢复");
  }

  /** 是否暂停 */
  isPaused(): boolean {
    return this.paused;
  }

  // ── 实时采集 ──────────────────────────────────────────────

  /** 获取进程运行时长（秒） */
  getUptime(): number {
    return (Date.now() - this.startTime) / 1000;
  }

  /** 获取资源状态快照 */
  getStatus(): ResourceStatus {
    return {
      cpuPercent: this.readCpuPercent(),
      memoryMB: getMemoryUsageMB(),
      pid: process.pid,
      uptime: this.getUptime(),
      version: VERSION,
    };
  }

  // ── 告警阈值 ──────────────────────────────────────────────

  setAlertThresholds(newThresholds: Partial<AlertThresholds>): void {
    this.thresholds = { ...this.thresholds, ...newThresholds };
    log.debug(`告警阈值已更新: 内存 ${this.thresholds.memoryMB}MB, CPU ${this.thresholds.cpuPercent}%`);
  }

  getAlertThresholds(): AlertThresholds {
    return { ...this.thresholds };
  }

  // ── 内存历史与趋势 ────────────────────────────────────────

  addMemorySample(value: number): void {
    this.memoryHistory.push({ timestamp: Date.now(), value });
  }

  getMemoryTrend(): {
    direction: "increasing" | "decreasing" | "stable";
    rate: number;
    samples: number;
  } {
    const snapshot = this.memoryHistory.toArray();
    if (snapshot.length < 2) {
      return { direction: "stable", rate: 0, samples: snapshot.length };
    }
    const n = snapshot.length;
    const last = snapshot[n - 1]!;
    const first = snapshot[0]!;
    const timeSpanMinutes = (last.timestamp - first.timestamp) / (1000 * 60);
    if (timeSpanMinutes === 0) {
      return { direction: "stable", rate: 0, samples: n };
    }
    const rate = (last.value - first.value) / timeSpanMinutes;
    const threshold = 10;
    let direction: "increasing" | "decreasing" | "stable";
    if (rate > threshold) {
      direction = "increasing";
    } else if (rate < -threshold) {
      direction = "decreasing";
    } else {
      direction = "stable";
    }
    return { direction, rate: Math.round(rate * 10) / 10, samples: n };
  }

  getMemoryStats(): {
    current: number;
    min: number;
    max: number;
    avg: number;
    trend: { direction: "increasing" | "decreasing" | "stable"; rate: number; samples: number };
  } {
    const snapshot = this.memoryHistory.toArray();
    if (snapshot.length === 0) {
      return { avg: 0, current: getMemoryUsageMB(), max: 0, min: 0, trend: this.getMemoryTrend() };
    }
    const values = snapshot.map((h) => h.value);
    const current = values[values.length - 1] ?? 0;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    return {
      avg: Math.round(avg * 10) / 10,
      current,
      max: Math.round(max * 10) / 10,
      min: Math.round(min * 10) / 10,
      trend: this.getMemoryTrend(),
    };
  }

  // ── 报告生成 ──────────────────────────────────────────────

  recordResourceSample(memoryMB: number, cpuPercent: number): void {
    this.addMemorySample(memoryMB);
    this.cpuHistory.push(cpuPercent);
  }

  recordAlert(type: "memory" | "cpu"): void {
    if (type === "memory") {
      this.memoryAlertCount++;
    } else {
      this.cpuAlertCount++;
    }
  }

  generateResourceReport(): ResourceReport {
    const now = Date.now();
    const durationMs = now - this.reportStartTime;
    const memoryStats = this.getMemoryStats();
    const cpuValues = this.cpuHistory.size > 0 ? this.cpuHistory.toArray() : [0];
    const cpuAvg = cpuValues.reduce((a, b) => a + b, 0) / cpuValues.length;
    const cpuMax = Math.max(...cpuValues);

    let summary = `资源使用报告 (${(durationMs / 1000 / 60).toFixed(1)} 分钟)\n`;
    summary += `内存: ${memoryStats.avg.toFixed(1)}MB 平均, ${memoryStats.current.toFixed(1)}MB 当前\n`;
    summary += `CPU: ${cpuAvg.toFixed(1)}% 平均, ${cpuMax.toFixed(1)}% 最大`;

    const recommendations: string[] = [];
    if (memoryStats.avg > 400) {
      recommendations.push("内存使用较高，考虑优化缓存策略或增加内存限制");
    }
    if (memoryStats.trend.direction === "increasing" && memoryStats.trend.rate > 50) {
      recommendations.push("内存使用快速增长，可能存在内存泄漏，建议检查最近的操作");
    }
    if (cpuMax > 80) {
      recommendations.push("CPU 使用峰值较高，考虑优化计算密集型操作或增加限流");
    }
    if (this.memoryAlertCount > 0 || this.cpuAlertCount > 0) {
      recommendations.push(`监控期间触发 ${this.memoryAlertCount + this.cpuAlertCount} 次告警，建议调整告警阈值`);
    }
    const trendText: Record<string, string> = {
      decreasing: "下降",
      increasing: "上升",
      stable: "稳定",
    };
    const trendDirection = trendText[memoryStats.trend.direction] ?? "稳定";

    return {
      cpu: {
        alerts: this.cpuAlertCount,
        avg: Math.round(cpuAvg * 10) / 10,
        current: cpuValues[cpuValues.length - 1] ?? 0,
        max: cpuMax,
      },
      memory: {
        alerts: this.memoryAlertCount,
        avg: memoryStats.avg,
        current: memoryStats.current,
        max: memoryStats.max,
        min: memoryStats.min,
        trend: trendDirection,
      },
      period: {
        durationMs,
        end: now,
        start: this.reportStartTime,
      },
      recommendations,
      summary,
    };
  }

  resetReport(): void {
    this.reportStartTime = Date.now();
    this.memoryAlertCount = 0;
    this.cpuAlertCount = 0;
    this.memoryHistory.clear();
    this.cpuHistory.clear();
  }

  // ── 内部方法 ──────────────────────────────────────────────

  /** 读取当前 CPU 百分比（使用共享 CpuSampler） */
  private readCpuPercent(): number {
    const sample = this.cpuSampler.sample();
    return Math.max(sample.user, sample.system);
  }

  /** 单次采集 tick */
  private tick(): void {
    if (this.paused) {
      return;
    }
    const memoryMB = getMemoryUsageMB();
    const cpuPercent = this.readCpuPercent();
    this.checkAlert(memoryMB, cpuPercent);
    this.recordResourceSample(memoryMB, cpuPercent);
    if (memoryMB > this.thresholds.memoryMB) {
      this.recordAlert("memory");
    }
    if (cpuPercent > this.thresholds.cpuPercent) {
      this.recordAlert("cpu");
    }
    globalBus.publish(
      AppEvent.ResourceUpdate,
      {
        cpuPercent,
        memoryMB,
        uptime: this.getUptime(),
      },
      { throttle: false },
    );
  }

  /** 告警判定（含冷却期） */
  private checkAlert(memoryMB: number, cpuPercent: number): void {
    const now = Date.now();
    if (now - this.lastAlertTime < ALERT_COOLDOWN_MS) {
      return;
    }
    const alerts: string[] = [];
    if (memoryMB > this.thresholds.memoryMB) {
      alerts.push(`内存使用 ${memoryMB.toFixed(1)}MB 超过阈值 ${this.thresholds.memoryMB}MB`);
    }
    if (cpuPercent > this.thresholds.cpuPercent) {
      alerts.push(`CPU 使用 ${cpuPercent.toFixed(1)}% 超过阈值 ${this.thresholds.cpuPercent}%`);
    }
    if (alerts.length > 0) {
      this.lastAlertTime = now;
      log.warn(`资源告警: ${alerts.join(", ")}`);
    }
  }
}

// ─── 模块级单例 + 便捷函数 ────────────────────────────────────

/** 全局资源监控单例 */
export const resourceMonitor = new ResourceMonitor();

/** 便捷函数委托到单例 — 保持向后兼容 */
export const startResourceMonitor = resourceMonitor.start.bind(resourceMonitor);
export const pauseResourceMonitor = resourceMonitor.pause.bind(resourceMonitor);
export const resumeResourceMonitor = resourceMonitor.resume.bind(resourceMonitor);
export const isResourceMonitorPaused = resourceMonitor.isPaused.bind(resourceMonitor);
export const getUptime = resourceMonitor.getUptime.bind(resourceMonitor);
export const getResourceStatus = resourceMonitor.getStatus.bind(resourceMonitor);
export const setAlertThresholds = resourceMonitor.setAlertThresholds.bind(resourceMonitor);
export const getAlertThresholds = resourceMonitor.getAlertThresholds.bind(resourceMonitor);
export const addMemorySample = resourceMonitor.addMemorySample.bind(resourceMonitor);
export const getMemoryTrend = resourceMonitor.getMemoryTrend.bind(resourceMonitor);
export const getMemoryStats = resourceMonitor.getMemoryStats.bind(resourceMonitor);
export const recordResourceSample = resourceMonitor.recordResourceSample.bind(resourceMonitor);
export const recordAlert = resourceMonitor.recordAlert.bind(resourceMonitor);
export const generateResourceReport = resourceMonitor.generateResourceReport.bind(resourceMonitor);
export const resetResourceReport = resourceMonitor.resetReport.bind(resourceMonitor);
