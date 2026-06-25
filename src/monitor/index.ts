/**
 * Monitor 模块统一出入口 — 值导出。
 *
 * 子模块:
 *   - timing: 性能计时与仪表盘
 *   - resource: 资源监控
 *   - telemetry: OpenTelemetry 遥测
 *   - metrics: 统一指标采集
 */

// ── 类型统一导出 ───────────────────────────────────────────────
export type * from "./types";

// ── Shared ─────────────────────────────────────────────────────
export { CpuSampler } from "./shared/cpuSampler";

// ── Timing (performanceTiming + dashboard) ───────────────────────
export { PerformanceMonitor, measurePerformance, performanceMonitor } from "./timing/performanceTiming";
export {
  PerformanceDashboard,
  createCpuAlertRule,
  createMemoryAlertRule,
  createPerformanceDashboard,
  getGlobalDashboard,
} from "./timing/dashboard";

// ── Resource ─────────────────────────────────────────────────────
export {
  addMemorySample,
  generateResourceReport,
  getAlertThresholds,
  getCpuUsagePercent,
  getMemoryStats,
  getMemoryTrend,
  getMemoryUsageMB,
  getResourceStatus,
  getUptime,
  isResourceMonitorPaused,
  pauseResourceMonitor,
  recordAlert,
  recordResourceSample,
  resetResourceReport,
  resumeResourceMonitor,
  setAlertThresholds,
  startResourceMonitor,
  ResourceMonitor,
  resourceMonitor,
} from "./resource/resourceStatus";

// ── Telemetry ────────────────────────────────────────────────────
export {
  initTelemetry,
  shutdownTelemetry,
  getTracer,
  getMeter,
  getLogger,
  recordChatBusinessTelemetry,
  recordToolBusinessTelemetry,
  recordSearchBusinessTelemetry,
  recordCompressionBusinessTelemetry,
  withSpan,
  _setTelemetryForTesting,
} from "./telemetry/telemetry";
export { renderPrometheusMetrics, resetPrometheusMetricsForTesting } from "./telemetry/prometheusTelemetry";

// ── Metrics (unified collector) ──────────────────────────────────
export { collectMetrics } from "./metrics/metricsCollector";
