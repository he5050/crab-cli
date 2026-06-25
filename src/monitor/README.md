# Monitor Module — 性能监控与遥测

## 整体定位

Monitor 模块是系统的可观测性中枢，负责性能监控、资源采集、业务指标埋点和 OpenTelemetry 遥测导出。它为 CLI 运行时提供全维度的健康监控、指标采集和分布式追踪能力。

## 核心功能

1. **性能计时** — 对 API/工具/UI/内存/CPU 操作进行轻量级计时与统计（p95/p99）
2. **性能仪表盘** — 多类型指标采集（counter/gauge/histogram/timer）与告警规则评估
3. **资源监控** — 周期采集 CPU/内存使用率，计算趋势，生成可读报告
4. **OpenTelemetry 遥测** — 完整三支柱（Traces + Metrics + Logs），支持 OTLP/Console/Prometheus 导出
5. **业务指标埋点** — 聊天、工具调用、搜索、压缩四大场景的结构化指标上报
6. **统一指标采集** — 聚合所有监控域的快照，提供一站式指标查询入口

## 目录结构

```
src/monitor/
├── index.ts              # 统一出入口（值导出 + 类型导出）
├── types.ts              # 统一出入口（类型导出）
├── README.md             # 本文档
│
├── shared/               # 公共工具
│   └── cpuSampler.ts          # 增量式 CPU 百分比采集器（dashboard/resource 共享）
│
├── timing/               # 性能计时与仪表盘
│   ├── performanceTiming.ts   # 轻量级计时器（measure/measureSync/装饰器）
│   └── dashboard.ts           # 多类型指标仪表盘（counter/gauge/histogram/timer）
│
├── resource/             # 资源监控
│   └── resourceStatus.ts      # CPU/内存采集、趋势分析、告警、报告生成
│
├── telemetry/            # OpenTelemetry 遥测
│   ├── telemetry.ts           # 三支柱初始化 + 业务埋点 API
│   ├── prometheusTelemetry.ts # Prometheus 文本格式渲染
│   └── businessTelemetryTypes.ts # 业务指标类型定义
│
└── metrics/              # 统一指标采集
    └── metricsCollector.ts    # 聚合所有域的指标快照
```

## 子模块说明

| 子模块       | 职责                          | 主要导出                                                                                                                    |
| ------------ | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `shared/`    | 公共工具                      | `CpuSampler`, `CpuSample`                                                                                                   |
| `timing/`    | 性能计时 + 仪表盘             | `PerformanceMonitor`, `performanceMonitor`, `PerformanceDashboard`, `getGlobalDashboard`, `measurePerformance`              |
| `resource/`  | 资源监控                      | `startResourceMonitor`, `getResourceStatus`, `getMemoryStats`, `getMemoryTrend`, `generateResourceReport`                   |
| `telemetry/` | OpenTelemetry 遥测 + 业务埋点 | `initTelemetry`, `shutdownTelemetry`, `getTracer`, `getMeter`, `recordChatBusinessTelemetry`, `recordToolBusinessTelemetry` |
| `metrics/`   | 统一采集入口                  | `collectMetrics`                                                                                                            |

## 完整 API 导出

### 类型导出

```typescript
import type {
  // Timing
  MetricType, // "api" | "tool" | "ui" | "memory" | "cpu"
  PerformanceMetric, // 单次计时记录
  PerformanceMonitorConfig, // 监控器配置
  PerformanceStats, // 聚合统计（count/avg/p95/p99/successRate）
  DashboardMetricType, // "counter" | "gauge" | "histogram" | "timer"
  Metric, // 通用指标
  PerformanceSnapshot, // 性能快照（memory/cpu/eventLoopDelay）
  AlertLevel, // "info" | "warning" | "critical"
  AlertRule, // 告警规则（含 durationMs 持续触发字段）
  AlertEvent, // 告警事件

  // Resource
  ResourceStatus, // 资源状态快照
  ResourceReport, // 资源使用报告
  AlertThresholds, // 告警阈值配置

  // Telemetry
  SpanAttributes, // Span 属性
  MetricAttributes, // Metric 属性
  LogAttributes, // Log 属性
  MiniSpan, // Span 最小接口
  MiniTracer, // Tracer 最小接口
  MiniCounter, // Counter 最小接口
  MiniHistogram, // Histogram 最小接口
  MiniUpDownCounter, // UpDownCounter 最小接口
  MiniMeter, // Meter 最小接口
  MiniLogger, // Logger 最小接口
  ChatBusinessTelemetry, // 聊天业务指标
  ToolBusinessTelemetry, // 工具调用业务指标
  SearchBusinessTelemetry, // 搜索业务指标
  CompressionBusinessTelemetry, // 压缩业务指标

  // Metrics
  UnifiedMetricsSnapshot, // 统一指标快照
} from "@monitor";
```

