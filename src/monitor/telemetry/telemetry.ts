/**
 * OpenTelemetry 遥测模块 — 完整可观测性三支柱(Traces + Metrics + Logs)，默认关闭。
 *
 * 职责:
 *   - 根据配置初始化 TracerProvider / MeterProvider / LoggerProvider + Exporters
 *   - 提供 getTracer / getMeter / getLogger 便捷 API
 *   - 未启用时返回 noop 实例，零开销
 *
 * 边界:
 *   1. 不修改现有 metricsCollector(内部性能监控)
 *   2. 幂等初始化，重复调用安全
 *   3. 处理 traces / metrics / logs 三支柱
 */

import { createLogger } from "@/core/logging/logger";
import type { AppConfigSchema } from "@/schema/config";
import { createPrometheusMeter, disablePrometheusMetrics, enablePrometheusMetrics } from "./prometheusTelemetry";
import type {
  ChatBusinessTelemetry,
  CompressionBusinessTelemetry,
  SearchBusinessTelemetry,
  ToolBusinessTelemetry,
} from "./businessTelemetryTypes";

const log = createLogger("monitor:telemetry");

export { renderPrometheusMetrics, resetPrometheusMetricsForTesting } from "./prometheusTelemetry";
export type {
  ChatBusinessTelemetry,
  CompressionBusinessTelemetry,
  SearchBusinessTelemetry,
  ToolBusinessTelemetry,
} from "./businessTelemetryTypes";

// ── 类型 ─────────────────────────────────────────────────────────

interface TelemetryConfig {
  enabled: boolean;
  endpoint?: string;
  serviceName: string;
  exporterType: "otlp" | "console" | "prometheus" | "none";
  sampleRate: number;
}

/** Span 属性 */
export type SpanAttributes = Record<string, string | number | boolean | undefined>;

/** Metric 属性 */
export type MetricAttributes = Record<string, string | number | boolean>;

/** Log 属性 */
export type LogAttributes = Record<string, string | number | boolean | unknown>;

/** 最小 Span 接口(兼容 noop 和 real) */
export interface MiniSpan {
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus(status: { code: number; message?: string }): void;
  recordException(error: unknown): void;
  end(): void;
}

/** 最小 Tracer 接口 */
export interface MiniTracer {
  startSpan(name: string, options?: { attributes?: SpanAttributes }): MiniSpan;
}

/** 最小 Counter 接口 */
export interface MiniCounter {
  add(value: number, attributes?: MetricAttributes): void;
}

/** 最小 Histogram 接口 */
export interface MiniHistogram {
  record(value: number, attributes?: MetricAttributes): void;
}

/** 最小 UpDownCounter 接口 */
export interface MiniUpDownCounter {
  add(value: number, attributes?: MetricAttributes): void;
}

/** 最小 Meter 接口 */
export interface MiniMeter {
  createCounter(name: string, options?: { description?: string; unit?: string }): MiniCounter;
  createHistogram(name: string, options?: { description?: string; unit?: string }): MiniHistogram;
  createUpDownCounter(name: string, options?: { description?: string; unit?: string }): MiniUpDownCounter;
}

/** 最小 Logger 接口 */
export interface MiniLogger {
  emit(logRecord: { severityNumber?: number; severityText?: string; body: string; attributes?: LogAttributes }): void;
}

// ── Noop 实现 ────────────────────────────────────────────────────

const noopSpan: MiniSpan = {
  end() {},
  recordException() {},
  setAttribute() {},
  setStatus() {},
};

const noopTracer: MiniTracer = {
  startSpan() {
    return noopSpan;
  },
};

const noopCounter: MiniCounter = {
  add() {},
};

const noopHistogram: MiniHistogram = {
  record() {},
};

const noopUpDownCounter: MiniUpDownCounter = {
  add() {},
};

const noopMeter: MiniMeter = {
  createCounter() {
    return noopCounter;
  },
  createHistogram() {
    return noopHistogram;
  },
  createUpDownCounter() {
    return noopUpDownCounter;
  },
};

const noopLogger: MiniLogger = {
  emit() {},
};

// ── 状态 ─────────────────────────────────────────────────────────

let initialized = false;
let realTracer: MiniTracer | null = null;
let realMeter: MiniMeter | null = null;
let realLogger: MiniLogger | null = null;
let shutdownFn: (() => Promise<void>) | null = null;
let businessInstrumentMeter: MiniMeter | null = null;
let businessInstruments: BusinessTelemetryInstruments | null = null;

