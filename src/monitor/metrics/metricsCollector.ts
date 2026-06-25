/**
 * 统一指标采集入口 — 聚合所有监控域的快照。
 *
 * 职责:
 *   - 聚合 timing / dashboard / resource 三个域的指标快照
 *   - 提供一站式 collectMetrics() 查询
 *
 * 边界:
 *   - 不负责子模块的 re-export（由 index.ts 统一管理）
 */
import {
  type MetricType,
  type PerformanceMetric,
  type PerformanceStats,
  performanceMonitor,
} from "../timing/performanceTiming";
import { type PerformanceDashboard, type PerformanceSnapshot, getGlobalDashboard } from "../timing/dashboard";
import {
  type AlertThresholds,
  type ResourceReport,
  type ResourceStatus,
  generateResourceReport,
  getAlertThresholds,
  getMemoryStats,
  getResourceStatus,
} from "../resource/resourceStatus";

export interface UnifiedMetricsSnapshot {
  collectedAt: number;
  performance: {
    history: PerformanceMetric[];
    report: Record<MetricType, Record<string, PerformanceStats>>;
  };
  dashboard: {
    summary: ReturnType<PerformanceDashboard["getSummary"]>;
    snapshot: PerformanceSnapshot;
  };
  resource: {
    status: ResourceStatus;
    thresholds: AlertThresholds;
    memory: ReturnType<typeof getMemoryStats>;
    report: ResourceReport;
  };
}

export function collectMetrics(): UnifiedMetricsSnapshot {
  const dashboard = getGlobalDashboard();
  return {
    collectedAt: Date.now(),
    dashboard: {
      snapshot: dashboard.getSnapshot(),
      summary: dashboard.getSummary(),
    },
    performance: {
      history: performanceMonitor.getHistory(),
      report: performanceMonitor.generateReport(),
    },
    resource: {
      memory: getMemoryStats(),
      report: generateResourceReport(),
      status: getResourceStatus(),
      thresholds: getAlertThresholds(),
    },
  };
}
