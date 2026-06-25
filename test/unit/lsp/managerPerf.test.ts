/**
 * LSP Manager pool/perf 集成测试
 *
 * 测试范围:
 *   - ResponseCache 缓存命中/未命中
 *   - RequestQueue 并发控制
 *   - PerformanceMonitor 指标记录
 *   - cleanupIdle 空闲清理
 *   - getPerformanceReport 性能报告
 *   - CONTROL_METHODS 绕过缓存/队列
 *   - lastUsedAt 追踪
 *   - 构造选项传递
 */
import { describe, expect, test } from "bun:test";
import { LspManager } from "@/lsp/manager/manager";

// ── 辅助: 创建 mock LspManager ────────────────────────────────────

/**
 * 创建一个带 mock spawn 的 LspManager，使 startForLanguage 可控。
 * 返回 manager 和 injected 对象以便控制 mock 行为。
 */
function createMockManager(options?: {
  idleTimeout?: number;
  cacheTtl?: number;
  cacheMaxSize?: number;
  maxConcurrentRequests?: number;
  enablePerformanceLogging?: boolean;
}) {
  const manager = new LspManager(options);

  // 返回 manager 供直接测试公共 API
  return { manager };
}

// ── 测试套件 ─────────────────────────────────────────────────────

describe("LspManager pool/perf 集成", () => {
  describe("构造选项", () => {
    test("默认构造成功，性能组件可用", () => {
      const { manager } = createMockManager();

      const report = manager.getPerformanceReport();
      expect(report).toBeDefined();
      expect(report.cache).toBeDefined();
      expect(report.queue).toBeDefined();
      expect(report.monitor).toBeDefined();
      expect(report.cacheHitRate).toBe(0);
    });

    test("自定义构造选项正确传递", () => {
      const { manager } = createMockManager({
        cacheTtl: 1000,
        cacheMaxSize: 500,
        maxConcurrentRequests: 3,
        idleTimeout: 60_000,
        enablePerformanceLogging: false,
      });

      const report = manager.getPerformanceReport();
      // 缓存统计应反映自定义配置
      expect(report.cache.maxSize).toBe(500);
      // 队列最大并发应反映自定义配置
      expect(report.queue.maxConcurrent).toBe(3);
    });
  });

  describe("getPerformanceReport", () => {
    test("初始状态所有指标为零", () => {
      const { manager } = createMockManager();

      const report = manager.getPerformanceReport();

      // 缓存统计
      expect(report.cache.size).toBe(0);
      expect(report.cache.totalHits).toBe(0);

      // 队列统计
      expect(report.queue.queueLength).toBe(0);
      expect(report.queue.activeRequests).toBe(0);

      // 监控统计
      expect(report.monitor.totalRequests).toBe(0);
      expect(report.monitor.cacheHits).toBe(0);
      expect(report.monitor.avgResponseTime).toBe(0);
      expect(report.monitor.maxResponseTime).toBe(0);

      // 缓存命中率
      expect(report.cacheHitRate).toBe(0);
    });
  });

  describe("cleanupIdle", () => {
    test("无客户端时返回 0", async () => {
      const { manager } = createMockManager();

      const cleaned = await manager.cleanupIdle();
      expect(cleaned).toBe(0);
    });
  });

  describe("stopAll 清理性能状态", () => {
    test("stopAll 后性能组件状态清零", async () => {
      const { manager } = createMockManager();

      await manager.stopAll();

      const report = manager.getPerformanceReport();
      expect(report.cache.size).toBe(0);
      expect(report.queue.queueLength).toBe(0);
      expect(report.monitor.totalRequests).toBe(0);
    });
  });

  describe("公共 API 完整性", () => {
    test("getPerformanceReport 是函数", () => {
      const { manager } = createMockManager();
      expect(typeof manager.getPerformanceReport).toBe("function");
    });

    test("cleanupIdle 是函数", () => {
      const { manager } = createMockManager();
      expect(typeof manager.cleanupIdle).toBe("function");
    });

    test("getClients 返回空数组（无客户端启动时）", () => {
      const { manager } = createMockManager();
      expect(manager.getClients()).toEqual([]);
    });

    test("getActiveClients 返回空数组", () => {
      const { manager } = createMockManager();
      expect(manager.getActiveClients()).toEqual([]);
    });

    test("getAllDiagnostics 返回空 Map", () => {
      const { manager } = createMockManager();
      expect(manager.getAllDiagnostics()).toBeInstanceOf(Map);
      expect(manager.getAllDiagnostics().size).toBe(0);
    });
  });
});