const DEFAULT_TELEMETRY_CONFIG: TelemetryConfig = {
  enabled: false,
  exporterType: "none",
  sampleRate: 1,
  serviceName: "crab-cli",
};

// ── 公共 API ─────────────────────────────────────────────────────

/**
 * 初始化遥测。幂等调用——重复调用会跳过。
 * 仅在 enabled=true 且 exporterType!="none" 时真正初始化。
 */
export async function initTelemetry(config?: Partial<AppConfigSchema["telemetry"]>): Promise<void> {
  if (initialized) {
    return;
  }
  initialized = true;

  const cfg: TelemetryConfig = {
    ...DEFAULT_TELEMETRY_CONFIG,
    ...config,
  };

  if (!cfg.enabled || cfg.exporterType === "none") {
    log.debug("遥测已禁用，使用 noop tracer");
    return;
  }

  if (cfg.exporterType === "prometheus") {
    enablePrometheusMetrics(cfg.serviceName);
    realMeter = createPrometheusMeter();
    realLogger = noopLogger;
    shutdownFn = async () => {};
    log.info(`Prometheus exporter 已启用: service=${cfg.serviceName}`);
    return;
  }

  try {
    await initReal(cfg);
    log.info(`遥测已初始化: exporter=${cfg.exporterType}, service=${cfg.serviceName}`);
  } catch (error) {
    log.warn(`遥测初始化失败，降级为 noop: ${error instanceof Error ? error.message : String(error)}`);
    realTracer = null;
    shutdownFn = null;
  }
}

/**
 * 优雅关闭遥测(flush + shutdown)。
 */
export async function shutdownTelemetry(): Promise<void> {
  if (shutdownFn) {
    try {
      await shutdownFn();
      log.debug("遥测已关闭");
    } catch (error) {
      log.warn(`遥测关闭失败: ${error instanceof Error ? error.message : String(error)}`);
    }
    shutdownFn = null;
  }
  realTracer = null;
  realMeter = null;
  realLogger = null;
  disablePrometheusMetrics();
  businessInstrumentMeter = null;
  businessInstruments = null;
  initialized = false;
}

/**
 * 获取 Tracer 实例。未初始化时返回 noop tracer。
 */
export function getTracer(_name?: string): MiniTracer {
  if (realTracer) {
    return realTracer;
  }
  return noopTracer;
}

/**
 * 获取 Meter 实例。未初始化时返回 noop meter。
 */
export function getMeter(_name?: string): MiniMeter {
  if (realMeter) {
    return realMeter;
  }
  return noopMeter;
}

/**
 * 获取 Logger 实例。未初始化时返回 noop logger。
 */
export function getLogger(_name?: string): MiniLogger {
  if (realLogger) {
    return realLogger;
  }
  return noopLogger;
}

interface BusinessTelemetryInstruments {
  chatRequests: MiniCounter;
  chatTokens: MiniCounter;
  chatDuration: MiniHistogram;
  toolCalls: MiniCounter;
  toolDuration: MiniHistogram;
  cacheTokens: MiniCounter;
  searchQueries: MiniCounter;
  searchResults: MiniCounter;
  searchDuration: MiniHistogram;
  compressionRuns: MiniCounter;
  compressionTokens: MiniCounter;
  compressionDuration: MiniHistogram;
}

/**
 * 记录 LLM 请求业务指标和结构化日志。
 */
export function recordChatBusinessTelemetry(event: ChatBusinessTelemetry): void {
  const instruments = getBusinessInstruments();
  const attrs = compactMetricAttributes({
    exit_reason: event.exitReason,
    "gen_ai.request.model": event.model,
    "gen_ai.system": event.provider,
    model: event.model,
    provider: event.provider,
    round: event.round,
    status: event.status,
  });

  instruments.chatRequests.add(1, attrs);
  if (event.durationMs !== undefined) {
    instruments.chatDuration.record(Math.max(0, event.durationMs), attrs);
  }

  const { usage } = event;
  if (usage) {
    addTokenMetric(instruments.chatTokens, "input", usage.inputTokens, attrs);
    addTokenMetric(instruments.chatTokens, "output", usage.outputTokens, attrs);
    addTokenMetric(instruments.cacheTokens, "creation_input", usage.cacheCreationInputTokens, attrs);
    addTokenMetric(instruments.cacheTokens, "read_input", usage.cacheReadInputTokens, attrs);
    addTokenMetric(instruments.cacheTokens, "cached", usage.cachedTokens, attrs);
  }

  getLogger("business").emit({
    attributes: {
      ...attrs,
      cache_creation_input_tokens: usage?.cacheCreationInputTokens,
      cache_read_input_tokens: usage?.cacheReadInputTokens,
      cached_tokens: usage?.cachedTokens,
      duration_ms: event.durationMs,
      input_tokens: usage?.inputTokens,
      output_tokens: usage?.outputTokens,
    },
    body: "chat.request",
    severityNumber: event.status === "error" ? 17 : 9,
    severityText: event.status === "error" ? "ERROR" : "INFO",
  });
}

