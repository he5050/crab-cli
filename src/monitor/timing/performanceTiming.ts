/**
 * 性能计时模块 — 面向 api/tool/ui/memory/cpu 的轻量级计时与统计。
 *
 * 职责:
 *   - 提供同步/异步函数计时(measure/measureSync)与装饰器 measurePerformance
 *   - 维护每类指标的历史环形缓冲
 *   - 按 type/name 计算聚合统计(含 p95/p99)
 *   - 命中慢阈值时打 warn 日志
 *
 * 模块功能:
 *   - PerformanceMonitor: 性能监控类
 *   - performanceMonitor: 全局单例
 *   - measure / measureSync: 同步异步计时包裹
 *   - measurePerformance: 方法装饰器
 *   - MetricType: 指标维度(api/tool/ui/memory/cpu)
 *   - PerformanceMetric / PerformanceStats: 数据契约
 *
 * 使用场景:
 *   - 关键 API、工具调用、UI 渲染耗时的运行时观测
 *   - 与 metricsCollector 对接上报
 *
 * 边界:
 *   1. 不做分布式追踪；仅进程内
 *   2. 指标超 maxMetrics(默认 1000)时按 RingBuffer 滚动丢弃
 *   3. enabled=false 时所有操作退化(start 返回 ""，end 返回 null)
 *   4. 异常路径仍会 end(id, false) 然后 rethrow
 *
 * 流程:
 *   1. start 生成 id 并入 in-flight Map
 *   2. 执行被计时函数
 *   3. end 计算 durationMs → 写历史 → 判定慢阈值 → 输出日志
 *   4. getStats / generateReport 基于历史聚合
 */
import { createLogger } from "@/core/logging/logger";
import { RingBuffer } from "@/core/concurrency/ringBuffer";
import { compactId } from "@/core/id";

const log = createLogger("performance-timing");

/** 性能指标类型(performanceMonitor 语义:api/tool/ui/memory/cpu) */
export type MetricType = "api" | "tool" | "ui" | "memory" | "cpu";

/** 性能指标(performanceMonitor 语义) */
export interface PerformanceMetric {
  id: string;
  type: MetricType;
  name: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  success?: boolean;
  error?: string;
  metadata?: Record<string, unknown>;
}

/** 性能统计(performanceMonitor 语义) */
export interface PerformanceStats {
  count: number;
  totalDurationMs: number;
  avgDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  successRate: number;
  p95DurationMs: number;
  p99DurationMs: number;
}

/** 性能监控配置 */
export interface PerformanceMonitorConfig {
  enabled: boolean;
  slowThresholdMs: Record<MetricType, number>;
  maxMetrics: number;
  autoLog: boolean;
}

const DEFAULT_PERF_CONFIG: PerformanceMonitorConfig = {
  autoLog: true,
  enabled: true,
  maxMetrics: 1000,
  slowThresholdMs: {
    api: 5000,
    cpu: 0,
    memory: 0,
    tool: 3000,
    ui: 100,
  },
};

/** 性能监控器 */
export class PerformanceMonitor {
  private config: PerformanceMonitorConfig;
  private metrics = new Map<string, PerformanceMetric>();
  private metricHistory: RingBuffer<PerformanceMetric>;

  constructor(config: Partial<PerformanceMonitorConfig> = {}) {
    this.config = { ...DEFAULT_PERF_CONFIG, ...config };
    this.metricHistory = new RingBuffer<PerformanceMetric>(this.config.maxMetrics);
  }

  start(type: MetricType, name: string, metadata?: Record<string, unknown>): string {
    if (!this.config.enabled) {
      return "";
    }
    const id = `${type}:${name}:${compactId(":", 9)}`;
    const metric: PerformanceMetric = {
      id,
      metadata,
      name,
      startTime: Date.now(),
      type,
    };
    this.metrics.set(id, metric);
    log.debug(`性能监控开始`, { id, metadata, name, type });
    return id;
  }