### 值导出

```typescript
import {
  // ─── Timing: PerformanceMonitor ─────────────────────────
  PerformanceMonitor, // 性能监控器类
  performanceMonitor, // 全局单例
  measurePerformance, // 方法装饰器
  getGlobalDashboard, // 获取全局仪表盘单例
  createPerformanceDashboard, // 创建独立仪表盘实例

  // ─── Timing: PerformanceDashboard ────────────────────────
  PerformanceDashboard, // 仪表盘类
  createCpuAlertRule, // CPU 告警规则预设
  createMemoryAlertRule, // 内存告警规则预设

  // ─── Resource ────────────────────────────────────────────
  startResourceMonitor, // 启动资源监控（返回 stop 函数）
  pauseResourceMonitor, // 暂停监控
  resumeResourceMonitor, // 恢复监控
  isResourceMonitorPaused, // 是否暂停
  getResourceStatus, // 获取资源状态快照
  getUptime, // 获取进程运行时长（秒）
  getMemoryUsageMB, // 获取内存使用（MB）
  getCpuUsagePercent, // 获取 CPU 使用率（%）
  getMemoryStats, // 获取内存统计（current/min/max/avg/trend）
  getMemoryTrend, // 获取内存趋势（direction/rate/samples）
  addMemorySample, // 添加内存样本
  recordResourceSample, // 记录资源样本
  recordAlert, // 记录告警计数
  generateResourceReport, // 生成资源使用报告
  resetResourceReport, // 重置报告统计
  setAlertThresholds, // 设置告警阈值
  getAlertThresholds, // 获取告警阈值

  // ─── Telemetry: Lifecycle ────────────────────────────────
  initTelemetry, // 初始化遥测（幂等）
  shutdownTelemetry, // 关闭遥测（flush + shutdown）
  getTracer, // 获取 Tracer（未初始化返回 noop）
  getMeter, // 获取 Meter（未初始化返回 noop）
  getLogger, // 获取 Logger（未初始化返回 noop）
  withSpan, // 便捷函数：创建 span → 执行 → 自动 end

  // ─── Telemetry: Business Metrics ─────────────────────────
  recordChatBusinessTelemetry, // 记录聊天业务指标
  recordToolBusinessTelemetry, // 记录工具调用业务指标
  recordSearchBusinessTelemetry, // 记录搜索业务指标
  recordCompressionBusinessTelemetry, // 记录压缩业务指标

  // ─── Telemetry: Prometheus ───────────────────────────────
  renderPrometheusMetrics, // 渲染 Prometheus 文本格式
  resetPrometheusMetricsForTesting, // 测试用清理

  // ─── Testing ─────────────────────────────────────────────
  _setTelemetryForTesting, // 测试专用：注入 fake meter/logger

  // ─── Metrics: Unified Collector ──────────────────────────
  collectMetrics, // 采集统一指标快照
} from "@monitor";
```

## 使用方法

### 性能计时

```typescript
import { performanceMonitor, measurePerformance } from "@monitor";

// 方式1: 手动计时
const id = performanceMonitor.start("api", "fetchUser");
await fetchUser();
performanceMonitor.end(id, true);

// 方式2: 包裹函数
const result = await performanceMonitor.measure("tool", "executeTool", async () => {
  return await executeTool();
});

// 方式3: 同步计时
const syncResult = performanceMonitor.measureSync("cpu", "heavyComputation", () => {
  return heavyComputation();
});

// 方式4: 装饰器
class MyService {
  @measurePerformance("api", "myMethod")
  async myMethod() {
    // ...
  }
}

// 获取统计报告
const report = performanceMonitor.generateReport();
// → { api: { myMethod: { count, avgDurationMs, p95DurationMs, ... } }, ... }
```

### 性能仪表盘

```typescript
import { getGlobalDashboard, createCpuAlertRule } from "@monitor";

const dashboard = getGlobalDashboard();
dashboard.start(5000); // 每5秒采集

// 打点
dashboard.record("custom.metric", 42, "gauge", { unit: "ms" });
dashboard.incrementCounter("requests.total");
dashboard.recordHistogram("request.duration", 123);

// 计时器
const stopTimer = dashboard.startTimer("operation");
await doOperation();
stopTimer();

// 告警规则
dashboard.addAlertRule(createCpuAlertRule(80, "warning"));
dashboard.on("alert", (event) => {
  console.log(`告警: ${event.ruleName} - ${event.metric} = ${event.currentValue}`);
});

// 获取快照
const snapshot = dashboard.getSnapshot();
const summary = dashboard.getSummary();
```

