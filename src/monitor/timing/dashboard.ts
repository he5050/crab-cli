/**
 * 性能仪表盘模块 — counter/gauge/histogram/timer 多类型指标采集与告警。
 *
 * 职责:
 *   - 维护多类型(counter/gauge/histogram/timer)的指标环形存储
 *   - 周期采集内存/CPU/事件循环延迟并打点
 *   - 基于 AlertRule 评估触发告警事件
 *   - 通过 EventEmitter 暴露 snapshot 事件供订阅
 *
 * 模块功能:
 *   - PerformanceDashboard: 主类
 *   - record / incrementCounter / recordHistogram / startTimer: 打点 API
 *   - addAlertRule / removeAlertRule / checkAlerts: 告警规则
 *   - createPerformanceDashboard / getGlobalDashboard: 工厂与单例
 *   - createMemoryAlertRule / createCpuAlertRule: 常用告警预设
 *   - MetricStore: 内部存储(每 metric 一个 RingBuffer)
 *
 * 使用场景:
 *   - 与 telemetry.ts 配合对外暴露 Prometheus / 自有 exporter
 *   - 内部子系统在关键路径打点
 *
 * 边界:
 *   1. start 幂等；stop 仅清理 interval
 *   2. eventLoopDelay 用 setImmediate 估算，仅供粗粒度
 *   3. 告警一旦进入 active，需先恢复(条件不再满足)才能再次触发
 *
 * 流程:
 *   1. start 启动 setInterval
 *   2. collectSnapshot 采集内存/CPU/eventLoop 并打 gauge
 *   3. record 时同步 checkAlerts
 *   4. 满足触发条件 → emit("alert", event) 并进入 active
 *   5. stop 清理 interval
 */
import { EventEmitter } from "events";
import { createLogger } from "@/core/logging/logger";
import { RingBuffer } from "@/core/concurrency/ringBuffer";
import { CpuSampler } from "../shared/cpuSampler";
import { globalBus, type EventBus } from "@/bus";
import { AppEvent } from "@/bus";

const log = createLogger("performance-dashboard");

/** 性能指标类型(dashboard 语义:counter/gauge/histogram/timer) */
export type DashboardMetricType = "counter" | "gauge" | "histogram" | "timer";

/** 通用指标 */
export interface Metric {
  name: string;
  type: DashboardMetricType;
  value: number;
  unit?: string;
  tags?: Record<string, string>;
  timestamp: number;
}

/** 性能快照 */
export interface PerformanceSnapshot {
  memory: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  cpu: {
    user: number;
    system: number;
  };
  eventLoopDelay: number;
  activeRequests: number;
}

/** 告警级别 */
export type AlertLevel = "info" | "warning" | "critical";

/** 告警规则 */
export interface AlertRule {
  id: string;
  name: string;
  metric: string;
  condition: "gt" | "lt" | "eq" | "gte" | "lte";
  threshold: number;
  /** 持续超过此毫秒数才触发告警（0 表示即时触发） */
  durationMs: number;
  level: AlertLevel;
  enabled: boolean;
}

/** 告警事件 */
export interface AlertEvent {
  ruleId: string;
  ruleName: string;
  level: AlertLevel;
  metric: string;
  currentValue: number;
  threshold: number;
  triggeredAt: number;
}

class MetricStore {
  private metrics = new Map<string, RingBuffer<Metric>>();
  private maxEntries: number;

  constructor(maxEntries = 1000) {
    this.maxEntries = maxEntries;
  }

  add(name: string, metric: Metric): void {
    let entries = this.metrics.get(name);
    if (!entries) {
      entries = new RingBuffer<Metric>(this.maxEntries);
      this.metrics.set(name, entries);
    }
    entries.push(metric);
  }

  get(name: string, limit = 100): Metric[] {
    const entries = this.metrics.get(name);
    if (!entries) {
      return [];
    }
    const all = entries.toArray();
    return all.slice(-limit);
  }

  getLatest(name: string): Metric | undefined {
    const entries = this.metrics.get(name);
    if (!entries) {
      return undefined;
    }
    const all = entries.toArray();
    return all.length > 0 ? all[all.length - 1] : undefined;
  }

  clear(): void {
    this.metrics.clear();
  }

  size(): number {
    let total = 0;
    for (const entries of this.metrics.values()) {
      total += entries.size;
    }
    return total;
  }
}

export class PerformanceDashboard extends EventEmitter {
  private store: MetricStore;
  private alertRules = new Map<string, AlertRule>();
  private alertState = new Map<string, { active: boolean; triggeredAt?: number; conditionMetSince?: number }>();
  private collectionInterval: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private startedAt: number = 0;
  private cpuSampler = new CpuSampler();
  private unsubResourceUpdate: (() => void) | undefined;
  /** 缓存的资源数据（由 ResourceUpdate 事件注入） */
  private cachedResource: { memoryMB?: number; cpuPercent?: number } | null = null;