/**
 * 记录工具执行业务指标和结构化日志。
 */
export function recordToolBusinessTelemetry(event: ToolBusinessTelemetry): void {
  const instruments = getBusinessInstruments();
  const attrs = compactMetricAttributes({
    exit_reason: event.exitReason,
    sensitive: event.sensitive ?? false,
    status: event.success ? "success" : "error",
    tool_name: event.toolName,
  });

  instruments.toolCalls.add(1, attrs);
  if (event.durationMs !== undefined) {
    instruments.toolDuration.record(Math.max(0, event.durationMs), attrs);
  }

  getLogger("business").emit({
    attributes: {
      ...attrs,
      duration_ms: event.durationMs,
      error: event.error,
    },
    body: "tool.call",
    severityNumber: event.success ? 9 : 17,
    severityText: event.success ? "INFO" : "ERROR",
  });
}

/**
 * 记录搜索业务指标和结构化日志。不记录完整 query/path，避免高基数和隐私泄露。
 */
export function recordSearchBusinessTelemetry(event: SearchBusinessTelemetry): void {
  const instruments = getBusinessInstruments();
  const attrs = compactMetricAttributes({
    agent_review_enabled: event.agentReviewEnabled ?? false,
    cached: event.cached ?? false,
    exit_reason: event.exitReason,
    mode: event.mode,
    status: event.status,
  });

  instruments.searchQueries.add(1, attrs);
  if (event.total !== undefined && event.total > 0) {
    instruments.searchResults.add(event.total, attrs);
  }
  if (event.durationMs !== undefined) {
    instruments.searchDuration.record(Math.max(0, event.durationMs), attrs);
  }

  getLogger("business").emit({
    attributes: {
      ...attrs,
      duration_ms: event.durationMs,
      error: event.error,
      total: event.total,
    },
    body: "search.query",
    severityNumber: event.status === "error" ? 17 : 9,
    severityText: event.status === "error" ? "ERROR" : "INFO",
  });
}

/**
 * 记录压缩业务指标和结构化日志。不记录摘要正文或会话消息内容。
 */
export function recordCompressionBusinessTelemetry(event: CompressionBusinessTelemetry): void {
  const instruments = getBusinessInstruments();
  const attrs = compactMetricAttributes({
    exit_reason: event.exitReason,
    mode: event.mode,
    status: event.status,
  });

  instruments.compressionRuns.add(1, attrs);
  if (event.tokensBefore !== undefined && event.tokensBefore > 0) {
    instruments.compressionTokens.add(event.tokensBefore, { ...attrs, token_type: "before" });
  }
  if (event.tokensAfter !== undefined && event.tokensAfter > 0) {
    instruments.compressionTokens.add(event.tokensAfter, { ...attrs, token_type: "after" });
  }
  if (event.durationMs !== undefined) {
    instruments.compressionDuration.record(Math.max(0, event.durationMs), attrs);
  }

  getLogger("business").emit({
    attributes: {
      ...attrs,
      duration_ms: event.durationMs,
      error: event.error,
      message_count: event.messageCount,
      tokens_after: event.tokensAfter,
      tokens_before: event.tokensBefore,
    },
    body: "compression.run",
    severityNumber: event.status === "error" ? 17 : 9,
    severityText: event.status === "error" ? "ERROR" : "INFO",
  });
}

/**
 * 测试专用:注入 fake meter/logger 来断言业务埋点，不影响真实初始化路径。
 */
export function _setTelemetryForTesting(values: { meter?: MiniMeter | null; logger?: MiniLogger | null }): void {
  if ("meter" in values) {
    realMeter = values.meter ?? null;
  }
  if ("logger" in values) {
    realLogger = values.logger ?? null;
  }
  disablePrometheusMetrics();
  businessInstrumentMeter = null;
  businessInstruments = null;
}

/**
 * 便捷函数:创建 span → 执行 fn → 自动 end / recordException。
 */
