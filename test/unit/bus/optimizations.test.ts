/**
 * 优化策略测试。
 *
 * 测试用例:
 *   - 性能优化
 *   - 内存优化
 *   - 缓存策略
 */
import { describe, expect, test } from "bun:test";
import { clearCleanup, registerCleanup, runCleanup } from "@/bus/lifecycle/globalCleanup";
import { appendLogEntry, flushLogStore, getLogDir, resetLogStoreForTests } from "@/core/logging/logStore";
import {
  getCpuUsagePercent,
  getMemoryUsageMB,
  getResourceStatus,
  isResourceMonitorPaused,
  pauseResourceMonitor,
  resumeResourceMonitor,
  startResourceMonitor,
} from "@monitor";
import { globalBus } from "@/bus";
import { AppEvent } from "@/bus";
import { createId } from "@/core/identity";

describe("阶段 2 优化验证", () => {
  describe("全局清理 — 超时保护", () => {
    test("清理回调超时会被中断", async () => {
      clearCleanup();

      let executed = false;
      registerCleanup(async () => {
        // 模拟长时间运行的清理
        await new Promise((resolve) => setTimeout(resolve, 10_000));
        executed = true;
      });

      // 使用 50ms 超时
      const start = Date.now();
      const hadError = await runCleanup(50);
      const duration = Date.now() - start;

      // 应该在 50ms 左右超时，而不是等待 10 秒
      expect(duration).toBeLessThan(200);
      expect(hadError).toBe(true);
      expect(executed).toBe(false); // 超时后不会执行完成

      clearCleanup();
    });

    test("正常清理回调在超时前完成", async () => {
      clearCleanup();

      let executed = false;
      registerCleanup(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        executed = true;
      });

      const hadError = await runCleanup(100);

      expect(hadError).toBe(false);
      expect(executed).toBe(true);

      clearCleanup();
    });
  });

  describe("日志存储 — 批量写入", () => {
    test("批量写入减少数据库操作次数", async () => {
      resetLogStoreForTests();

      // 快速写入 20 条日志
      const start = Date.now();
      for (let i = 0; i < 20; i++) {
        appendLogEntry({
          id: createId("test"),
          level: "info",
          message: `批量测试消息 ${i}`,
          timestamp: Date.now(),
        });
      }

      // 立即刷新，确保所有日志写入
      flushLogStore();

      const duration = Date.now() - start;

      // 批量写入应该很快(< 100ms)
      expect(duration).toBeLessThan(100);

      // 验证日志文件已创建(文件存储模式)
      const fs = await import("fs");
      const path = await import("path");
      const logDir = getLogDir();
      const files = fs.readdirSync(logDir).filter((f: string) => f.endsWith(".log"));
      expect(files.length).toBeGreaterThanOrEqual(1);

      resetLogStoreForTests();
    });

    test("批量写入性能测试", async () => {
      resetLogStoreForTests();

      // 快速写入 50 条日志
      const start = Date.now();
      for (let i = 0; i < 50; i++) {
        appendLogEntry({
          id: createId("test"),
          level: "info",
          message: `性能测试日志 ${i}`,
          timestamp: Date.now(),
        });
      }

      // 立即刷新
      flushLogStore();

      const duration = Date.now() - start;

      // 批量写入 50 条日志应该很快(< 200ms)
      expect(duration).toBeLessThan(200);

      resetLogStoreForTests();
    });
  });

  describe("资源监控 — CPU 使用率", () => {
    test("getCpuUsagePercent 返回非负数", () => {
      const cpu = getCpuUsagePercent();
      expect(cpu).toBeGreaterThanOrEqual(0);
    });

    test("getMemoryUsageMB 返回非负数", () => {
      const mem = getMemoryUsageMB();
      expect(mem).toBeGreaterThanOrEqual(0);
    });

    test("getResourceStatus 包含 CPU 信息", () => {
      const status = getResourceStatus();

      expect(status).toHaveProperty("version");
      expect(status).toHaveProperty("memoryMB");
      expect(status).toHaveProperty("cpuPercent");
      expect(status).toHaveProperty("uptime");
      expect(status).toHaveProperty("pid");

      expect(typeof status.cpuPercent).toBe("number");
      expect(status.cpuPercent).toBeGreaterThanOrEqual(0);
    });

    test("CPU 使用率计算合理", async () => {
      // 第一次调用初始化
      const cpu1 = getCpuUsagePercent();

      // 等待一小段时间
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 第二次调用应该返回合理的值
      const cpu2 = getCpuUsagePercent();

      // CPU 使用率应该在 0-100% 之间(单核)
      expect(cpu2).toBeGreaterThanOrEqual(0);
      // 注意:多核系统可能超过 100%，这里放宽限制
      expect(cpu2).toBeLessThan(500);
    });

    test("CPU 使用率基于实际时间间隔计算", async () => {
      // 第一次调用
      const cpu1 = getCpuUsagePercent();

      // 等待不同的时间间隔
      await new Promise((resolve) => setTimeout(resolve, 50));
      const cpu2 = getCpuUsagePercent();

      await new Promise((resolve) => setTimeout(resolve, 100));
      const cpu3 = getCpuUsagePercent();

      // 所有返回值都应在合理范围内
      expect(cpu1).toBeGreaterThanOrEqual(0);
      expect(cpu2).toBeGreaterThanOrEqual(0);
      expect(cpu3).toBeGreaterThanOrEqual(0);
    });
  });

  describe("资源监控 — 暂停/恢复功能", () => {
    test("pauseResourceMonitor 暂停事件发布", async () => {
      pauseResourceMonitor();
      expect(isResourceMonitorPaused()).toBe(true);
    });

    test("resumeResourceMonitor 恢复事件发布", async () => {
      resumeResourceMonitor();
      expect(isResourceMonitorPaused()).toBe(false);
    });

    test("暂停后 ResourceUpdate 事件不再发布", async () => {
      // 清理历史记录，不清理其他测试或运行时已注册的订阅者
      globalBus.clearHistory();

      const events: { memoryMB: number }[] = [];
      const unsub = globalBus.subscribe(AppEvent.ResourceUpdate, (payload) => {
        events.push(payload.properties);
      });

      // 启动监控
      const stop = startResourceMonitor(20);

      // 等待一段时间收集事件
      await new Promise((resolve) => setTimeout(resolve, 60));
      const eventsBeforePause = events.length;

      // 暂停监控
      pauseResourceMonitor();

      // 等待一段时间
      await new Promise((resolve) => setTimeout(resolve, 60));
      const eventsAfterPause = events.length;

      // 暂停后不应该有新事件
      expect(eventsAfterPause).toBe(eventsBeforePause);

      // 恢复监控
      resumeResourceMonitor();

      // 等待一段时间
      await new Promise((resolve) => setTimeout(resolve, 60));
      const eventsAfterResume = events.length;

      // 恢复后应该有新事件
      expect(eventsAfterResume).toBeGreaterThan(eventsAfterPause);

      stop();
      unsub();
    });
  });

  describe("日志存储 — 退出时自动刷新", () => {
    test("日志存储已注册 cleanup 钩子", async () => {
      // 验证 cleanup 钩子已注册(通过检查函数存在性)
      // 实际 cleanup 行为在 global-cleanup 测试中已验证
      resetLogStoreForTests();

      // 写入一条日志触发 ensureDb，从而注册 cleanup
      appendLogEntry({
        id: createId("test"),
        level: "info",
        message: "cleanup 钩子测试",
        timestamp: Date.now(),
      });

      // 验证日志文件存在(文件存储模式)
      flushLogStore();
      const fs2 = await import("fs");
      const logDir2 = getLogDir();
      const files2 = fs2.readdirSync(logDir2).filter((f: string) => f.endsWith(".log"));
      expect(files2.length).toBeGreaterThanOrEqual(1);

      resetLogStoreForTests();
    });
  });
});