### 资源监控

```typescript
import { startResourceMonitor, getResourceStatus, getMemoryStats } from "@monitor";

// 启动监控（默认间隔由配置决定）
const stop = startResourceMonitor();

// 获取实时状态
const status = getResourceStatus();
// → { version, memoryMB, cpuPercent, uptime, pid }

// 获取内存统计与趋势
const memoryStats = getMemoryStats();
// → { current, min, max, avg, trend: { direction, rate, samples } }

// 生成报告
const report = generateResourceReport();
// → { period, memory, cpu, summary, recommendations }

// 暂停/恢复
pauseResourceMonitor();
resumeResourceMonitor();

// 停止
stop();
```

### OpenTelemetry 遥测

```typescript
import { initTelemetry, shutdownTelemetry, getTracer, withSpan } from "@monitor";

// 初始化（默认关闭，零开销）
await initTelemetry({
  enabled: true,
  exporterType: "otlp", // "otlp" | "console" | "prometheus" | "none"
  endpoint: "http://localhost:4318/v1/traces",
  serviceName: "crab-cli",
  sampleRate: 1,
});

// 使用 Tracer
const tracer = getTracer("my-service");
const span = tracer.startSpan("myOperation", { attributes: { key: "value" } });
try {
  await doWork();
  span.setStatus({ code: 0 });
} catch (error) {
  span.recordException(error);
  span.setStatus({ code: 2 });
  throw error;
} finally {
  span.end();
}

// 便捷函数
await withSpan("myOperation", { attr: "value" }, async (span) => {
  return await doWork();
});

// 关闭
await shutdownTelemetry();
```

### 业务指标埋点

```typescript
import { recordChatBusinessTelemetry, recordToolBusinessTelemetry } from "@monitor";

// 聊天指标
recordChatBusinessTelemetry({
  provider: "openai",
  model: "gpt-4",
  status: "success",
  exitReason: "completed",
  round: 3,
  durationMs: 1234,
  usage: {
    inputTokens: 500,
    outputTokens: 200,
    cachedTokens: 100,
  },
});

// 工具调用指标
recordToolBusinessTelemetry({
  toolName: "codebaseSearch",
  success: true,
  exitReason: "completed",
  durationMs: 456,
  sensitive: false,
});

// 搜索指标
recordSearchBusinessTelemetry({
  mode: "semantic",
  status: "success",
  exitReason: "found",
  durationMs: 789,
  total: 12,
  cached: false,
  agentReviewEnabled: true,
});

// 压缩指标
recordCompressionBusinessTelemetry({
  mode: "hybrid",
  status: "success",
  exitReason: "completed",
  durationMs: 2000,
  messageCount: 50,
  tokensBefore: 80000,
  tokensAfter: 20000,
});
```

### 统一指标采集

```typescript
import { collectMetrics } from "@monitor";

const snapshot = collectMetrics();
// → {
//   collectedAt: timestamp,
//   performance: { history, report },
//   dashboard: { summary, snapshot },
//   resource: { status, thresholds, memory, report },
// }
```

## 配置项

### PerformanceMonitorConfig

| 配置项                 | 类型      | 默认值 | 说明                              |
| ---------------------- | --------- | ------ | --------------------------------- |
| `enabled`              | `boolean` | `true` | 是否启用                          |
| `slowThresholdMs.api`  | `number`  | `5000` | API 慢操作阈值（毫秒）            |
| `slowThresholdMs.tool` | `number`  | `3000` | 工具慢操作阈值                    |
| `slowThresholdMs.ui`   | `number`  | `100`  | UI 慢操作阈值                     |
| `maxMetrics`           | `number`  | `1000` | 最大指标历史数（RingBuffer 大小） |
| `autoLog`              | `boolean` | `true` | 是否自动输出 debug 日志           |

### AlertThresholds

| 配置项       | 类型     | 默认值                        | 说明               |
| ------------ | -------- | ----------------------------- | ------------------ |
| `memoryMB`   | `number` | `MEMORY_WARNING_THRESHOLD_MB` | 内存告警阈值（MB） |
| `cpuPercent` | `number` | `80`                          | CPU 告警阈值（%）  |

### TelemetryConfig