export async function withSpan<T>(
  name: string,
  attrs: SpanAttributes,
  fn: (span: MiniSpan) => T | Promise<T>,
): Promise<T> {
  const tracer = getTracer();
  const span = tracer.startSpan(name, { attributes: attrs });
  try {
    const result = await fn(span);
    span.setStatus({ code: 0 });
    span.end();
    return result;
  } catch (error) {
    span.recordException(error);
    span.setStatus({ code: 2, message: error instanceof Error ? error.message : String(error) });
    span.end();
    throw error;
  }
}

function getBusinessInstruments(): BusinessTelemetryInstruments {
  const meter = getMeter("business");
  if (businessInstruments && businessInstrumentMeter === meter) {
    return businessInstruments;
  }

  businessInstrumentMeter = meter;
  businessInstruments = {
    cacheTokens: meter.createCounter("cache.tokens", {
      description: "Prompt cache token usage grouped by cache token type",
      unit: "tokens",
    }),
    chatDuration: meter.createHistogram("chat.duration_ms", {
      description: "LLM request duration",
      unit: "ms",
    }),
    chatRequests: meter.createCounter("chat.requests", {
      description: "LLM request count grouped by provider/model/status",
      unit: "1",
    }),
    chatTokens: meter.createCounter("chat.tokens", {
      description: "LLM token usage grouped by token type",
      unit: "tokens",
    }),
    compressionDuration: meter.createHistogram("compression.duration_ms", {
      description: "Conversation compression duration",
      unit: "ms",
    }),
    compressionRuns: meter.createCounter("compression.runs", {
      description: "Conversation compression run count grouped by mode/status",
      unit: "1",
    }),
    compressionTokens: meter.createCounter("compression.tokens", {
      description: "Conversation compression token estimates before/after compression",
      unit: "tokens",
    }),
    searchDuration: meter.createHistogram("search.duration_ms", {
      description: "Codebase search duration",
      unit: "ms",
    }),
    searchQueries: meter.createCounter("search.queries", {
      description: "Codebase search request count grouped by mode/status",
      unit: "1",
    }),
    searchResults: meter.createCounter("search.results", {
      description: "Codebase search result count grouped by mode/status",
      unit: "1",
    }),
    toolCalls: meter.createCounter("tool.calls", {
      description: "Tool call count grouped by tool/status/exit reason",
      unit: "1",
    }),
    toolDuration: meter.createHistogram("tool.duration_ms", {
      description: "Tool call duration",
      unit: "ms",
    }),
  };
  return businessInstruments;
}

function addTokenMetric(
  counter: MiniCounter,
  tokenType: string,
  value: number | undefined,
  attrs: MetricAttributes,
): void {
  if (value === undefined || value <= 0) {
    return;
  }
  counter.add(value, { ...attrs, token_type: tokenType });
}

function compactMetricAttributes(attrs: Record<string, string | number | boolean | undefined>): MetricAttributes {
  const result: MetricAttributes = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== "") {
      result[key] = value;
    }
  }
  return result;
}

// ── 内部:动态加载 OTEL SDK ──────────────────────────────────────