  constructor(eventBus?: EventBus) {
    super();
    this.store = new MetricStore();
    // 订阅 ResourceUpdate 事件，由 ResourceMonitor 统一推送 CPU/内存数据
    this.unsubResourceUpdate = (eventBus ?? globalBus).subscribe(AppEvent.ResourceUpdate, (evt) => {
      this.cachedResource = {
        cpuPercent: evt.properties.cpuPercent,
        memoryMB: evt.properties.memoryMB,
      };
      // 将资源数据记录为 gauge
      if (evt.properties.memoryMB !== undefined) {
        const memBytes = evt.properties.memoryMB * 1024 * 1024;
        this.record("memory.rss", memBytes, "gauge", { unit: "bytes" });
      }
      if (evt.properties.cpuPercent !== undefined) {
        // ResourceMonitor 返回总百分比，分配为 user（近似）
        this.record("cpu.user", evt.properties.cpuPercent, "gauge", { unit: "percent" });
      }
    });
  }

  start(intervalMs = 5000): void {
    if (this.isRunning) {
      log.warn("性能监控已在运行");
      return;
    }
    this.isRunning = true;
    this.startedAt = Date.now();
    // 仅采集 eventLoop 延迟（CPU/内存由 ResourceUpdate 事件推送）
    this.collectionInterval = setInterval(() => {
      this.collectSnapshot();
    }, intervalMs);
    this.collectSnapshot();
    log.info(`性能监控已启动，间隔 ${intervalMs}ms`);
  }

