/**
 * 资源监控测试。
 *
 * 测试用例:
 *   - 内存使用获取
 *   - 运行时间获取
 *   - 资源状态报告
 *   - 资源更新事件
 */
import { afterEach, describe, expect, test } from "bun:test";
import { globalBus } from "@/bus";
import { AppEvent } from "@/bus";
import {
  addMemorySample,
  generateResourceReport,
  getAlertThresholds,
  getMemoryStats,
  getMemoryTrend,
  getMemoryUsageMB,
  getResourceStatus,
  getUptime,
  recordAlert,
  recordResourceSample,
  resetResourceReport,
  setAlertThresholds,
  startResourceMonitor,
} from "@monitor";

const originalThresholds = getAlertThresholds();

afterEach(() => {
  resetResourceReport();
  setAlertThresholds(originalThresholds);
});

describe("Resource Monitor — 资源监控", () => {
  test("getMemoryUsageMB 返回非负数", () => {
    expect(getMemoryUsageMB()).toBeGreaterThanOrEqual(0);
  });

  test("getUptime 返回非负数", () => {
    expect(getUptime()).toBeGreaterThanOrEqual(0);
  });

  test("getResourceStatus 返回版本、内存、运行时间和 pid", () => {
    const status = getResourceStatus();
    expect(typeof status.version).toBe("string");
    expect(status.memoryMB).toBeGreaterThanOrEqual(0);
    expect(status.uptime).toBeGreaterThanOrEqual(0);
    expect(status.pid).toBe(process.pid);
  });

  test("startResourceMonitor 会发布 ResourceUpdate 事件", async () => {
    const received: { memoryMB: number; uptime: number }[] = [];
    const unsub = globalBus.subscribe(AppEvent.ResourceUpdate, (payload) => {
      received.push(payload.properties);
    });

    const stop = startResourceMonitor(20);
    await Bun.sleep(60);
    stop();
    unsub();

    expect(received.length).toBeGreaterThan(0);
    expect(received[0]!.memoryMB).toBeGreaterThanOrEqual(0);
    expect(received[0]!.uptime).toBeGreaterThanOrEqual(0);
  });

  test("重复 startResourceMonitor 不应创建多个定时器实例", async () => {
    const received: number[] = [];
    const unsub = globalBus.subscribe(AppEvent.ResourceUpdate, () => {
      received.push(Date.now());
    });

    const stopA = startResourceMonitor(20);
    const stopB = startResourceMonitor(20);
    await Bun.sleep(60);
    stopA();
    stopB();
    unsub();

    expect(received.length).toBeGreaterThan(0);
    expect(received.length).toBeLessThan(10);
  });

  test("setAlertThresholds 更新阈值且 getAlertThresholds 返回副本", () => {
    setAlertThresholds({ cpuPercent: 45, memoryMB: 123 });

    const thresholds = getAlertThresholds();
    expect(thresholds.memoryMB).toBe(123);
    expect(thresholds.cpuPercent).toBe(45);

    thresholds.memoryMB = 999;
    expect(getAlertThresholds().memoryMB).toBe(123);
  });

  test("内存采样生成趋势和统计信息", async () => {
    resetResourceReport();

    expect(getMemoryTrend()).toEqual({ direction: "stable", rate: 0, samples: 0 });

    addMemorySample(100);
    await Bun.sleep(5);
    addMemorySample(140);

    const trend = getMemoryTrend();
    expect(trend.direction).toBe("increasing");
    expect(trend.samples).toBe(2);
    expect(trend.rate).toBeGreaterThan(0);

    const stats = getMemoryStats();
    expect(stats.current).toBe(140);
    expect(stats.min).toBe(100);
    expect(stats.max).toBe(140);
    expect(stats.avg).toBe(120);
  });

  test("资源报告汇总采样、CPU 峰值和告警建议", () => {
    resetResourceReport();

    recordResourceSample(520, 20);
    recordResourceSample(540, 92);
    recordAlert("memory");
    recordAlert("cpu");

    const report = generateResourceReport();
    expect(report.period.durationMs).toBeGreaterThanOrEqual(0);
    expect(report.memory.current).toBe(540);
    expect(report.memory.avg).toBe(530);
    expect(report.memory.alerts).toBe(1);
    expect(report.cpu.current).toBe(92);
    expect(report.cpu.avg).toBe(56);
    expect(report.cpu.max).toBe(92);
    expect(report.cpu.alerts).toBe(1);
    expect(report.summary).toContain("资源使用报告");
    expect(report.recommendations.length).toBeGreaterThanOrEqual(2);
  });

  test("resetResourceReport 清空采样和告警计数", () => {
    recordResourceSample(500, 90);
    recordAlert("memory");
    recordAlert("cpu");

    resetResourceReport();

    const stats = getMemoryStats();
    const report = generateResourceReport();
    expect(stats.min).toBe(0);
    expect(stats.max).toBe(0);
    expect(stats.trend.samples).toBe(0);
    expect(report.memory.alerts).toBe(0);
    expect(report.cpu.alerts).toBe(0);
  });
});