async function initReal(cfg: TelemetryConfig): Promise<void> {
  // 动态 import 避免未安装 OTEL 时编译报错
  const { trace, metrics, SpanStatusCode } = await import("@opentelemetry/api");
  const { logs, SeverityNumber } = await import("@opentelemetry/api-logs");
  const { NodeTracerProvider } = await import("@opentelemetry/sdk-trace-node");
  const { SimpleSpanProcessor, ConsoleSpanExporter, TraceIdRatioBasedSampler } =
    await import("@opentelemetry/sdk-trace-base");
  const { resourceFromAttributes } = await import("@opentelemetry/resources");
  const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = await import("@opentelemetry/semantic-conventions");

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: cfg.serviceName,
    [ATTR_SERVICE_VERSION]: "0.5.0",
    "process.pid": process.pid,
  });

  // ── Traces 初始化 ──
  const spanProcessors: InstanceType<typeof SimpleSpanProcessor>[] = [];
  if (cfg.exporterType === "console") {
    spanProcessors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
  } else if (cfg.exporterType === "otlp") {
    const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
    const exporter = new OTLPTraceExporter({
      url: cfg.endpoint ?? "http://localhost:4318/v1/traces",
    });
    spanProcessors.push(new SimpleSpanProcessor(exporter));
  }

  const tracerProvider = new NodeTracerProvider({
    resource,
    sampler: cfg.sampleRate < 1 ? new TraceIdRatioBasedSampler(cfg.sampleRate) : undefined,
    spanProcessors,
  });

  tracerProvider.register();

  const otelTracer = trace.getTracer(cfg.serviceName, "0.5.0");

  // 适配到 MiniTracer 接口
  realTracer = {
    startSpan(name, options) {
      const span = otelTracer.startSpan(name, {
        attributes: filterUndefined(options?.attributes),
      });
      return {
        end() {
          span.end();
        },
        recordException(error) {
          span.recordException(error instanceof Error ? error : new Error(String(error)));
        },
        setAttribute(key, value) {
          span.setAttribute(key, value);
        },
        setStatus(status) {
          span.setStatus({
            code: status.code === 2 ? SpanStatusCode.ERROR : SpanStatusCode.OK,
            message: status.message,
          });
        },
      };
    },
  };

  // ── Metrics 初始化 ──
  const { MeterProvider, PeriodicExportingMetricReader, ConsoleMetricExporter } =
    await import("@opentelemetry/sdk-metrics");

  let metricReader: InstanceType<typeof PeriodicExportingMetricReader>;
  if (cfg.exporterType === "console") {
    metricReader = new PeriodicExportingMetricReader({
      exportIntervalMillis: 60_000, // 1分钟
      exporter: new ConsoleMetricExporter(),
    });
  } else if (cfg.exporterType === "otlp") {
    const { OTLPMetricExporter } = await import("@opentelemetry/exporter-metrics-otlp-http");
    metricReader = new PeriodicExportingMetricReader({
      exportIntervalMillis: 60_000,
      exporter: new OTLPMetricExporter({
        url: cfg.endpoint ?? "http://localhost:4318/v1/metrics",
      }),
    });
  } else {
    // None - 创建 noop reader(不导出)
    metricReader = new PeriodicExportingMetricReader({
      exportIntervalMillis: 3_600_000, // 1小时(实际不会导出)
      exporter: new ConsoleMetricExporter(),
    });
  }

  const meterProvider = new MeterProvider({
    readers: [metricReader],
    resource,
  });

  metrics.setGlobalMeterProvider(meterProvider);
  const otelMeter = metrics.getMeter(cfg.serviceName, "0.5.0");

  realMeter = {
    createCounter(name, options) {
      return otelMeter.createCounter(name, options);
    },
    createHistogram(name, options) {
      return otelMeter.createHistogram(name, options);
    },
    createUpDownCounter(name, options) {
      return otelMeter.createUpDownCounter(name, options);
    },
  };

  // ── Logs 初始化 ──
  const { LoggerProvider, BatchLogRecordProcessor, ConsoleLogRecordExporter } = await import("@opentelemetry/sdk-logs");

  let logProcessor: InstanceType<typeof BatchLogRecordProcessor>;
  if (cfg.exporterType === "console") {
    logProcessor = new BatchLogRecordProcessor(new ConsoleLogRecordExporter());
  } else if (cfg.exporterType === "otlp") {
    const { OTLPLogExporter } = await import("@opentelemetry/exporter-logs-otlp-http");
    logProcessor = new BatchLogRecordProcessor(
      new OTLPLogExporter({
        url: cfg.endpoint ?? "http://localhost:4318/v1/logs",
      }),
    );
  } else {
    // None - 创建 noop processor
    logProcessor = new BatchLogRecordProcessor(new ConsoleLogRecordExporter());
  }

  const loggerProvider = new LoggerProvider({
    processors: [logProcessor],
    resource,
  });

  logs.setGlobalLoggerProvider(loggerProvider);
  const otelLogger = logs.getLogger(cfg.serviceName, "0.5.0");

  realLogger = {
    emit(logRecord) {
      otelLogger.emit({
        attributes: filterLogAttributes(logRecord.attributes),
        body: logRecord.body,
        severityNumber: logRecord.severityNumber ?? SeverityNumber.INFO,
        severityText: logRecord.severityText,
      });
    },
  };

  // ── Shutdown 函数(包含三支柱) ──
  shutdownFn = async () => {
    await tracerProvider.forceFlush();
    await meterProvider.forceFlush();
    await loggerProvider.forceFlush();
    await tracerProvider.shutdown();
    await meterProvider.shutdown();
    await loggerProvider.shutdown();
  };
}

function filterUndefined(attrs?: SpanAttributes): Record<string, string | number | boolean> | undefined {
  if (!attrs) {
    return undefined;
  }
  const result: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined) {
      result[k] = v;
    }
  }
  return result;
}

/** 过滤日志属性中的非基本类型值，确保 OTEL Logger 接受 */
function filterLogAttributes(attrs?: LogAttributes): Record<string, string | number | boolean> {
  if (!attrs) {
    return {};
  }
  const result: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== null && (typeof v === "string" || typeof v === "number" || typeof v === "boolean")) {
      result[k] = v;
    }
  }
  return result;
}
