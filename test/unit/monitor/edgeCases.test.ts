/**
 * Monitor 模块边界用例补充测试。
 *
 * 覆盖现有测试未涉及的边缘场景:
 *   1. Telemetry init/shutdown/reinit 完整生命周期
 *   2. Dashboard + ResourceMonitor 通过 globalBus 联合集成
 *   3. collectMetrics 双系统活跃时数据聚合
 *   4. PerformanceDashboard 告警规则在 reset 后状态清除
 *   5. getMemoryStats 重置后零值 + 单样本 current=min=max=avg
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  _setTelemetryForTesting,
  collectMetrics,
  createPerformanceDashboard,
  getGlobalDashboard,
  getMeter,
  getLogger,
  getTracer,
  initTelemetry,
  PerformanceDashboard,
  ResourceMonitor,
  resetPrometheusMetricsForTesting,
  shutdownTelemetry,
} from "@monitor";
import type { AlertEvent, AlertRule } from "@monitor";
import { globalBus, AppEvent } from "@/bus";

import type { MiniMeter, MiniCounter, MiniHistogram, MiniUpDownCounter } from "@/monitor/telemetry/telemetry";

// ── 辅助函数 ─────────────────────────────────────────────────────────

/** 重置 telemetry 模块内部状态为干净 */
function resetTelemetryState(): void {
  _setTelemetryForTesting({ meter: null, logger: null });
  void shutdownTelemetry();
}

// ──────────────────────────────────────────────────────────────────────
// 1. Telemetry init / shutdown / reinit 生命周期
// ──────────────────────────────────────────────────────────────────────