| 配置项         | 类型      | 默认值       | 说明                                                              |
| -------------- | --------- | ------------ | ----------------------------------------------------------------- |
| `enabled`      | `boolean` | `false`      | 是否启用遥测                                                      |
| `exporterType` | `string`  | `"none"`     | 导出器类型：`"otlp"` \| `"console"` \| `"prometheus"` \| `"none"` |
| `endpoint`     | `string`  | `undefined`  | OTLP 端点 URL                                                     |
| `serviceName`  | `string`  | `"crab-cli"` | 服务名称                                                          |
| `sampleRate`   | `number`  | `1`          | 采样率（0-1）                                                     |

## 与外部系统的交互

| 外部模块                 | 交互方式          | 说明                                                             |
| ------------------------ | ----------------- | ---------------------------------------------------------------- |
| `@config`                | 读取监控配置      | `RESOURCE_MONITOR_INTERVAL_MS`, `MEMORY_WARNING_THRESHOLD_MB` 等 |
| `@bus/eventBus`          | 发布资源更新事件  | `AppEvent.ResourceUpdate`                                        |
| `@core/logging/logger`   | 日志输出          | 监控过程的日志记录                                               |
| `@core/queue/ringBuffer` | 环形缓冲存储      | 指标历史存储                                                     |
| `@opentelemetry/*`       | 动态加载 OTEL SDK | 遥测三支柱实现（可选依赖）                                       |
| `@schema/config`         | 读取遥测配置      | `AppConfigSchema.telemetry`                                      |

## 边界与限制

1. **进程内监控** — 仅采集当前进程指标，不感知子进程/容器级资源
2. **遥测默认关闭** — `enabled: false` 时返回 noop 实例，零开销
3. **告警冷却** — 资源告警有 30 秒冷却期，避免日志刷屏
4. **事件循环延迟** — 使用 `setImmediate` 粗粒度估算，仅供参考
5. **指标滚动丢弃** — 超过 `maxMetrics` 时按 RingBuffer 策略丢弃旧数据
6. **Prometheus 导出** — 仅渲染文本格式，不负责暴露 HTTP 端点（由 `@server` 处理）
7. **告警状态机** — 告警触发后需先恢复（条件不再满足）才能再次触发

## 设计决策

| 决策                                              | 原因                                                                               |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 三套独立的性能监控域（timing/resource/telemetry） | 不同场景需要不同粒度的观测：轻量计时 vs 仪表盘 vs 分布式遥测                       |
| 遥测动态加载 OTEL SDK                             | 避免未安装 OTEL 时编译报错，保持可选依赖                                           |
| Noop 模式                                         | 未启用时零开销，不影响生产性能                                                     |
| RingBuffer 存储                                   | 固定内存占用，避免指标无限增长导致 OOM                                             |
| 业务指标与基础设施指标分离                        | 业务指标面向 BI/分析，基础设施指标面向运维，导出格式和标签体系不同                 |
| CpuSampler 公共采集器                             | dashboard 和 resourceStatus 共享同一增量 CPU 计算逻辑，消除重复实现                |
| Dashboard 订阅 ResourceUpdate                     | 当 ResourceMonitor 活跃时，Dashboard 复用其 CPU/内存数据而非独立采集，减少系统调用 |

## CpuSampler 使用示例

```typescript
import { CpuSampler } from "@monitor";

// 创建独立实例（适合自定义监控场景）
const sampler = new CpuSampler();

// 首次调用建立基线，返回 { user: 0, system: 0 }
const first = sampler.sample();

// 后续调用返回瞬时百分比
const cpu = sampler.sample();
console.log(`CPU 用户态: ${cpu.user}%, 内核态: ${cpu.system}%`);

// 重置基线（进程生命周期变化时）
sampler.reset();
```

## 故障排查

| 现象                | 可能原因                         | 排查步骤                                                        |
| ------------------- | -------------------------------- | --------------------------------------------------------------- |
| 计时数据为空        | `enabled: false`                 | 检查 `PerformanceMonitorConfig.enabled`                         |
| 告警未触发          | 阈值设置过高                     | 检查 `AlertThresholds` 配置值                                   |
| 遥测无数据          | `exporterType: "none"`           | 检查 `TelemetryConfig.exporterType` 和 `enabled`                |
| Prometheus 指标为空 | 未调用 `enablePrometheusMetrics` | 确认 `initTelemetry` 使用 `prometheus` 导出器                   |
| 内存趋势不准确      | 采样窗口太小                     | 检查 `MEMORY_TREND_WINDOW_SIZE` 配置                            |
| 资源监控未启动      | `startResourceMonitor` 未调用    | 确认入口文件（`src/index.ts`）中调用了 `startResourceMonitor()` |
