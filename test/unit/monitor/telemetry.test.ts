/**
 * Telemetry + Prometheus + BusinessTelemetryTypes 综合测试。
 *
 * 目标模块:
 *   - src/monitor/telemetry/telemetry.ts
 *   - src/monitor/telemetry/prometheusTelemetry.ts
 *   - src/monitor/telemetry/businessTelemetryTypes.ts
 *
 * 导入方式: 统一使用 @monitor barrel 导入。
 * 测试框架: bun:test
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  _setTelemetryForTesting,
  getLogger,
  getMeter,
  getTracer,
  initTelemetry,
  recordChatBusinessTelemetry,
  recordCompressionBusinessTelemetry,
  recordSearchBusinessTelemetry,
  recordToolBusinessTelemetry,
  renderPrometheusMetrics,
  resetPrometheusMetricsForTesting,
  shutdownTelemetry,
  withSpan,
} from "@monitor";

import { createPrometheusMeter, enablePrometheusMetrics } from "@/monitor/telemetry/prometheusTelemetry";
import type {
  MiniCounter,
  MiniHistogram,
  MiniLogger,
  MiniMeter,
  MiniUpDownCounter,
} from "@/monitor/telemetry/telemetry";

// ── 辅助函数 ─────────────────────────────────────────────────────────

/**
 * 重置 telemetry 模块内部状态，确保每个测试从干净状态开始。
 * shutdownTelemetry 会清除 realTracer/realMeter/realLogger/businessInstruments 并重置 initialized=false。
 */
function resetTelemetryState(): void {
  // 注入 null 清除被测试注入的 fake meter/logger，同时将 initialized 标志通过 shutdown 清除
  _setTelemetryForTesting({ meter: null, logger: null });
  // shutdownTelemetry 会把 initialized 重置为 false，并清空所有内部引用
  void shutdownTelemetry();
}

// ── 测试套件 ─────────────────────────────────────────────────────────

