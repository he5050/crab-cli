/**
 * Monitor 模块统一出入口 — 类型导出。
 */

// ── Shared ───────────────────────────────────────────────────────
export type { CpuSample } from "./shared/cpuSampler";

// ── Timing ───────────────────────────────────────────────────────
export type {
  MetricType,
  PerformanceMetric,
  PerformanceMonitorConfig,
  PerformanceStats,
} from "./timing/performanceTiming";
export type {
  AlertEvent,
  AlertLevel,
  AlertRule,
  DashboardMetricType,
  Metric,
  PerformanceSnapshot,
} from "./timing/dashboard";

export type { AlertThresholds, ResourceReport, ResourceStatus } from "./resource/resourceStatus";

// ── Telemetry ────────────────────────────────────────────────────
export type {
  MiniSpan,
  MiniTracer,
  SpanAttributes,
  MetricAttributes,
  LogAttributes,
  MiniCounter,
  MiniHistogram,
  MiniUpDownCounter,
  MiniMeter,
  MiniLogger,
} from "./telemetry/telemetry";
export type {
  ChatBusinessTelemetry,
  CompressionBusinessTelemetry,
  SearchBusinessTelemetry,
  ToolBusinessTelemetry,
} from "./telemetry/telemetry";

// ── Metrics ──────────────────────────────────────────────────────
export type { UnifiedMetricsSnapshot } from "./metrics/metricsCollector";
