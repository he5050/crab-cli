/**
 * Prometheus 遥测模块 — 将内部指标渲染为 Prometheus 文本格式并提供 MiniMeter 适配。
 *
 * 职责:
 *   - 维护 counter / histogram / gauge 三类内部时序存储
 *   - 提供与 telemetry.ts 中 MiniMeter 等价的适配层
 *   - 渲染符合 Prometheus 文本格式的指标输出
 *
 * 模块功能:
 *   - enablePrometheusMetrics / disablePrometheusMetrics: 启用开关
 *   - resetPrometheusMetricsForTesting: 测试用清理
 *   - createPrometheusMeter: 构造 MiniMeter
 *   - renderPrometheusMetrics: 渲染为 Prometheus 文本
 *
 * 使用场景:
 *   - 启用了 prometheus 导出器时由 metricsCollector 注入此 meter
 *   - 运维通过 /metrics 端点抓取指标
 *
 * 边界:
 *   1. 不负责暴露 HTTP 端点(由 metricsCollector 持有)
 *   2. 关闭时不写值；非法输入(<=0 / NaN)忽略
 *   3. label 排序后拼接，保证 series key 稳定
 *
 * 流程:
 *   1. createCounter/Histogram/UpDownCounter → 内部分别入 counter/histogram/gauge 桶
 *   2. renderPrometheusMetrics 遍历三桶并按 metric name 排序输出
 *   3. label 转义后写入文本格式
 */
import type { MetricAttributes, MiniMeter } from "./telemetry";

interface PrometheusSeries {
  value: number;
  labels: MetricAttributes;
}

interface PrometheusHistogramSeries {
  count: number;
  sum: number;
  labels: MetricAttributes;
}

const prometheusCounters = new Map<string, PrometheusSeries>();
const prometheusHistograms = new Map<string, PrometheusHistogramSeries>();
const prometheusGauges = new Map<string, PrometheusSeries>();

let prometheusEnabled = false;
let prometheusServiceName = "crab-cli";

export function enablePrometheusMetrics(serviceName: string): void {
  prometheusEnabled = true;
  prometheusServiceName = serviceName;
}

export function disablePrometheusMetrics(): void {
  prometheusEnabled = false;
  prometheusServiceName = "crab-cli";
}

export function resetPrometheusMetricsForTesting(): void {
  prometheusCounters.clear();
  prometheusHistograms.clear();
  prometheusGauges.clear();
}

export function createPrometheusMeter(): MiniMeter {
  return {
    createCounter(name) {
      return {
        add(value, attributes) {
          if (!prometheusEnabled || value <= 0) {
            return;
          }
          addPrometheusCounter(name, value, attributes);
        },
      };
    },
    createHistogram(name) {
      return {
        record(value, attributes) {
          if (!prometheusEnabled || !Number.isFinite(value)) {
            return;
          }
          recordPrometheusHistogram(name, Math.max(0, value), attributes);
        },
      };
    },
    createUpDownCounter(name) {
      return {
        add(value, attributes) {
          if (!prometheusEnabled || !Number.isFinite(value)) {
            return;
          }
          setPrometheusGauge(name, value, attributes);
        },
      };
    },
  };
}

export function renderPrometheusMetrics(): string {
  const lines: string[] = [
    "# HELP crab_build_info Crab CLI build and telemetry metadata.",
    "# TYPE crab_build_info gauge",
    `crab_build_info{service="${escapePrometheusLabelValue(prometheusServiceName)}",exporter="prometheus"} ${prometheusEnabled ? 1 : 0}`,
  ];

  const counterNames = new Set([...prometheusCounters.keys()].map((key) => key.split("|", 1)[0]!).filter(Boolean));
  for (const name of [...counterNames].toSorted()) {
    const metricName = prometheusMetricName(name);
    lines.push(`# TYPE ${metricName}_total counter`);
    for (const series of valuesForMetric(prometheusCounters, name)) {
      lines.push(`${metricName}_total${prometheusLabelString(series.labels)} ${series.value}`);
    }
  }

  const histogramNames = new Set([...prometheusHistograms.keys()].map((key) => key.split("|", 1)[0]!).filter(Boolean));
  for (const name of [...histogramNames].toSorted()) {
    const metricName = prometheusMetricName(name);
    lines.push(`# TYPE ${metricName} histogram`);
    for (const series of valuesForMetric(prometheusHistograms, name)) {
      const labels = prometheusLabelString(series.labels);
      lines.push(`${metricName}_count${labels} ${series.count}`);
      lines.push(`${metricName}_sum${labels} ${series.sum}`);
    }
  }

  const gaugeNames = new Set([...prometheusGauges.keys()].map((key) => key.split("|", 1)[0]!).filter(Boolean));
  for (const name of [...gaugeNames].toSorted()) {
    const metricName = prometheusMetricName(name);
    lines.push(`# TYPE ${metricName} gauge`);
    for (const series of valuesForMetric(prometheusGauges, name)) {
      lines.push(`${metricName}${prometheusLabelString(series.labels)} ${series.value}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function addPrometheusCounter(name: string, value: number, labels?: MetricAttributes): void {
  const key = prometheusSeriesKey(name, labels);
  const current = prometheusCounters.get(key) ?? { labels: labels ?? {}, value: 0 };
  current.value += value;
  prometheusCounters.set(key, current);
}

function recordPrometheusHistogram(name: string, value: number, labels?: MetricAttributes): void {
  const key = prometheusSeriesKey(name, labels);
  const current = prometheusHistograms.get(key) ?? { count: 0, labels: labels ?? {}, sum: 0 };
  current.count += 1;
  current.sum += value;
  prometheusHistograms.set(key, current);
}

/** 设置 Prometheus gauge 绝对值（gauge 语义为瞬时值，非累加） */
function setPrometheusGauge(name: string, value: number, labels?: MetricAttributes): void {
  const key = prometheusSeriesKey(name, labels);
  prometheusGauges.set(key, { labels: labels ?? {}, value });
}

function prometheusSeriesKey(name: string, labels?: MetricAttributes): string {
  const labelPairs = Object.entries(labels ?? {})
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${String(value)}`);
  return `${name}|${labelPairs.join("|")}`;
}

function prometheusMetricName(name: string): string {
  return `crab_${name.replace(/[^a-zA-Z0-9_:]/g, "_")}`;
}

function prometheusLabelString(labels: MetricAttributes): string {
  const entries = Object.entries(labels).filter(([, value]) => value !== undefined && value !== "");
  if (entries.length === 0) {
    return "";
  }
  const body = entries
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key.replace(/[^a-zA-Z0-9_]/g, "_")}="${escapePrometheusLabelValue(String(value))}"`)
    .join(",");
  return `{${body}}`;
}

function escapePrometheusLabelValue(value: string): string {
  return value
    .replace(/\\/g, String.raw`\\`)
    .replace(/"/g, String.raw`\"`)
    .replace(/\n/g, String.raw`\n`);
}

function valuesForMetric<T>(series: Map<string, T>, name: string): T[] {
  return [...series.entries()].filter(([key]) => key.startsWith(`${name}|`)).map(([, value]) => value);
}