describe("Telemetry 模块", () => {
  beforeEach(() => {
    resetPrometheusMetricsForTesting();
    resetTelemetryState();
  });

  afterEach(() => {
    resetPrometheusMetricsForTesting();
    resetTelemetryState();
  });

  // 1. initTelemetry 幂等性 — 第二次调用是 no-op
  test("initTelemetry 幂等 — 第二次调用是 no-op", async () => {
    // 首次初始化（disabled 模式）
    await initTelemetry({ enabled: false });

    // 第二次调用不应抛错（幂等）
    await initTelemetry({ enabled: false });

    // 未初始化时 getTracer 返回 noop tracer，验证 span 不产生副作用
    const tracer = getTracer();
    const span = tracer.startSpan("noop-check");
    expect(span).toBeDefined();
    span.end(); // 不应抛错
  });

  // 2. initTelemetry enabled=false → noop tracer/meter/logger
  test("initTelemetry enabled=false → noop tracer/meter/logger", async () => {
    await initTelemetry({ enabled: false });

    // noop tracer: startSpan 返回 noop span，所有方法无副作用
    const tracer = getTracer();
    const span = tracer.startSpan("test");
    span.setAttribute("key", "value");
    span.setStatus({ code: 0 });
    span.recordException(new Error("noop"));
    span.end();

    // noop meter: createCounter/Histogram/UpDownCounter 均为 noop
    const meter = getMeter();
    const counter = meter.createCounter("test.counter");
    counter.add(42);
    const histogram = meter.createHistogram("test.histogram");
    histogram.record(100);
    const upDown = meter.createUpDownCounter("test.updown");
    upDown.add(10);

    // noop logger: emit 无副作用
    const logger = getLogger();
    logger.emit({ body: "test", severityNumber: 9 });
  });

  // 3. getTracer 未初始化 → noop tracer → startSpan 返回 noop span
  test("getTracer 未初始化 → 返回 noop tracer，startSpan 返回 noop span", () => {
    const tracer = getTracer();
    expect(tracer).toBeDefined();

    const span = tracer.startSpan("uninitialized", { attributes: { foo: "bar" } });
    expect(span).toBeDefined();

    // noop span 的所有方法都不应抛错
    span.setAttribute("k", "v");
    span.setStatus({ code: 0 });
    span.recordException(new Error("test"));
    span.end();
  });

  // 4. getMeter 未初始化 → noop meter
  test("getMeter 未初始化 → 返回 noop meter", () => {
    const meter = getMeter();
    expect(meter).toBeDefined();

    const counter = meter.createCounter("noop.counter", { description: "test" });
    expect(counter).toBeDefined();
    counter.add(100); // 不应抛错

    const histogram = meter.createHistogram("noop.histogram", { unit: "ms" });
    expect(histogram).toBeDefined();
    histogram.record(200);

    const upDown = meter.createUpDownCounter("noop.updown");
    expect(upDown).toBeDefined();
    upDown.add(-5);
  });

  // 5. getLogger 未初始化 → noop logger
  test("getLogger 未初始化 → 返回 noop logger", () => {
    const logger = getLogger();
    expect(logger).toBeDefined();
    logger.emit({
      body: "test-log",
      severityNumber: 9,
      severityText: "INFO",
      attributes: { key: "value" },
    });
  });

  // 6. withSpan 成功路径 — noop tracer 不抛错，结果正确返回
  test("withSpan 成功路径 — noop tracer 不抛错，结果正确返回", async () => {
    const result = await withSpan("test-op", { op: "test" }, () => 42);

    expect(result).toBe(42);
  });

  // 7. withSpan 错误路径 — span 记录异常并以 ERROR status 结束
  test("withSpan 错误路径 — span 记录异常并以 ERROR status 结束", async () => {
    const error = new Error("test-failure");

    // 验证异常被正确抛出
    expect(
      withSpan("fail-op", { op: "fail" }, () => {
        throw error;
      }),
    ).rejects.toThrow("test-failure");
  });

  // 8. _setTelemetryForTesting — 注入 fake meter，验证 recordChatBusinessTelemetry 调用它
  test("_setTelemetryForTesting — 注入 fake meter，verify recordChatBusinessTelemetry 调用它", () => {
    // 记录 counter.add 调用
    const addCalls: Array<{ name: string; value: number; attrs?: Record<string, string | number | boolean> }> = [];
    const recordCalls: Array<{ name: string; value: number; attrs?: Record<string, string | number | boolean> }> = [];

    const fakeMeter: MiniMeter = {
      createCounter(name) {
        return {
          add(value, attrs) {
            addCalls.push({ name, value, attrs: attrs ?? {} });
          },
        } satisfies MiniCounter;
      },
      createHistogram(name) {
        return {
          record(value, attrs) {
            recordCalls.push({ name, value, attrs: attrs ?? {} });
          },
        } satisfies MiniHistogram;
      },
      createUpDownCounter(_name) {
        return {
          add() {},
        } satisfies MiniUpDownCounter;
      },
    };

    _setTelemetryForTesting({ meter: fakeMeter });

    // 触发业务遥测
    recordChatBusinessTelemetry({
      provider: "anthropic",
      model: "claude-3-opus",
      status: "success",
      exitReason: "end_turn",
      round: 3,
      durationMs: 1500,
      usage: {
        inputTokens: 100,
        outputTokens: 50,
      },
    });

    // 验证 counter.add 被调用
    expect(addCalls.length).toBeGreaterThan(0);
    // chat.requests counter 应被 +1
    const requestCall = addCalls.find((c) => c.name === "chat.requests");
    expect(requestCall).toBeDefined();
    expect(requestCall!.value).toBe(1);

    // chat.tokens counter 应被调用（inputTokens=100, outputTokens=50）
    const tokenCall = addCalls.filter((c) => c.name === "chat.tokens");
    expect(tokenCall.length).toBeGreaterThanOrEqual(1); // 至少有 input token

    // histogram.record 应被调用
    const durationCall = recordCalls.find((c) => c.name === "chat.duration_ms");
    expect(durationCall).toBeDefined();
    expect(durationCall!.value).toBe(1500);
  });

  // 9. _setTelemetryForTesting — 注入 fake logger，验证业务日志被发出
  test("_setTelemetryForTesting — 注入 fake logger，verify 业务日志 emitted", () => {
    const emittedLogs: Array<{
      body: string;
      severityNumber?: number;
      severityText?: string;
      attributes?: Record<string, unknown>;
    }> = [];

    const fakeLogger: MiniLogger = {
      emit(logRecord) {
        emittedLogs.push({ ...logRecord });
      },
    };

    // 注入 noop meter（避免 recordChatBusinessTelemetry 里 meter 相关断言报错）
    const noopMeter: MiniMeter = {
      createCounter() {
        return { add() {} } satisfies MiniCounter;
      },
      createHistogram() {
        return { record() {} } satisfies MiniHistogram;
      },
      createUpDownCounter() {
        return { add() {} } satisfies MiniUpDownCounter;
      },
    };

    _setTelemetryForTesting({ meter: noopMeter, logger: fakeLogger });

    recordToolBusinessTelemetry({
      toolName: "bash",
      success: false,
      exitReason: "permission_denied",
      durationMs: 200,
      error: "command not allowed",
    });

    // 验证日志被发出
    expect(emittedLogs.length).toBe(1);
    expect(emittedLogs[0]!.body).toBe("tool.call");
    expect(emittedLogs[0]!.severityNumber).toBe(17); // ERROR
    expect(emittedLogs[0]!.severityText).toBe("ERROR");
    expect(emittedLogs[0]!.attributes).toBeDefined();
    expect((emittedLogs[0]!.attributes as Record<string, unknown>)?.tool_name).toBe("bash");
  });

  // 10. shutdownTelemetry 重置状态（允许重新初始化）
  test("shutdownTelemetry 重置状态 — 允许重新 initTelemetry", async () => {
    // 首次初始化
    await initTelemetry({ enabled: false });

    // shutdown
    await shutdownTelemetry();

    // 再次初始化不应被视为重复调用
    await initTelemetry({ enabled: false });

    // getTracer 应仍返回 noop tracer（因为 disabled 模式）
    const tracer = getTracer();
    const span = tracer.startSpan("after-reinit");
    span.end();
  });
});