  stop(): void {
    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
      this.collectionInterval = null;
    }
    this.isRunning = false;
    this.unsubResourceUpdate?.();
    this.unsubResourceUpdate = undefined;
    log.info("性能监控已停止");
  }

  record(
    name: string,
    value: number,
    type: DashboardMetricType = "gauge",
    options?: { unit?: string; tags?: Record<string, string> },
  ): void {
    const metric: Metric = {
      name,
      tags: options?.tags,
      timestamp: Date.now(),
      type,
      unit: options?.unit,
      value,
    };
    this.store.add(name, metric);
    this.checkAlerts(name, value);
  }

  incrementCounter(name: string, value = 1, tags?: Record<string, string>): void {
    this.record(name, value, "counter", { tags });
  }

  recordHistogram(name: string, value: number, tags?: Record<string, string>): void {
    this.record(name, value, "histogram", { tags, unit: "ms" });
  }

  startTimer(name: string): () => void {
    const start = process.hrtime.bigint();
    return () => {
      const end = process.hrtime.bigint();
      const durationMs = Number(end - start) / 1_000_000;
      this.recordHistogram(name, durationMs);
    };
  }

  private collectSnapshot(): void {
    // CPU/内存由 ResourceUpdate 事件推送（见 constructor 订阅）
    // 此处仅采集 dashboard 独有的 eventLoop 延迟
    const eventLoopDelay = this.getEventLoopDelay();
    this.record("eventLoop.delay", eventLoopDelay, "gauge", { unit: "ms" });

    // 若无外部资源推送，使用本地 fallback 采集完整快照
    if (!this.cachedResource) {
      const memory = this.getMemoryUsage();
      const cpu = this.getCpuUsage();
      this.record("memory.heapUsed", memory.heapUsed, "gauge", { unit: "bytes" });
      this.record("memory.heapTotal", memory.heapTotal, "gauge", { unit: "bytes" });
      this.record("memory.external", memory.external, "gauge", { unit: "bytes" });
      this.record("memory.rss", memory.rss, "gauge", { unit: "bytes" });
      this.record("cpu.user", cpu.user, "gauge", { unit: "percent" });
      this.record("cpu.system", cpu.system, "gauge", { unit: "percent" });
      this.emit("snapshot", { cpu, eventLoopDelay, memory, timestamp: Date.now() });
      return;
    }

    // 有外部资源推送时，构建快照
    const memBytes = (this.cachedResource.memoryMB ?? 0) * 1024 * 1024;
    const memory = {
      external: 0,
      heapTotal: 0,
      heapUsed: memBytes,
      rss: memBytes,
    };
    const cpu = {
      system: 0,
      user: this.cachedResource.cpuPercent ?? 0,
    };
    this.emit("snapshot", { cpu, eventLoopDelay, memory, timestamp: Date.now() });
  }

  private getMemoryUsage(): PerformanceSnapshot["memory"] {
    const usage = process.memoryUsage();
    return {
      external: usage.external,
      heapTotal: usage.heapTotal,
      heapUsed: usage.heapUsed,
      rss: usage.rss,
    };
  }

  private getCpuUsage(): PerformanceSnapshot["cpu"] {
    return this.cpuSampler.sample();
  }

  private getEventLoopDelay(): number {
    const start = process.hrtime.bigint();
    setImmediate(() => {});
    const end = process.hrtime.bigint();
    return Number(end - start) / 1_000_000;
  }

  addAlertRule(rule: AlertRule): void {
    this.alertRules.set(rule.id, rule);
    this.alertState.set(rule.id, { active: false });
    log.info(`告警规则已添加: ${rule.name}`);
  }

  removeAlertRule(ruleId: string): void {
    this.alertRules.delete(ruleId);
    this.alertState.delete(ruleId);
  }

  private checkAlerts(metricName: string, value: number): void {
    const now = Date.now();
    for (const rule of this.alertRules.values()) {
      if (!rule.enabled) {
        continue;
      }
      if (rule.metric !== metricName) {
        continue;
      }
      const conditionMet = this.evaluateCondition(value, rule.condition, rule.threshold);
      const state = this.alertState.get(rule.id)!;

      if (conditionMet && !state.active) {
        // 检查是否需要持续触发（durationMs > 0）
        if (rule.durationMs > 0) {
          if (!state.conditionMetSince) {
            state.conditionMetSince = now;
          }
          // 条件持续时间不足，暂不触发
          if (now - state.conditionMetSince < rule.durationMs) {
            continue;
          }
        }
        const event: AlertEvent = {
          currentValue: value,
          level: rule.level,
          metric: metricName,
          ruleId: rule.id,
          ruleName: rule.name,
          threshold: rule.threshold,
          triggeredAt: now,
        };
        state.active = true;
        state.triggeredAt = now;
        this.emit("alert", event);
        log.warn(`告警触发: ${rule.name} - ${metricName} = ${value} (${rule.condition} ${rule.threshold})`);
      } else if (!conditionMet && state.active) {
        state.active = false;
        state.triggeredAt = undefined;
        state.conditionMetSince = undefined;
        this.emit("alertResolved", { ruleId: rule.id, ruleName: rule.name });
        log.info(`告警恢复: ${rule.name}`);
      } else if (!conditionMet) {
        // 条件不满足，重置持续计时
        state.conditionMetSince = undefined;
      }
    }
  }

  private evaluateCondition(value: number, condition: AlertRule["condition"], threshold: number): boolean {
    switch (condition) {
      case "gt": {
        return value > threshold;
      }
      case "lt": {
        return value < threshold;
      }
      case "eq": {
        return value === threshold;
      }
      case "gte": {
        return value >= threshold;
      }
      case "lte": {
        return value <= threshold;
      }
      default: {
        return false;
      }
    }
  }

  getMetrics(name: string, limit = 100): Metric[] {
    return this.store.get(name, limit);
  }

  getLatestMetric(name: string): Metric | undefined {
    return this.store.getLatest(name);
  }

  getSnapshot(): PerformanceSnapshot {
    return {
      activeRequests: 0,
      cpu: this.getCpuUsage(),
      eventLoopDelay: this.getEventLoopDelay(),
      memory: this.getMemoryUsage(),
    };
  }

  getSummary(): {
    uptime: number;
    totalMetrics: number;
    activeAlerts: number;
    rulesCount: number;
  } {
    let activeAlerts = 0;
    for (const state of this.alertState.values()) {
      if (state.active) {
        activeAlerts++;
      }
    }
    return {
      activeAlerts,
      rulesCount: this.alertRules.size,
      totalMetrics: this.store.size(),
      uptime: this.isRunning && this.startedAt > 0 ? Date.now() - this.startedAt : 0,
    };
  }

  reset(): void {
    this.store.clear();
    log.info("指标已重置");
  }

  isActive(): boolean {
    return this.isRunning;
  }
}

let globalDashboard: PerformanceDashboard | null = null;

export function getGlobalDashboard(): PerformanceDashboard {
  if (!globalDashboard) {
    globalDashboard = new PerformanceDashboard();
  }
  return globalDashboard;
}

export function createPerformanceDashboard(eventBus?: EventBus): PerformanceDashboard {
  return new PerformanceDashboard(eventBus);
}

export function createMemoryAlertRule(level: AlertLevel = "warning"): AlertRule {
  return {
    condition: "gte",
    durationMs: 30_000,
    enabled: true,
    id: "memory-high",
    level,
    metric: "memory.heapUsed",
    name: "内存使用过高",
    threshold: 500 * 1024 * 1024,
  };
}

export function createCpuAlertRule(threshold = 80, level: AlertLevel = "warning"): AlertRule {
  return {
    condition: "gte",
    durationMs: 30_000,
    enabled: true,
    id: "cpu-high",
    level,
    metric: "cpu.user",
    name: "CPU 使用过高",
    threshold,
  };
}