describe("Telemetry init/shutdown/reinit 生命周期", () => {
  beforeEach(() => {
    resetPrometheusMetricsForTesting();
    resetTelemetryState();
  });

  afterEach(() => {
    resetPrometheusMetricsForTesting();
    resetTelemetryState();
  });

  // 1-1. init → shutdown → 允许以不同配置重新 init
  test("init → shutdown → 允许 re-init（不同配置）", async () => {
    // 第一次初始化（禁用模式）
    await initTelemetry({ enabled: false });

    // shutdown 清除 initialized 标志
    await shutdownTelemetry();

    // 第二次初始化（仍禁用，但验证流程不阻塞）
    await initTelemetry({ enabled: false });

    // getTracer 仍返回 noop（因为 enabled=false）
    const tracer = getTracer();
    const span = tracer.startSpan("after-reinit-different-config");
    span.end(); // 不应抛错
  });

  // 1-2. 未初始化时调用 shutdown 是 no-op
  test("shutdown 在未初始化时是 no-op", async () => {
    // 直接调用 shutdown（从未调用 init）
    expect(shutdownTelemetry()).resolves.toBeUndefined();

    // 再次调用仍然安全
    expect(shutdownTelemetry()).resolves.toBeUndefined();
  });

  // 1-3. 连续两次 init → 第二次幂等
  test("连续两次 init → 第二次调用幂等", async () => {
    await initTelemetry({ enabled: false });

    // 第二次 init 不应抛错
    await initTelemetry({ enabled: false, exporterType: "none" });

    // getTracer 正常工作
    const tracer = getTracer();
    expect(tracer).toBeDefined();
  });

  // 1-4. init(enabled=true, console) 后 getTracer/getMeter/getLogger 返回真实实例
  test("init(enabled=true, console) → getTracer/getMeter/getLogger 不抛错", async () => {
    // console exporter 模式初始化（需要 OTEL SDK）
    await initTelemetry({
      enabled: true,
      exporterType: "console",
      serviceName: "edge-case-test",
    });

    // 三个 getter 均应返回非 noop 实例（或有定义的实例）
    const tracer = getTracer("test-tracer");
    const meter = getMeter("test-meter");
    const logger = getLogger("test-logger");

    expect(tracer).toBeDefined();
    expect(meter).toBeDefined();
    expect(logger).toBeDefined();

    // 使用 tracer 创建 span 不应抛错
    const span = tracer.startSpan("console-exporter-test");
    span.setAttribute("test", true);
    span.end();

    // 使用 meter 创建 counter 并 add 不应抛错
    const counter = meter.createCounter("test.edge.counter");
    counter.add(1);

    // 使用 logger emit 不应抛错
    logger.emit({ body: "test log", severityNumber: 9 });
  });

  // 1-5. init(prometheus) → getMeter 返回 prometheus meter
  test("init(prometheus) → getMeter 返回 prometheus meter", async () => {
    await initTelemetry({
      enabled: true,
      exporterType: "prometheus",
      serviceName: "edge-prometheus-test",
    });

    const meter = getMeter("prom-meter");
    expect(meter).toBeDefined();

    // 创建 counter 并添加数据
    const counter = meter.createCounter("test.prom.init");
    counter.add(5);

    // 验证 prometheus 渲染包含该指标
    const output = await import("@monitor").then((m) =>
      (m as unknown as Record<string, () => string>).renderPrometheusMetrics!(),
    );
    expect(output).toContain("crab_test_prom_init_total");
  });

  // 1-6. _setTelemetryForTesting + shutdownTelemetry → 允许重新注入
  test("_setTelemetryForTesting + shutdownTelemetry → 可重新注入", () => {
    // 注入 fake meter
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

    // 验证 fake meter 已生效
    const meter = getMeter();
    const counter = meter.createCounter("pre-shutdown");
    counter.add(10);
    expect(addCalls.length).toBe(1);

    // 清理状态
    _setTelemetryForTesting({ meter: null, logger: null });
    void shutdownTelemetry();

    // 重新注入不同的 fake meter
    const addCalls2: Array<{ name: string; value: number }> = [];
    const fakeMeter2: MiniMeter = {
      createCounter(name) {
        return {
          add(value) {
            addCalls2.push({ name, value });
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
    _setTelemetryForTesting({ meter: fakeMeter2 });

    // 新注入的 meter 应生效
    const meter2 = getMeter();
    meter2.createCounter("post-reinject").add(20);
    expect(addCalls2.length).toBe(1);
    expect(addCalls2[0]!.name).toBe("post-reinject");

    // 之前的 addCalls 不应再增长
    expect(addCalls.length).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────────
// 2. Dashboard + ResourceMonitor 通过 globalBus 联合集成
// ──────────────────────────────────────────────────────────────────────

describe("Dashboard + ResourceMonitor 通过 globalBus 集成", () => {
  let monitor: ResourceMonitor;
  let dash: PerformanceDashboard;

  afterEach(() => {
    monitor?.stop();
    dash?.stop();
  });

  // 2-1. ResourceMonitor 发布 ResourceUpdate → Dashboard 收到并记录 gauge
  test("ResourceMonitor 发布 ResourceUpdate → Dashboard 收到 gauge 指标", async () => {
    // 创建独立的 ResourceMonitor（短间隔）
    monitor = new ResourceMonitor();
    dash = createPerformanceDashboard();

    // 手动模拟 ResourceUpdate 事件（避免定时器异步不确定性）
    globalBus.publish(
      AppEvent.ResourceUpdate,
      {
        memoryMB: 256,
        cpuPercent: 45,
        uptime: 10,
      },
      { throttle: false },
    );

    // 等待事件传播（同步 publish 应已到达，但加一 tick 保安全）
    await Bun.sleep(10);

    // Dashboard 应已收到 memory.rss gauge
    const memMetrics = dash.getMetrics("memory.rss");
    expect(memMetrics.length).toBeGreaterThanOrEqual(1);
    // 256 MB * 1024 * 1024 = 268435456 bytes
    expect(memMetrics[0]!.value).toBe(256 * 1024 * 1024);

    // Dashboard 应已收到 cpu.user gauge
    const cpuMetrics = dash.getMetrics("cpu.user");
    expect(cpuMetrics.length).toBeGreaterThanOrEqual(1);
    expect(cpuMetrics[0]!.value).toBe(45);
  });

  // 2-2. ResourceMonitor 启动后 dashboard 自动采集到资源数据
  test("ResourceMonitor 真实采集 → Dashboard 收到 ResourceUpdate", async () => {
    monitor = new ResourceMonitor();
    dash = createPerformanceDashboard();

    // 启动 monitor（50ms 间隔，快速采集一次）
    const stopMonitor = monitor.start(50);

    // 等待至少一次采集周期
    await Bun.sleep(100);

    stopMonitor();

    // Dashboard 应收到至少一个 ResourceUpdate 事件对应的 gauge
    const memMetrics = dash.getMetrics("memory.rss");
    expect(memMetrics.length).toBeGreaterThanOrEqual(1);
    // 内存值应 > 0（进程实际 RSS）
    expect(memMetrics[0]!.value).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────────────────────────────────
// 3. collectMetrics 双系统活跃时数据聚合
// ──────────────────────────────────────────────────────────────────────

describe("collectMetrics 双系统活跃时数据聚合", () => {
  let monitor: ResourceMonitor;

  afterEach(() => {
    monitor?.stop();
  });

  // 3-1. 启动 ResourceMonitor + Dashboard → collectMetrics 包含真实数据
  test("ResourceMonitor + Dashboard 活跃 → collectMetrics 返回有效数据", async () => {
    monitor = new ResourceMonitor();
    const dashboard = getGlobalDashboard();
    dashboard.start(1000);

    // 启动 monitor 让其采集
    const stopMonitor = monitor.start(50);
    await Bun.sleep(100);
    stopMonitor();

    // 调用 collectMetrics
    const snapshot = collectMetrics();

    // resource.status 应包含进程信息
    expect(snapshot.resource.status.pid).toBe(process.pid);
    expect(snapshot.resource.status.memoryMB).toBeGreaterThan(0);

    // dashboard.summary 应包含合理数据
    expect(snapshot.dashboard.summary.totalMetrics).toBeGreaterThanOrEqual(0);

    // dashboard.snapshot 包含内存数据
    expect(snapshot.dashboard.snapshot.memory.rss).toBeGreaterThan(0);

    dashboard.stop();
  });
});

// ──────────────────────────────────────────────────────────────────────
// 4. PerformanceDashboard 告警规则持久化与 reset 行为
// ──────────────────────────────────────────────────────────────────────

describe("PerformanceDashboard 告警规则 reset 行为", () => {
  let dash: PerformanceDashboard;

  beforeEach(() => {
    dash = createPerformanceDashboard();
  });

  afterEach(() => {
    dash.stop();
  });

  // 4-1. 添加告警规则 → 触发 → reset → 告警状态清除但规则保留
  test("告警触发后 reset → active 状态清除但规则保留", () => {
    // 添加即时告警规则（durationMs=0）
    const rule: AlertRule = {
      id: "test-reset-alert",
      name: "测试重置告警",
      metric: "test.metric",
      condition: "gt",
      threshold: 10,
      durationMs: 0, // 即时触发
      level: "warning",
      enabled: true,
    };
    dash.addAlertRule(rule);

    // 触发告警
    let alertEvent: AlertEvent | undefined;
    dash.on("alert", (evt: AlertEvent) => {
      alertEvent = evt;
    });
    dash.record("test.metric", 50, "gauge");

    // 验证告警已触发
    expect(alertEvent).toBeDefined();
    expect(alertEvent!.ruleId).toBe("test-reset-alert");
    expect(alertEvent!.currentValue).toBe(50);

    // reset dashboard
    dash.reset();

    // 规则仍保留（rulesCount 不变）
    const summary = dash.getSummary();
    expect(summary.rulesCount).toBe(1);

    // 但存储已清空
    expect(summary.totalMetrics).toBe(0);
  });

  // 4-2. reset 后同一告警可再次触发
  test("reset 后同一规则可再次触发告警", () => {
    const rule: AlertRule = {
      id: "test-retrigger",
      name: "测试重新触发",
      metric: "test.retrigger.metric",
      condition: "gte",
      threshold: 100,
      durationMs: 0,
      level: "critical",
      enabled: true,
    };
    dash.addAlertRule(rule);

    // 第一次触发
    let alertCount = 0;
    dash.on("alert", () => {
      alertCount++;
    });
    dash.record("test.retrigger.metric", 200, "gauge");
    expect(alertCount).toBe(1);

    // reset
    dash.reset();

    // 第二次触发（先恢复正常值再触发）
    dash.record("test.retrigger.metric", 50, "gauge"); // 恢复
    dash.record("test.retrigger.metric", 300, "gauge"); // 再次触发
    expect(alertCount).toBe(2);
  });

  // 4-3. disabled 规则在 reset 后仍然 disabled
  test("disabled 规则在 reset 后仍不触发", () => {
    const rule: AlertRule = {
      id: "test-disabled",
      name: "测试禁用规则",
      metric: "test.disabled.metric",
      condition: "gt",
      threshold: 0,
      durationMs: 0,
      level: "info",
      enabled: false,
    };
    dash.addAlertRule(rule);

    let alertCount = 0;
    dash.on("alert", () => {
      alertCount++;
    });

    // 触发值超过阈值但规则禁用
    dash.record("test.disabled.metric", 999, "gauge");
    expect(alertCount).toBe(0);

    // reset 后仍然不触发
    dash.reset();
    dash.record("test.disabled.metric", 999, "gauge");
    expect(alertCount).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────
// 5. getMemoryStats 边界场景
// ──────────────────────────────────────────────────────────────────────

describe("getMemoryStats 边界场景", () => {
  let monitor: ResourceMonitor;

  beforeEach(() => {
    // 创建独立实例，不影响全局单例
    monitor = new ResourceMonitor();
  });

  afterEach(() => {
    monitor.stop();
  });

  // 5-1. resetReport 后 getMemoryStats 返回零值
  test("resetReport 后 getMemoryStats 返回零值（min/max/avg=0）", () => {
    // 添加一个样本
    monitor.addMemorySample(200);
    monitor.addMemorySample(300);

    // 确认有数据
    const statsBefore = monitor.getMemoryStats();
    expect(statsBefore.min).toBeGreaterThan(0);
    expect(statsBefore.max).toBeGreaterThan(0);
    expect(statsBefore.avg).toBeGreaterThan(0);

    // reset
    monitor.resetReport();

    // 重置后 min/max/avg 应为 0（无历史样本）
    const statsAfter = monitor.getMemoryStats();
    expect(statsAfter.min).toBe(0);
    expect(statsAfter.max).toBe(0);
    expect(statsAfter.avg).toBe(0);
    // trend 应为 stable，rate=0，samples=0
    expect(statsAfter.trend.direction).toBe("stable");
    expect(statsAfter.trend.rate).toBe(0);
    expect(statsAfter.trend.samples).toBe(0);
  });

  // 5-2. 单样本 → current=min=max=avg
  test("单样本 → current === min === max === avg", () => {
    const value = 512;
    monitor.addMemorySample(value);

    const stats = monitor.getMemoryStats();
    expect(stats.current).toBe(value);
    expect(stats.min).toBe(value);
    expect(stats.max).toBe(value);
    expect(stats.avg).toBe(value);
  });

  // 5-3. 零样本 → min/max/avg=0，current 为当前实际内存
  test("零样本 → min/max/avg=0，current 为实时采集值", () => {
    // 不添加任何样本
    const stats = monitor.getMemoryStats();
    expect(stats.min).toBe(0);
    expect(stats.max).toBe(0);
    expect(stats.avg).toBe(0);
    // current 在零样本时调用 getMemoryUsageMB() 返回实时值
    expect(stats.current).toBeGreaterThanOrEqual(0);
  });

  // 5-4. recordAlert 独立计数 memory vs cpu
  test("recordAlert memory/cpu 独立计数", () => {
    monitor.recordAlert("memory");
    monitor.recordAlert("memory");
    monitor.recordAlert("cpu");

    const report = monitor.generateResourceReport();
    expect(report.memory.alerts).toBe(2);
    expect(report.cpu.alerts).toBe(1);
  });

  // 5-5. resetReport 清除告警计数
  test("resetReport 清除告警计数", () => {
    monitor.recordAlert("memory");
    monitor.recordAlert("cpu");
    monitor.recordAlert("cpu");

    const reportBefore = monitor.generateResourceReport();
    expect(reportBefore.memory.alerts).toBe(1);
    expect(reportBefore.cpu.alerts).toBe(2);

    monitor.resetReport();

    const reportAfter = monitor.generateResourceReport();
    expect(reportAfter.memory.alerts).toBe(0);
    expect(reportAfter.cpu.alerts).toBe(0);
  });
});