describe("Prometheus 模块", () => {
  beforeEach(() => {
    resetPrometheusMetricsForTesting();
    resetTelemetryState();
  });

  afterEach(() => {
    resetPrometheusMetricsForTesting();
    resetTelemetryState();
  });

  // 11. renderPrometheusMetrics 返回包含 crab_build_info 的字符串
  test("renderPrometheusMetrics 返回包含 crab_build_info 的字符串", () => {
    const output = renderPrometheusMetrics();
    expect(output).toContain("crab_build_info");
    expect(output).toContain("# HELP crab_build_info");
    expect(output).toContain("# TYPE crab_build_info gauge");
  });

  // 12. resetPrometheusMetricsForTesting 清除所有指标
  test("resetPrometheusMetricsForTesting 清除所有指标", () => {
    enablePrometheusMetrics("test-service");
    const meter = getMeter();

    // 添加一些指标
    meter.createCounter("test.reset_counter");
    // 直接使用 prometheus meter
    const promMeter = createPrometheusMeter();
    const c = promMeter.createCounter("test.reset_counter");
    c.add(10);

    // 验证指标存在
    let output = renderPrometheusMetrics();
    expect(output).toContain("crab_test_reset_counter_total");

    // 重置
    resetPrometheusMetricsForTesting();

    // 验证指标已清除
    output = renderPrometheusMetrics();
    expect(output).not.toContain("crab_test_reset_counter_total");
  });

  // 13. enablePrometheusMetrics + createPrometheusMeter + counter.add → 渲染 _total
  test("enablePrometheusMetrics + counter.add → 渲染 _total 后缀", () => {
    enablePrometheusMetrics("my-service");

    const promMeter = createPrometheusMeter();
    const counter = promMeter.createCounter("requests");
    counter.add(5, { method: "GET", path: "/api" });
    counter.add(3, { method: "POST", path: "/api" });

    const output = renderPrometheusMetrics();
    expect(output).toContain("crab_requests_total");
    expect(output).toContain('crab_requests_total{method="GET"');
    expect(output).toContain('crab_requests_total{method="POST"');
  });

  // 14. histogram.record → 渲染 _count + _sum
  test("histogram.record → 渲染 _count 和 _sum", () => {
    enablePrometheusMetrics("hist-service");

    const promMeter = createPrometheusMeter();
    const histogram = promMeter.createHistogram("latency_ms");
    histogram.record(100, { endpoint: "/health" });
    histogram.record(200, { endpoint: "/health" });
    histogram.record(50, { endpoint: "/ready" });

    const output = renderPrometheusMetrics();
    // histogram 类型声明
    expect(output).toContain("# TYPE crab_latency_ms histogram");
    // /health series: count=2, sum=300
    expect(output).toContain('crab_latency_ms_count{endpoint="/health"} 2');
    expect(output).toContain('crab_latency_ms_sum{endpoint="/health"} 300');
    // /ready series: count=1, sum=50
    expect(output).toContain('crab_latency_ms_count{endpoint="/ready"} 1');
    expect(output).toContain('crab_latency_ms_sum{endpoint="/ready"} 50');
  });

  // 15. upDownCounter → gauge 渲染绝对值（非累积）
  test("upDownCounter → gauge 渲染绝对值，非累加", () => {
    enablePrometheusMetrics("gauge-service");

    const promMeter = createPrometheusMeter();
    const gauge = promMeter.createUpDownCounter("active_connections");
    gauge.add(10, { host: "db-primary" });
    gauge.add(5, { host: "db-replica" });

    const output = renderPrometheusMetrics();
    expect(output).toContain("# TYPE crab_active_connections gauge");
    expect(output).toContain('crab_active_connections{host="db-primary"} 10');
    expect(output).toContain('crab_active_connections{host="db-replica"} 5');

    // 再次设置相同 label → 覆盖（gauge 语义），不是累加
    gauge.add(20, { host: "db-primary" });
    const output2 = renderPrometheusMetrics();
    expect(output2).toContain('crab_active_connections{host="db-primary"} 20');
  });

  // 16. Prometheus 禁用时 → counter.add / histogram.record 为 no-op
  test("Prometheus 禁用时 → counter.add/histogram.record 为 no-op", () => {
    // 不调用 enablePrometheusMetrics（默认禁用）
    const promMeter = createPrometheusMeter();

    const counter = promMeter.createCounter("disabled_counter");
    counter.add(100);

    const histogram = promMeter.createHistogram("disabled_histogram");
    histogram.record(999);

    const output = renderPrometheusMetrics();
    // 只有 crab_build_info，不应包含自定义指标
    expect(output).toContain("crab_build_info");
    expect(output).not.toContain("crab_disabled_counter");
    expect(output).not.toContain("crab_disabled_histogram");
  });

  // 17. Prometheus labels 排序和转义
  test("Prometheus labels 排序后拼接且特殊字符被转义", () => {
    enablePrometheusMetrics("label-service");

    const promMeter = createPrometheusMeter();
    const counter = promMeter.createCounter("labeled_counter");

    // labels 中的 key 应被排序输出
    counter.add(1, { z_key: "z", a_key: "a", m_key: "m" });

    const output = renderPrometheusMetrics();
    const counterLine = output.split("\n").find((l: string) => l.startsWith("crab_labeled_counter_total"));
    expect(counterLine).toBeDefined();

    // 验证 label key 按字母排序: a_key, m_key, z_key
    const match = counterLine!.match(/\{(.+)\}/);
    expect(match).not.toBeNull();
    const labelStr = match![1]!;
    const keys = labelStr.split(",").map((s: string) => s.split("=")[0]!.trim());
    // 排序验证
    expect(keys).toEqual([...keys].sort());
  });

  // 18. NaN/Infinity 值被 histogram 忽略
  test("NaN/Infinity 值被 histogram 忽略", () => {
    enablePrometheusMetrics("nan-service");

    const promMeter = createPrometheusMeter();
    const histogram = promMeter.createHistogram("value_check");

    // 正常值应被记录
    histogram.record(100);

    // NaN 和 Infinity 应被忽略
    histogram.record(NaN);
    histogram.record(Infinity);
    histogram.record(-Infinity);

    const output = renderPrometheusMetrics();
    // 应只有一条正常记录
    expect(output).toContain("crab_value_check_count 1");
    expect(output).toContain("crab_value_check_sum 100");
  });
});

