/**
 * collectMetrics 集成测试 + ResourceMonitor 独立实例测试 + 边界用例。
 *
 * 测试范围:
 *   - collectMetrics 返回完整的四域快照结构
 *   - ResourceMonitor 独立实例与全局单例状态隔离
 *   - PerformanceMonitor RingBuffer 溢出行为
 *   - PerformanceMonitor 快速 start/end 并发
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  PerformanceMonitor,
  collectMetrics,
  ResourceMonitor,
  resourceMonitor,
  isResourceMonitorPaused,
} from "@monitor";

// ──────────────────────────────────────────────────────────────
// 1. collectMetrics 集成测试
// ──────────────────────────────────────────────────────────────

describe("collectMetrics 集成测试", () => {
  test("返回对象包含四个顶级字段且类型正确", () => {
    const snapshot = collectMetrics();

    // 验证顶级结构
    expect(snapshot).toHaveProperty("collectedAt");
    expect(snapshot).toHaveProperty("performance");
    expect(snapshot).toHaveProperty("dashboard");
    expect(snapshot).toHaveProperty("resource");

    // collectedAt 为时间戳
    expect(typeof snapshot.collectedAt).toBe("number");
    expect(snapshot.collectedAt).toBeGreaterThan(0);

    // performance 域
    expect(Array.isArray(snapshot.performance.history)).toBe(true);
    expect(typeof snapshot.performance.report).toBe("object");

    // dashboard 域
    expect(typeof snapshot.dashboard.summary).toBe("object");
    expect(typeof snapshot.dashboard.snapshot).toBe("object");

    // resource 域
    expect(typeof snapshot.resource.status).toBe("object");
    expect(typeof snapshot.resource.thresholds).toBe("object");
    expect(typeof snapshot.resource.memory).toBe("object");
    expect(typeof snapshot.resource.report).toBe("object");
  });

  test("performance.history 为 PerformanceMetric 数组", () => {
    const snapshot = collectMetrics();
    expect(Array.isArray(snapshot.performance.history)).toBe(true);
    for (const m of snapshot.performance.history) {
      expect(m).toHaveProperty("id");
      expect(m).toHaveProperty("type");
      expect(m).toHaveProperty("name");
      expect(m).toHaveProperty("startTime");
    }
  });

  test("resource.status 包含版本、内存、运行时间和 pid", () => {
    const snapshot = collectMetrics();
    const { status } = snapshot.resource;
    expect(typeof status.version).toBe("string");
    expect(status.memoryMB).toBeGreaterThanOrEqual(0);
    expect(status.uptime).toBeGreaterThanOrEqual(0);
    expect(status.pid).toBe(process.pid);
  });
});

// ──────────────────────────────────────────────────────────────
// 2. ResourceMonitor 独立实例测试
// ──────────────────────────────────────────────────────────────

describe("ResourceMonitor 独立实例", () => {
  let instance: ResourceMonitor;

  afterEach(() => {
    instance.stop();
  });

  test("独立实例状态与全局单例隔离", () => {
    instance = new ResourceMonitor();

    // 全局单例状态
    const globalPausedBefore = isResourceMonitorPaused();
    const globalAlertsBefore = resourceMonitor.getAlertThresholds();

    // 独立实例暂停
    instance.pause();
    expect(instance.isPaused()).toBe(true);
    expect(isResourceMonitorPaused()).toBe(globalPausedBefore);

    // 独立实例设置阈值
    instance.setAlertThresholds({ memoryMB: 999, cpuPercent: 95 });
    const instanceThresholds = instance.getAlertThresholds();
    expect(instanceThresholds.memoryMB).toBe(999);
    expect(instanceThresholds.cpuPercent).toBe(95);
    // 全局单例不受影响
    const globalThresholds = resourceMonitor.getAlertThresholds();
    expect(globalThresholds.memoryMB).toBe(globalAlertsBefore.memoryMB);
  });

  test("独立实例 start/stop 不影响全局单例", async () => {
    instance = new ResourceMonitor();

    // 启动独立实例（短间隔，20ms 采集一次就停）
    const stop = instance.start(20);

    // 等待一次采集
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        stop();
        resolve();
      }, 50);
    });

    // 独立实例报告应有数据
    const report = instance.generateResourceReport();
    expect(report.period.durationMs).toBeGreaterThanOrEqual(0);

    // 全局单例未启动，不应有影响
    expect(resourceMonitor.getAlertThresholds().memoryMB).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────────────────────────
// 3. PerformanceMonitor RingBuffer 溢出测试
// ──────────────────────────────────────────────────────────────

describe("PerformanceMonitor RingBuffer 溢出", () => {
  test("maxMetrics=5 时仅保留最新 5 条指标", () => {
    const monitor = new PerformanceMonitor({ maxMetrics: 5 });

    // 推入 10 个指标
    for (let i = 0; i < 10; i++) {
      const id = monitor.start("api", `overflow-${String(i)}`);
      monitor.end(id, true);
    }

    const history = monitor.getHistory();
    expect(history.length).toBe(5);

    // 应保留最新的 5 条（index 5-9）
    expect(history[0]!.name).toBe("overflow-5");
    expect(history[4]!.name).toBe("overflow-9");
  });
});

// ──────────────────────────────────────────────────────────────
// 4. PerformanceMonitor 快速并发测试
// ──────────────────────────────────────────────────────────────

describe("PerformanceMonitor 并发 start/end", () => {
  test("快速连续 measure 调用不丢数据", async () => {
    const monitor = new PerformanceMonitor({ maxMetrics: 100 });

    // 模拟并发调用场景：50 次快速 measure
    const promises = [];
    for (let i = 0; i < 50; i++) {
      promises.push(
        monitor.measure("api", "concurrent", async () => {
          // 每次执行一个极轻量操作
          await Promise.resolve();
        }),
      );
    }
    await Promise.all(promises);

    const history = monitor.getHistory();
    expect(history.length).toBe(50);

    // 所有 measure 成功时应全部 success=true
    const successCount = history.filter((m) => m.success).length;
    expect(successCount).toBe(50);
  });
});