  end(id: string, success: boolean = true, error?: string): PerformanceMetric | null {
    if (!this.config.enabled || !id) {
      return null;
    }
    const metric = this.metrics.get(id);
    if (!metric) {
      log.warn(`未找到性能指标`, { id });
      return null;
    }
    metric.endTime = Date.now();
    metric.durationMs = metric.endTime - metric.startTime;
    metric.success = success;
    metric.error = error;
    this.metrics.delete(id);
    this.addToHistory(metric);

    const threshold = this.config.slowThresholdMs[metric.type];
    if (threshold > 0 && metric.durationMs > threshold) {
      log.warn(`慢操作 detected`, {
        durationMs: metric.durationMs,
        metadata: metric.metadata,
        name: metric.name,
        thresholdMs: threshold,
        type: metric.type,
      });
    }

    if (this.config.autoLog) {
      log.debug(`性能监控结束`, {
        durationMs: metric.durationMs,
        id: metric.id,
        name: metric.name,
        success: metric.success,
        type: metric.type,
      });
    }
    return metric;
  }

  async measure<T>(
    type: MetricType,
    name: string,
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>,
  ): Promise<T> {
    const id = this.start(type, name, metadata);
    try {
      const result = await fn();
      this.end(id, true);
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.end(id, false, errorMsg);
      throw error;
    }
  }

  measureSync<T>(type: MetricType, name: string, fn: () => T, metadata?: Record<string, unknown>): T {
    const id = this.start(type, name, metadata);
    try {
      const result = fn();
      this.end(id, true);
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.end(id, false, errorMsg);
      throw error;
    }
  }

  getStats(type: MetricType, name?: string): PerformanceStats {
    const filtered = this.metricHistory.toArray().filter((m) => m.type === type && (!name || m.name === name));
    return this.computeStats(filtered);
  }

  private computeStats(filtered: PerformanceMetric[]): PerformanceStats {
    if (filtered.length === 0) {
      return {
        avgDurationMs: 0,
        count: 0,
        maxDurationMs: 0,
        minDurationMs: 0,
        p95DurationMs: 0,
        p99DurationMs: 0,
        successRate: 0,
        totalDurationMs: 0,
      };
    }
    const durationValues = filtered.map((m) => m.durationMs ?? 0);
    const totalDurationMs = durationValues.reduce((a, b) => a + b, 0);
    const successCount = filtered.filter((m) => m.success).length;
    const durations = durationValues.toSorted((a, b) => a - b);
    return {
      avgDurationMs: totalDurationMs / filtered.length,
      count: filtered.length,
      maxDurationMs: durations[durations.length - 1] ?? 0,
      minDurationMs: durations[0] ?? 0,
      p95DurationMs: this.percentile(durations, 0.95),
      p99DurationMs: this.percentile(durations, 0.99),
      successRate: successCount / filtered.length,
      totalDurationMs,
    };
  }

  getHistory(): PerformanceMetric[] {
    return this.metricHistory.toArray();
  }

  clear(): void {
    this.metricHistory.clear();
    this.metrics.clear();
    log.debug(`性能监控历史已清空`);
  }

  updateConfig(config: Partial<PerformanceMonitorConfig>): void {
    this.config = { ...this.config, ...config };
    log.debug(`性能监控配置已更新`, { config: this.config });
  }

  generateReport(): Record<MetricType, Record<string, PerformanceStats>> {
    const report = {} as Record<MetricType, Record<string, PerformanceStats>>;
    const types: MetricType[] = ["api", "tool", "ui", "memory", "cpu"];
    const history = this.metricHistory.toArray();
    for (const type of types) {
      const typeMetrics = history.filter((m) => m.type === type);
      report[type] = {};
      const groups = new Map<string, typeof typeMetrics>();
      for (const m of typeMetrics) {
        let group = groups.get(m.name);
        if (!group) {
          group = [];
          groups.set(m.name, group);
        }
        group.push(m);
      }
      for (const [name, metrics] of groups) {
        report[type][name] = this.computeStats(metrics);
      }
    }
    return report;
  }

  private addToHistory(metric: PerformanceMetric): void {
    this.metricHistory.push(metric);
  }

  private percentile(sortedValues: number[], p: number): number {
    if (sortedValues.length === 0) {
      return 0;
    }
    const index = Math.ceil(sortedValues.length * p) - 1;
    return sortedValues[Math.max(0, index)] ?? 0;
  }
}

/** 全局性能监控实例 */
export const performanceMonitor = new PerformanceMonitor();

/** 装饰器:自动测量函数性能 */
export function measurePerformance(type: MetricType, name?: string) {
  return function (_target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const metricName = name || propertyKey;
    descriptor.value = async function value(...args: any[]) {
      return performanceMonitor.measure(type, metricName, () => originalMethod.apply(this, args), {
        args: JSON.stringify(args).slice(0, 200),
      });
    };
    return descriptor;
  };
}