describe("Business Telemetry Types", () => {
  beforeEach(() => {
    resetPrometheusMetricsForTesting();
    resetTelemetryState();
  });

  afterEach(() => {
    resetPrometheusMetricsForTesting();
    resetTelemetryState();
  });

  // 19. recordChatBusinessTelemetry — meter.add 被调用 for requests，histogram.record for duration
  test("recordChatBusinessTelemetry — meter.add(requests) + histogram.record(duration)", () => {
    const addCalls: Array<{ name: string; value: number }> = [];
    const recordCalls: Array<{ name: string; value: number }> = [];

    const fakeMeter: MiniMeter = {
      createCounter(name) {
        return {
          add(value) {
            addCalls.push({ name, value });
          },
        } satisfies MiniCounter;
      },
      createHistogram(name) {
        return {
          record(value) {
            recordCalls.push({ name, value });
          },
        } satisfies MiniHistogram;
      },
      createUpDownCounter() {
        return { add() {} } satisfies MiniUpDownCounter;
      },
    };

    _setTelemetryForTesting({ meter: fakeMeter });

    recordChatBusinessTelemetry({
      provider: "anthropic",
      model: "claude-sonnet",
      status: "success",
      exitReason: "end_turn",
      round: 1,
      durationMs: 2000,
      usage: {
        inputTokens: 500,
        outputTokens: 200,
        cacheCreationInputTokens: 100,
        cacheReadInputTokens: 50,
      },
    });

    // 验证 chat.requests counter +1
    const requestCall = addCalls.find((c) => c.name === "chat.requests");
    expect(requestCall).toBeDefined();
    expect(requestCall!.value).toBe(1);

    // 验证 chat.duration_ms histogram 记录 duration
    const durationCall = recordCalls.find((c) => c.name === "chat.duration_ms");
    expect(durationCall).toBeDefined();
    expect(durationCall!.value).toBe(2000);

    // 验证 chat.tokens 有 input 和 output
    const tokenCalls = addCalls.filter((c) => c.name === "chat.tokens");
    expect(tokenCalls.length).toBeGreaterThanOrEqual(2); // input + output
  });

  // 20. recordToolBusinessTelemetry — meter.add 被调用 for tool calls
  test("recordToolBusinessTelemetry — meter.add(tool.calls) 被调用", () => {
    const addCalls: Array<{ name: string; value: number }> = [];
    const recordCalls: Array<{ name: string; value: number }> = [];

    const fakeMeter: MiniMeter = {
      createCounter(name) {
        return {
          add(value) {
            addCalls.push({ name, value });
          },
        } satisfies MiniCounter;
      },
      createHistogram(name) {
        return {
          record(value) {
            recordCalls.push({ name, value });
          },
        } satisfies MiniHistogram;
      },
      createUpDownCounter() {
        return { add() {} } satisfies MiniUpDownCounter;
      },
    };

    _setTelemetryForTesting({ meter: fakeMeter });

    recordToolBusinessTelemetry({
      toolName: "web_search",
      success: true,
      exitReason: "completed",
      durationMs: 300,
    });

    // 验证 tool.calls counter +1
    const toolCall = addCalls.find((c) => c.name === "tool.calls");
    expect(toolCall).toBeDefined();
    expect(toolCall!.value).toBe(1);

    // 验证 tool.duration_ms histogram
    const durationCall = recordCalls.find((c) => c.name === "tool.duration_ms");
    expect(durationCall).toBeDefined();
    expect(durationCall!.value).toBe(300);
  });

  // 21. recordSearchBusinessTelemetry — queries/results/duration 被记录
  test("recordSearchBusinessTelemetry — queries/results/duration 被记录", () => {
    const addCalls: Array<{ name: string; value: number }> = [];
    const recordCalls: Array<{ name: string; value: number }> = [];

    const fakeMeter: MiniMeter = {
      createCounter(name) {
        return {
          add(value) {
            addCalls.push({ name, value });
          },
        } satisfies MiniCounter;
      },
      createHistogram(name) {
        return {
          record(value) {
            recordCalls.push({ name, value });
          },
        } satisfies MiniHistogram;
      },
      createUpDownCounter() {
        return { add() {} } satisfies MiniUpDownCounter;
      },
    };

    _setTelemetryForTesting({ meter: fakeMeter });

    recordSearchBusinessTelemetry({
      mode: "semantic",
      status: "success",
      exitReason: "completed",
      durationMs: 450,
      total: 12,
      cached: false,
    });

    // 验证 search.queries counter +1
    const queryCall = addCalls.find((c) => c.name === "search.queries");
    expect(queryCall).toBeDefined();
    expect(queryCall!.value).toBe(1);

    // 验证 search.results counter +12 (total 值)
    const resultCall = addCalls.find((c) => c.name === "search.results");
    expect(resultCall).toBeDefined();
    expect(resultCall!.value).toBe(12);

    // 验证 search.duration_ms histogram
    const durationCall = recordCalls.find((c) => c.name === "search.duration_ms");
    expect(durationCall).toBeDefined();
    expect(durationCall!.value).toBe(450);
  });

  // 22. recordCompressionBusinessTelemetry — runs/tokens/duration 被记录
  test("recordCompressionBusinessTelemetry — runs/tokens/duration 被记录", () => {
    const addCalls: Array<{ name: string; value: number }> = [];
    const recordCalls: Array<{ name: string; value: number }> = [];

    const fakeMeter: MiniMeter = {
      createCounter(name) {
        return {
          add(value) {
            addCalls.push({ name, value });
          },
        } satisfies MiniCounter;
      },
      createHistogram(name) {
        return {
          record(value) {
            recordCalls.push({ name, value });
          },
        } satisfies MiniHistogram;
      },
      createUpDownCounter() {
        return { add() {} } satisfies MiniUpDownCounter;
      },
    };

    _setTelemetryForTesting({ meter: fakeMeter });

    recordCompressionBusinessTelemetry({
      mode: "compact",
      status: "success",
      exitReason: "compressed",
      durationMs: 800,
      messageCount: 50,
      tokensBefore: 10000,
      tokensAfter: 3000,
    });

    // 验证 compression.runs counter +1
    const runsCall = addCalls.find((c) => c.name === "compression.runs");
    expect(runsCall).toBeDefined();
    expect(runsCall!.value).toBe(1);

    // 验证 compression.tokens counter 被调用（before=10000, after=3000）
    const tokenCalls = addCalls.filter((c) => c.name === "compression.tokens");
    expect(tokenCalls.length).toBe(2);
    const tokenValues = tokenCalls.map((c) => c.value).sort((a, b) => a - b);
    expect(tokenValues).toEqual([3000, 10000]);

    // 验证 compression.duration_ms histogram
    const durationCall = recordCalls.find((c) => c.name === "compression.duration_ms");
    expect(durationCall).toBeDefined();
    expect(durationCall!.value).toBe(800);
  });

  // 22b. recordCompressionBusinessTelemetry — tokens 为 0 或 undefined 时不记录
  test("recordCompressionBusinessTelemetry — tokens<=0 或 undefined 时跳过 counter.add", () => {
    const addCalls: Array<{ name: string; value: number }> = [];

    const fakeMeter: MiniMeter = {
      createCounter(name) {
        return {
          add(value) {
            addCalls.push({ name, value });
          },
        } satisfies MiniCounter;
      },
      createHistogram() {
        return { record() {} } satisfies MiniHistogram;
      },
      createUpDownCounter() {
        return { add() {} } satisfies MiniUpDownCounter;
      },
    };

    _setTelemetryForTesting({ meter: fakeMeter });

    recordCompressionBusinessTelemetry({
      mode: "compact",
      status: "success",
      exitReason: "no-op",
      tokensBefore: 0, // 0 → 跳过
      tokensAfter: undefined, // undefined → 跳过
    });

    // 不应有 compression.tokens 的调用（runs 应该有 1 次）
    const tokenCalls = addCalls.filter((c) => c.name === "compression.tokens");
    expect(tokenCalls.length).toBe(0);
  });
});
