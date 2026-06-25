/**
 * 性能仪表盘(PerformanceDashboard) 单元测试。
 *
 * 测试范围:
 *   - 创建与初始状态
 *   - start/stop 生命周期与幂等性
 *   - record / incrementCounter / recordHistogram / startTimer 指标打点
 *   - addAlertRule / removeAlertRule 告警规则管理
 *   - durationMs=0 即时触发 / durationMs>0 持续触发
 *   - 告警状态机: trigger → active → resolved → 可再次触发
 *   - disabled 规则不触发
 *   - getSnapshot / getSummary 结构验证
 *   - reset 清除存储
 *   - isActive 运行状态
 *   - createCpuAlertRule / createMemoryAlertRule 预设工厂
 *   - 多规则对同一指标的并行评估
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createCpuAlertRule,
  createMemoryAlertRule,
  createPerformanceDashboard,
  getGlobalDashboard,
  PerformanceDashboard,
} from "@monitor";
import type { AlertEvent, AlertLevel, AlertRule, DashboardMetricType, Metric, PerformanceSnapshot } from "@monitor";

/** 创建一个用于测试的独立 Dashboard 实例 */
function createTestDashboard(): PerformanceDashboard {
  return createPerformanceDashboard();
}

describe("PerformanceDashboard — 性能仪表盘", () => {
  // ── 1. 创建与初始状态 ──────────────────────────────────────────────
  describe("创建与初始状态", () => {
    test("createPerformanceDashboard 返回 PerformanceDashboard 实例", () => {
      const dash = createTestDashboard();
      expect(dash).toBeInstanceOf(PerformanceDashboard);
    });

    test("初始状态下 isActive 为 false", () => {
      const dash = createTestDashboard();
      expect(dash.isActive()).toBe(false);
    });

    test("初始状态下 getSummary 返回全零/空值", () => {
      const dash = createTestDashboard();
      const summary = dash.getSummary();
      expect(summary.uptime).toBe(0);
      expect(summary.totalMetrics).toBe(0);
      expect(summary.activeAlerts).toBe(0);
      expect(summary.rulesCount).toBe(0);
    });

    test("初始状态下 getLatestMetric 返回 undefined", () => {
      const dash = createTestDashboard();
      expect(dash.getLatestMetric("any.metric")).toBeUndefined();
    });
  });

  // ── 2. start/stop 生命周期与幂等性 ─────────────────────────────────
  describe("start/stop 生命周期", () => {
    let dash: PerformanceDashboard;

    beforeEach(() => {
      dash = createTestDashboard();
    });

    afterEach(() => {
      dash.stop();
    });

    test("start 后 isActive 为 true", () => {
      dash.start();
      expect(dash.isActive()).toBe(true);
    });

    test("stop 后 isActive 为 false", () => {
      dash.start();
      dash.stop();
      expect(dash.isActive()).toBe(false);
    });

    test("start 幂等 — 多次调用不会创建多个定时器", () => {
      dash.start();
      dash.start(); // 第二次调用应被忽略
      expect(dash.isActive()).toBe(true);
      // 停止一次即完全停止，证明只有一个 interval
      dash.stop();
      expect(dash.isActive()).toBe(false);
    });

    test("start 后会采集初始快照并发射 snapshot 事件", () => {
      const snapshots: any[] = [];
      dash.on("snapshot", (snap) => {
        snapshots.push(snap);
      });
      dash.start();
      // 首次 collectSnapshot 同步执行，应已触发
      expect(snapshots.length).toBeGreaterThanOrEqual(1);
      expect(snapshots[0]!).toHaveProperty("memory");
      expect(snapshots[0]!).toHaveProperty("cpu");
      expect(snapshots[0]!).toHaveProperty("eventLoopDelay");
    });
  });

  // ── 3. record 指标打点 (gauge / counter / histogram) ──────────────
  describe("record — 指标打点", () => {
    let dash: PerformanceDashboard;

    beforeEach(() => {
      dash = createTestDashboard();
    });

    test("record gauge 类型指标并可通过 getLatestMetric 获取", () => {
      dash.record("test.gauge", 42, "gauge");
      const metric = dash.getLatestMetric("test.gauge");
      expect(metric).toBeDefined();
      expect(metric!.type).toBe("gauge");
      expect(metric!.value).toBe(42);
      expect(metric!.name).toBe("test.gauge");
      expect(metric!.timestamp).toBeGreaterThan(0);
    });

    test("record counter 类型指标", () => {
      dash.record("test.counter", 1, "counter");
      const metric = dash.getLatestMetric("test.counter");
      expect(metric!.type).toBe("counter");
      expect(metric!.value).toBe(1);
    });

    test("record histogram 类型指标", () => {
      dash.record("test.histogram", 100, "histogram");
      const metric = dash.getLatestMetric("test.histogram");
      expect(metric!.type).toBe("histogram");
      expect(metric!.value).toBe(100);
    });

    test("record 支持自定义 unit 和 tags", () => {
      dash.record("test.custom", 7, "gauge", {
        unit: "requests",
        tags: { env: "test" },
      });
      const metric = dash.getLatestMetric("test.custom")!;
      expect(metric.unit).toBe("requests");
      expect(metric.tags).toEqual({ env: "test" });
    });

    test("record 后 getSummary.totalMetrics 递增", () => {
      dash.record("a", 1, "gauge");
      dash.record("b", 2, "counter");
      expect(dash.getSummary().totalMetrics).toBe(2);
    });
  });

  // ── 4. incrementCounter ───────────────────────────────────────────
  describe("incrementCounter — 计数器递增", () => {
    test("incrementCounter 默认 value=1 且 type 为 counter", () => {
      const dash = createTestDashboard();
      dash.incrementCounter("api.calls");
      const metric = dash.getLatestMetric("api.calls");
      expect(metric!.type).toBe("counter");
      expect(metric!.value).toBe(1);
    });

    test("incrementCounter 支持自定义 step 值", () => {
      const dash = createTestDashboard();
      dash.incrementCounter("api.calls", 5);
      expect(dash.getLatestMetric("api.calls")!.value).toBe(5);
    });

    test("incrementCounter 支持 tags", () => {
      const dash = createTestDashboard();
      dash.incrementCounter("api.calls", 1, { endpoint: "/health" });
      expect(dash.getLatestMetric("api.calls")!.tags).toEqual({ endpoint: "/health" });
    });
  });

  // ── 5. recordHistogram ───────────────────────────────────────────
  describe("recordHistogram — 直方图记录", () => {
    test("recordHistogram 默认 unit 为 ms", () => {
      const dash = createTestDashboard();
      dash.recordHistogram("request.latency", 250);
      const metric = dash.getLatestMetric("request.latency")!;
      expect(metric.type).toBe("histogram");
      expect(metric.value).toBe(250);
      expect(metric.unit).toBe("ms");
    });

    test("recordHistogram 支持 tags", () => {
      const dash = createTestDashboard();
      dash.recordHistogram("request.latency", 100, { route: "/api" });
      expect(dash.getLatestMetric("request.latency")!.tags).toEqual({ route: "/api" });
    });
  });

  // ── 6. startTimer — 计时器 ───────────────────────────────────────
  describe("startTimer — 计时器", () => {
    test("startTimer 返回一个停止函数", () => {
      const dash = createTestDashboard();
      const stop = dash.startTimer("operation");
      expect(typeof stop).toBe("function");
    });

    test("停止函数调用后记录 durationMs 直方图指标", () => {
      const dash = createTestDashboard();
      const stop = dash.startTimer("operation");

      // 模拟一小段工作
      const start = Date.now();
      while (Date.now() - start < 5) {
        // busy wait ~5ms
      }
      stop();

      const metric = dash.getLatestMetric("operation");
      expect(metric).toBeDefined();
      expect(metric!.type).toBe("histogram");
      expect(metric!.value).toBeGreaterThanOrEqual(0);
      expect(metric!.unit).toBe("ms");
    });

    test("计时器记录的时长大致正确（容差 50ms）", () => {
      const dash = createTestDashboard();
      const stop = dash.startTimer("timed.op");

      // 使用 setTimeout 保证至少 20ms
      const sleepMs = 20;
      const sleepStart = Date.now();
      while (Date.now() - sleepStart < sleepMs) {
        // busy wait
      }
      stop();

      const metric = dash.getLatestMetric("timed.op")!;
      expect(metric.value).toBeGreaterThanOrEqual(sleepMs - 10); // 容差
      expect(metric.value).toBeLessThan(sleepMs + 50);
    });
  });

  // ── 7. addAlertRule / removeAlertRule ─────────────────────────────
  describe("addAlertRule / removeAlertRule — 告警规则管理", () => {
    let dash: PerformanceDashboard;

    beforeEach(() => {
      dash = createTestDashboard();
    });

    test("addAlertRule 后 rulesCount 递增", () => {
      const rule: AlertRule = {
        condition: "gt",
        durationMs: 0,
        enabled: true,
        id: "rule-1",
        level: "warning",
        metric: "test.value",
        name: "测试规则",
        threshold: 100,
      };
      dash.addAlertRule(rule);
      expect(dash.getSummary().rulesCount).toBe(1);
    });

    test("removeAlertRule 后 rulesCount 递减", () => {
      const rule: AlertRule = {
        condition: "gt",
        durationMs: 0,
        enabled: true,
        id: "rule-1",
        level: "warning",
        metric: "test.value",
        name: "测试规则",
        threshold: 100,
      };
      dash.addAlertRule(rule);
      dash.removeAlertRule("rule-1");
      expect(dash.getSummary().rulesCount).toBe(0);
    });

    test("removeAlertRule 对不存在的 id 不抛异常", () => {
      expect(() => dash.removeAlertRule("nonexistent")).not.toThrow();
      expect(dash.getSummary().rulesCount).toBe(0);
    });
  });

  // ── 8. AlertRule durationMs=0 即时触发 ───────────────────────────
  describe("告警 — durationMs=0 即时触发", () => {
    test("条件满足时立即触发 alert 事件", () => {
      const dash = createTestDashboard();
      const alerts: AlertEvent[] = [];

      dash.on("alert", (event: AlertEvent) => {
        alerts.push(event);
      });

      dash.addAlertRule({
        condition: "gt",
        durationMs: 0,
        enabled: true,
        id: "instant-rule",
        level: "critical",
        metric: "test.value",
        name: "即时告警",
        threshold: 50,
      });

      dash.record("test.value", 99);

      expect(alerts.length).toBe(1);
      expect(alerts[0]!.ruleId).toBe("instant-rule");
      expect(alerts[0]!.level).toBe("critical");
      expect(alerts[0]!.currentValue).toBe(99);
      expect(alerts[0]!.threshold).toBe(50);
      expect(alerts[0]!.triggeredAt).toBeGreaterThan(0);
    });

    test("条件不满足时不触发 alert 事件", () => {
      const dash = createTestDashboard();
      const alerts: AlertEvent[] = [];

      dash.on("alert", (event) => alerts.push(event));

      dash.addAlertRule({
        condition: "gt",
        durationMs: 0,
        enabled: true,
        id: "no-trigger",
        level: "info",
        metric: "test.value",
        name: "不触发",
        threshold: 100,
      });

      // value=10 不满足 gt 100
      dash.record("test.value", 10);
      expect(alerts.length).toBe(0);
    });
  });

  // ── 9. AlertRule durationMs > 0 需要持续满足条件 ─────────────────
  describe("告警 — durationMs > 0 持续触发", () => {
    test("单次不满足持续时间，不触发告警", () => {
      const dash = createTestDashboard();
      const alerts: AlertEvent[] = [];

      dash.on("alert", (event) => alerts.push(event));

      dash.addAlertRule({
        condition: "gt",
        durationMs: 5000, // 需要 5 秒持续满足
        enabled: true,
        id: "sustained-rule",
        level: "warning",
        metric: "test.sustained",
        name: "持续告警",
        threshold: 50,
      });

      // 只记录一次，不满足持续 5 秒
      dash.record("test.sustained", 99);
      expect(alerts.length).toBe(0);
    });

    test("多次快速记录但持续时间不足，仍不触发", () => {
      const dash = createTestDashboard();
      const alerts: AlertEvent[] = [];

      dash.on("alert", (event) => alerts.push(event));

      dash.addAlertRule({
        condition: "gt",
        durationMs: 10_000, // 需要 10 秒
        enabled: true,
        id: "long-sustained",
        level: "info",
        metric: "test.long",
        name: "长持续告警",
        threshold: 10,
      });

      // 快速记录 3 次，总持续时间仍然不足
      dash.record("test.long", 20);
      dash.record("test.long", 25);
      dash.record("test.long", 30);
      expect(alerts.length).toBe(0);
    });
  });

  // ── 10. 告警状态机: trigger → active → resolved → 可再次触发 ────
  describe("告警状态机", () => {
    test("触发后条件清除 → 发射 alertResolved → 再次满足可再次触发", () => {
      const dash = createTestDashboard();
      const alerts: AlertEvent[] = [];
      const resolved: { ruleId: string; ruleName: string }[] = [];

      dash.on("alert", (event) => alerts.push(event));
      dash.on("alertResolved", (event) => resolved.push(event));

      dash.addAlertRule({
        condition: "gt",
        durationMs: 0,
        enabled: true,
        id: "state-machine",
        level: "warning",
        metric: "test.sm",
        name: "状态机规则",
        threshold: 50,
      });

      // 1. 触发告警
      dash.record("test.sm", 80);
      expect(alerts.length).toBe(1);
      expect(dash.getSummary().activeAlerts).toBe(1);

      // 2. 条件清除 → 告警恢复
      dash.record("test.sm", 10);
      expect(resolved.length).toBe(1);
      expect(resolved[0]!.ruleId).toBe("state-machine");
      expect(dash.getSummary().activeAlerts).toBe(0);

      // 3. 再次触发（可重新触发）
      dash.record("test.sm", 90);
      expect(alerts.length).toBe(2);
      expect(alerts[1]!.currentValue).toBe(90);
      expect(dash.getSummary().activeAlerts).toBe(1);
    });

    test("告警处于 active 状态时，重复满足条件不重复触发", () => {
      const dash = createTestDashboard();
      const alerts: AlertEvent[] = [];

      dash.on("alert", (event) => alerts.push(event));

      dash.addAlertRule({
        condition: "gt",
        durationMs: 0,
        enabled: true,
        id: "no-duplicate",
        level: "info",
        metric: "test.dup",
        name: "不重复触发",
        threshold: 10,
      });

      // 连续多次满足条件
      dash.record("test.dup", 20);
      dash.record("test.dup", 25);
      dash.record("test.dup", 30);

      // 仅触发一次
      expect(alerts.length).toBe(1);
    });
  });

  // ── 11. disabled=true 规则不触发 ──────────────────────────────────
  describe("告警 — disabled 规则", () => {
    test("disabled=true 的规则不触发告警", () => {
      const dash = createTestDashboard();
      const alerts: AlertEvent[] = [];

      dash.on("alert", (event) => alerts.push(event));

      dash.addAlertRule({
        condition: "gt",
        durationMs: 0,
        enabled: false, // 已禁用
        id: "disabled-rule",
        level: "critical",
        metric: "test.disabled",
        name: "禁用规则",
        threshold: 10,
      });

      dash.record("test.disabled", 999);
      expect(alerts.length).toBe(0);
      // 规则仍然计数
      expect(dash.getSummary().rulesCount).toBe(1);
    });
  });

  // ── 12. getSnapshot 返回结构验证 ──────────────────────────────────
  describe("getSnapshot — 性能快照", () => {
    test("getSnapshot 返回包含 memory/cpu/eventLoopDelay 结构", () => {
      const dash = createTestDashboard();
      const snapshot: PerformanceSnapshot = dash.getSnapshot();

      // memory 结构
      expect(snapshot.memory).toBeDefined();
      expect(typeof snapshot.memory.heapUsed).toBe("number");
      expect(typeof snapshot.memory.heapTotal).toBe("number");
      expect(typeof snapshot.memory.external).toBe("number");
      expect(typeof snapshot.memory.rss).toBe("number");
      expect(snapshot.memory.heapUsed).toBeGreaterThanOrEqual(0);
      expect(snapshot.memory.heapTotal).toBeGreaterThanOrEqual(0);

      // cpu 结构
      expect(snapshot.cpu).toBeDefined();
      expect(typeof snapshot.cpu.user).toBe("number");
      expect(typeof snapshot.cpu.system).toBe("number");

      // eventLoopDelay
      expect(typeof snapshot.eventLoopDelay).toBe("number");
      expect(snapshot.eventLoopDelay).toBeGreaterThanOrEqual(0);

      // activeRequests
      expect(typeof snapshot.activeRequests).toBe("number");
    });
  });

  // ── 13. getSummary 返回结构验证 ──────────────────────────────────
  describe("getSummary — 摘要信息", () => {
    test("未启动时 uptime 为 0", () => {
      const dash = createTestDashboard();
      expect(dash.getSummary().uptime).toBe(0);
    });

    test("启动后 uptime > 0", async () => {
      const dash = createTestDashboard();
      dash.start();
      // 等待 1ms 确保时间差不为零
      await Bun.sleep(1);
      const summary = dash.getSummary();
      expect(summary.uptime).toBeGreaterThan(0);
      dash.stop();
    });

    test("totalMetrics 准确反映已记录的指标数量", () => {
      const dash = createTestDashboard();
      dash.record("m1", 1, "gauge");
      dash.record("m1", 2, "gauge");
      dash.record("m2", 3, "counter");
      expect(dash.getSummary().totalMetrics).toBe(3);
    });

    test("activeAlerts 和 rulesCount 准确", () => {
      const dash = createTestDashboard();
      const alerts: AlertEvent[] = [];
      dash.on("alert", (e) => alerts.push(e));

      dash.addAlertRule({
        condition: "gt",
        durationMs: 0,
        enabled: true,
        id: "r1",
        level: "info",
        metric: "x",
        name: "规则1",
        threshold: 0,
      });

      expect(dash.getSummary().rulesCount).toBe(1);
      expect(dash.getSummary().activeAlerts).toBe(0);

      dash.record("x", 5); // 触发
      expect(dash.getSummary().activeAlerts).toBe(1);

      dash.record("x", -1); // 恢复
      expect(dash.getSummary().activeAlerts).toBe(0);
    });
  });

  // ── 14. reset 清除存储 ──────────────────────────────────────────
  describe("reset — 重置存储", () => {
    test("reset 后 totalMetrics 归零", () => {
      const dash = createTestDashboard();
      dash.record("a", 1, "gauge");
      dash.record("b", 2, "counter");
      expect(dash.getSummary().totalMetrics).toBe(2);

      dash.reset();
      expect(dash.getSummary().totalMetrics).toBe(0);
    });

    test("reset 后指标数据不可查", () => {
      const dash = createTestDashboard();
      dash.record("test.metric", 42, "gauge");
      dash.reset();
      expect(dash.getLatestMetric("test.metric")).toBeUndefined();
    });

    test("reset 不影响告警规则", () => {
      const dash = createTestDashboard();
      dash.addAlertRule({
        condition: "gt",
        durationMs: 0,
        enabled: true,
        id: "keep-rule",
        level: "info",
        metric: "y",
        name: "保留规则",
        threshold: 0,
      });
      dash.reset();
      expect(dash.getSummary().rulesCount).toBe(1);
    });
  });

  // ── 15. isActive 反映运行状态 ────────────────────────────────────
  describe("isActive — 运行状态", () => {
    test("未启动返回 false", () => {
      const dash = createTestDashboard();
      expect(dash.isActive()).toBe(false);
    });

    test("启动后返回 true", () => {
      const dash = createTestDashboard();
      dash.start();
      expect(dash.isActive()).toBe(true);
      dash.stop();
    });

    test("停止后返回 false", () => {
      const dash = createTestDashboard();
      dash.start();
      dash.stop();
      expect(dash.isActive()).toBe(false);
    });
  });

  // ── 16. createCpuAlertRule / createMemoryAlertRule 预设工厂 ───────
  describe("预设告警工厂函数", () => {
    test("createMemoryAlertRule 返回正确结构", () => {
      const rule = createMemoryAlertRule();
      expect(rule.id).toBe("memory-high");
      expect(rule.name).toBe("内存使用过高");
      expect(rule.metric).toBe("memory.heapUsed");
      expect(rule.condition).toBe("gte");
      expect(rule.threshold).toBe(500 * 1024 * 1024); // 500MB
      expect(rule.durationMs).toBe(30_000);
      expect(rule.enabled).toBe(true);
      expect(rule.level).toBe("warning");
    });

    test("createMemoryAlertRule 支持自定义 AlertLevel", () => {
      const rule = createMemoryAlertRule("critical");
      expect(rule.level).toBe("critical");
    });

    test("createCpuAlertRule 返回正确结构", () => {
      const rule = createCpuAlertRule();
      expect(rule.id).toBe("cpu-high");
      expect(rule.name).toBe("CPU 使用过高");
      expect(rule.metric).toBe("cpu.user");
      expect(rule.condition).toBe("gte");
      expect(rule.threshold).toBe(80);
      expect(rule.durationMs).toBe(30_000);
      expect(rule.enabled).toBe(true);
      expect(rule.level).toBe("warning");
    });

    test("createCpuAlertRule 支持自定义 threshold 和 level", () => {
      const rule = createCpuAlertRule(95, "critical");
      expect(rule.threshold).toBe(95);
      expect(rule.level).toBe("critical");
    });
  });

  // ── 17. 多条告警规则对同一指标 ────────────────────────────────────
  describe("多规则对同一指标", () => {
    test("同一指标可被多条规则同时评估", () => {
      const dash = createTestDashboard();
      const alerts: AlertEvent[] = [];

      dash.on("alert", (event) => alerts.push(event));

      dash.addAlertRule({
        condition: "gt",
        durationMs: 0,
        enabled: true,
        id: "warning-rule",
        level: "warning",
        metric: "shared.metric",
        name: "警告规则",
        threshold: 50,
      });

      dash.addAlertRule({
        condition: "gt",
        durationMs: 0,
        enabled: true,
        id: "critical-rule",
        level: "critical",
        metric: "shared.metric",
        name: "严重规则",
        threshold: 90,
      });

      // 值=100 同时满足两条规则
      dash.record("shared.metric", 100);

      expect(alerts.length).toBe(2);
      const ruleIds = alerts.map((a) => a.ruleId).sort();
      expect(ruleIds).toEqual(["critical-rule", "warning-rule"]);
      expect(dash.getSummary().activeAlerts).toBe(2);
    });

    test("同一指标仅满足部分规则时，仅触发匹配的规则", () => {
      const dash = createTestDashboard();
      const alerts: AlertEvent[] = [];

      dash.on("alert", (event) => alerts.push(event));

      dash.addAlertRule({
        condition: "gt",
        durationMs: 0,
        enabled: true,
        id: "high-rule",
        level: "warning",
        metric: "partial.metric",
        name: "高阈值规则",
        threshold: 90,
      });

      dash.addAlertRule({
        condition: "gt",
        durationMs: 0,
        enabled: true,
        id: "low-rule",
        level: "info",
        metric: "partial.metric",
        name: "低阈值规则",
        threshold: 10,
      });

      // 值=50 仅满足 low-rule (gt 10)，不满足 high-rule (gt 90)
      dash.record("partial.metric", 50);

      expect(alerts.length).toBe(1);
      expect(alerts[0]!.ruleId).toBe("low-rule");
    });

    test("不同条件的规则可共存（gt + lt）", () => {
      const dash = createTestDashboard();
      const alerts: AlertEvent[] = [];

      dash.on("alert", (event) => alerts.push(event));

      dash.addAlertRule({
        condition: "gt",
        durationMs: 0,
        enabled: true,
        id: "too-high",
        level: "warning",
        metric: "dual.metric",
        name: "过高",
        threshold: 100,
      });

      dash.addAlertRule({
        condition: "lt",
        durationMs: 0,
        enabled: true,
        id: "too-low",
        level: "info",
        metric: "dual.metric",
        name: "过低",
        threshold: 5,
      });

      // 值=200 触发 too-high
      dash.record("dual.metric", 200);
      expect(alerts.length).toBe(1);
      expect(alerts[0]!.ruleId).toBe("too-high");

      // 值恢复到正常范围 → too-high 恢复
      dash.record("dual.metric", 50);

      // 值=1 触发 too-low
      dash.record("dual.metric", 1);
      expect(alerts.length).toBe(2);
      expect(alerts[1]!.ruleId).toBe("too-low");
    });
  });

  // ── getGlobalDashboard 单例 ──────────────────────────────────────
  describe("getGlobalDashboard — 全局单例", () => {
    test("多次调用返回同一实例", () => {
      const a = getGlobalDashboard();
      const b = getGlobalDashboard();
      expect(a).toBe(b);
    });
  });

  // ── evaluateCondition 条件运算覆盖 ─────────────────────────────────
  describe("条件运算符覆盖", () => {
    /** 辅助: 仅当条件满足时触发 alert */
    function evaluateWithCondition(condition: AlertRule["condition"], threshold: number, value: number): boolean {
      const dash = createTestDashboard();
      let triggered = false;
      dash.on("alert", () => {
        triggered = true;
      });
      dash.addAlertRule({
        condition,
        durationMs: 0,
        enabled: true,
        id: "cond-test",
        level: "info",
        metric: "cond.metric",
        name: "条件测试",
        threshold,
      });
      dash.record("cond.metric", value);
      return triggered;
    }

    test("gt: value > threshold 触发", () => {
      expect(evaluateWithCondition("gt", 10, 11)).toBe(true);
      expect(evaluateWithCondition("gt", 10, 10)).toBe(false);
      expect(evaluateWithCondition("gt", 10, 9)).toBe(false);
    });

    test("lt: value < threshold 触发", () => {
      expect(evaluateWithCondition("lt", 10, 9)).toBe(true);
      expect(evaluateWithCondition("lt", 10, 10)).toBe(false);
      expect(evaluateWithCondition("lt", 10, 11)).toBe(false);
    });

    test("gte: value >= threshold 触发", () => {
      expect(evaluateWithCondition("gte", 10, 11)).toBe(true);
      expect(evaluateWithCondition("gte", 10, 10)).toBe(true);
      expect(evaluateWithCondition("gte", 10, 9)).toBe(false);
    });

    test("lte: value <= threshold 触发", () => {
      expect(evaluateWithCondition("lte", 10, 9)).toBe(true);
      expect(evaluateWithCondition("lte", 10, 10)).toBe(true);
      expect(evaluateWithCondition("lte", 10, 11)).toBe(false);
    });

    test("eq: value === threshold 触发", () => {
      expect(evaluateWithCondition("eq", 10, 10)).toBe(true);
      expect(evaluateWithCondition("eq", 10, 9)).toBe(false);
      expect(evaluateWithCondition("eq", 10, 11)).toBe(false);
    });
  });

  // ── getMetrics 批量获取 ──────────────────────────────────────────
  describe("getMetrics — 批量获取指标", () => {
    test("getMetrics 返回指定名称的最新 N 条指标", () => {
      const dash = createTestDashboard();
      for (let i = 0; i < 5; i++) {
        dash.record("batch.metric", i, "gauge");
      }

      const metrics = dash.getMetrics("batch.metric", 3);
      expect(metrics.length).toBe(3);
      // 最新 3 条: value = 2, 3, 4
      expect(metrics[0]!.value).toBe(2);
      expect(metrics[1]!.value).toBe(3);
      expect(metrics[2]!.value).toBe(4);
    });

    test("getMetrics 对不存在的指标返回空数组", () => {
      const dash = createTestDashboard();
      expect(dash.getMetrics("nonexistent")).toEqual([]);
    });
  });

  // ── EventEmitter 事件接口验证 ─────────────────────────────────────
  describe("EventEmitter 事件接口", () => {
    test("支持 .on 注册多个监听器", () => {
      const dash = createTestDashboard();
      const received1: number[] = [];
      const received2: number[] = [];

      dash.on("alert", () => received1.push(1));
      dash.on("alert", () => received2.push(1));

      dash.addAlertRule({
        condition: "gt",
        durationMs: 0,
        enabled: true,
        id: "multi-listener",
        level: "info",
        metric: "evt",
        name: "多监听器",
        threshold: 0,
      });

      dash.record("evt", 5);

      // 两个监听器都应被触发
      expect(received1.length).toBe(1);
      expect(received2.length).toBe(1);
    });

    test("alertResolved 事件携带 ruleId 和 ruleName", () => {
      const dash = createTestDashboard();
      let resolvedPayload: { ruleId: string; ruleName: string } | undefined;

      dash.on("alertResolved", (payload) => {
        resolvedPayload = payload;
      });

      dash.addAlertRule({
        condition: "gt",
        durationMs: 0,
        enabled: true,
        id: "resolve-test",
        level: "warning",
        metric: "resolve.metric",
        name: "恢复测试规则",
        threshold: 0,
      });

      // 触发
      dash.record("resolve.metric", 10);
      // 恢复
      dash.record("resolve.metric", -1);

      expect(resolvedPayload).toBeDefined();
      expect(resolvedPayload!.ruleId).toBe("resolve-test");
      expect(resolvedPayload!.ruleName).toBe("恢复测试规则");
    });
  });
});
