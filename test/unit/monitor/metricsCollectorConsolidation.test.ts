/**
 * Monitor 模块 barrel 导入守卫测试。
 *
 * 目标:
 *   1. 静态扫描: src/monitor/ 外部不应直接导入子模块（应统一使用 @monitor barrel）
 *   2. 运行时: @monitor barrel 导出所有关键 API 且行为一致
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC_ROOT = join(import.meta.dir, "..", "..", "..", "src");

/** 递归列出 src/ 下所有 .ts 文件 */
function listTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) {
      listTsFiles(p, acc);
    } else if (entry.endsWith(".ts")) {
      acc.push(p);
    }
  }
  return acc;
}

describe("Monitor barrel 导入守卫", () => {
  test("静态扫描 — src/ 下非 monitor 模块不应直接导入 monitor 子模块", () => {
    const allTs = listTsFiles(SRC_ROOT);
    const offenders: string[] = [];
    const fs = require("node:fs");

    for (const file of allTs) {
      // 跳过 monitor 内部文件
      if (file.includes("src/monitor/")) {
        continue;
      }
      // 跳过测试文件（测试可以灵活导入）
      if (file.includes("test/")) {
        continue;
      }
      const content = fs.readFileSync(file, "utf-8");
      // 检测直接引用 monitor 子模块的模式（排除 @monitor barrel）
      const directImports = [
        /from\s+["']@\/monitor\/(?!index["'])(?:metricsCollector|telemetry|timing|resource|shared)["'][^"']*["']/g,
      ];
      for (const pattern of directImports) {
        const matches = content.match(pattern);
        if (matches) {
          offenders.push(`${file}: ${matches.join(", ")}`);
        }
      }
    }
    if (offenders.length > 0) {
      console.error(`发现直接导入 monitor 子模块的文件:\n  ${offenders.join("\n  ")}`);
    }
    expect(offenders).toEqual([]);
  });

  test("静态导入 — @monitor barrel 导出 timing 关键 API", async () => {
    const mod = await import("@monitor");
    expect(mod.PerformanceMonitor).toBeDefined();
    expect(typeof mod.PerformanceMonitor).toBe("function");
    expect(mod.performanceMonitor).toBeDefined();
    expect(mod.performanceMonitor).toBeInstanceOf(mod.PerformanceMonitor);
    expect(typeof mod.measurePerformance).toBe("function");
  });

  test("静态导入 — @monitor barrel 导出 dashboard 关键 API", async () => {
    const mod = await import("@monitor");
    expect(mod.PerformanceDashboard).toBeDefined();
    expect(typeof mod.PerformanceDashboard).toBe("function");
    expect(typeof mod.getGlobalDashboard).toBe("function");
    expect(typeof mod.createPerformanceDashboard).toBe("function");
    expect(typeof mod.createMemoryAlertRule).toBe("function");
    expect(typeof mod.createCpuAlertRule).toBe("function");
  });

  test("静态导入 — @monitor barrel 导出 resource 关键 API", async () => {
    const mod = await import("@monitor");
    expect(typeof mod.getMemoryUsageMB).toBe("function");
    expect(typeof mod.getCpuUsagePercent).toBe("function");
    expect(typeof mod.startResourceMonitor).toBe("function");
    expect(typeof mod.pauseResourceMonitor).toBe("function");
    expect(typeof mod.resumeResourceMonitor).toBe("function");
    expect(typeof mod.isResourceMonitorPaused).toBe("function");
    expect(typeof mod.getUptime).toBe("function");
    expect(typeof mod.getResourceStatus).toBe("function");
    expect(typeof mod.setAlertThresholds).toBe("function");
    expect(typeof mod.getAlertThresholds).toBe("function");
    expect(typeof mod.addMemorySample).toBe("function");
    expect(typeof mod.getMemoryTrend).toBe("function");
    expect(typeof mod.getMemoryStats).toBe("function");
    expect(typeof mod.recordResourceSample).toBe("function");
    expect(typeof mod.generateResourceReport).toBe("function");
    expect(typeof mod.resetResourceReport).toBe("function");
    expect(typeof mod.recordAlert).toBe("function");
  });

  test("静态导入 — @monitor barrel 导出 telemetry 关键 API", async () => {
    const mod = await import("@monitor");
    expect(typeof mod.initTelemetry).toBe("function");
    expect(typeof mod.shutdownTelemetry).toBe("function");
    expect(typeof mod.getTracer).toBe("function");
    expect(typeof mod.getMeter).toBe("function");
    expect(typeof mod.getLogger).toBe("function");
    expect(typeof mod.withSpan).toBe("function");
    expect(typeof mod.recordChatBusinessTelemetry).toBe("function");
    expect(typeof mod.recordToolBusinessTelemetry).toBe("function");
    expect(typeof mod.recordSearchBusinessTelemetry).toBe("function");
    expect(typeof mod.recordCompressionBusinessTelemetry).toBe("function");
    expect(typeof mod.renderPrometheusMetrics).toBe("function");
  });

  test("静态导入 — @monitor barrel 导出 metrics 关键 API", async () => {
    const mod = await import("@monitor");
    expect(typeof mod.collectMetrics).toBe("function");
    // collect 别名已移除，不应存在
    expect((mod as Record<string, unknown>).collect).toBeUndefined();
  });

  test("运行时 — barrel 导出的 API 行为一致", async () => {
    const mod = await import("@monitor");

    // PerformanceMonitor: start/end 仍可工作
    const id = mod.performanceMonitor.start("api", "guard-test");
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    const metric = mod.performanceMonitor.end(id, true);
    expect(metric).not.toBeNull();
    expect(metric!.type).toBe("api");
    expect(metric!.name).toBe("guard-test");

    // PerformanceDashboard: getGlobalDashboard 仍返回单例
    const d1 = mod.getGlobalDashboard();
    const d2 = mod.getGlobalDashboard();
    expect(d1).toBe(d2);

    // ResourceMonitor: 资源读取函数返回数值
    expect(mod.getMemoryUsageMB()).toBeGreaterThanOrEqual(0);
    expect(mod.getCpuUsagePercent()).toBeGreaterThanOrEqual(0);
    expect(mod.getUptime()).toBeGreaterThanOrEqual(0);
  });
});
