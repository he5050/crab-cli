/**
 * LSP 性能优化测试 — 缓存、队列、性能监控。
 *
 * 测试用例:
 *   - ResponseCache 类结构
 *   - 缓存存取和过期
 *   - 缓存淘汰策略
 *   - RequestQueue 类结构
 *   - 请求队列和并发控制
 *   - PerformanceMonitor 类结构
 *   - 性能指标记录
 *   - 缓存命中率计算
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  PerformanceMonitor,
  RequestQueue,
  ResponseCache,
  createPerformanceCache,
  createPerformanceMonitor,
  createRequestQueue,
} from "@/lsp/perf/performance";

describe("ResponseCache", () => {
  let cache: ResponseCache<string>;

  beforeEach(() => {
    cache = new ResponseCache({
      enableLogging: false,
      maxSize: 5,
      ttl: 1000, // 1 秒,
    });
  });

  afterEach(() => {
    cache.clear();
  });

  describe("ResponseCache 类结构", () => {
    test("ResponseCache 类存在", () => {
      expect(ResponseCache).toBeDefined();
    });

    test("创建缓存实例", () => {
      const c = new ResponseCache();
      expect(c).toBeInstanceOf(ResponseCache);
    });

    test("getStats 返回统计信息", () => {
      const stats = cache.getStats();
      expect(stats).toHaveProperty("size");
      expect(stats).toHaveProperty("maxSize");
      expect(stats).toHaveProperty("ttl");
      expect(stats).toHaveProperty("totalHits");
    });

    test("初始统计信息正确", () => {
      const stats = cache.getStats();
      expect(stats.size).toBe(0);
      expect(stats.maxSize).toBe(5);
      expect(stats.ttl).toBe(1000);
      expect(stats.totalHits).toBe(0);
    });
  });

  describe("缓存存取", () => {
    test("get 缓存未命中返回 null", () => {
      const result = cache.get("test", { key: "value" });
      expect(result).toBeNull();
    });

    test("set 和 get 缓存命中", () => {
      cache.set("test", { key: "value" }, "result");

      const result = cache.get("test", { key: "value" });
      expect(result).toBe("result");
    });

    test("缓存过期后返回 null", async () => {
      cache.set("test", { key: "value" }, "result");

      // 等待过期
      await new Promise((resolve) => setTimeout(resolve, 1200));

      const result = cache.get("test", { key: "value" });
      expect(result).toBeNull();
    });

    test("缓存未过期时可以命中", async () => {
      cache.set("test", { key: "value" }, "result");

      // 等待但未过期
      await new Promise((resolve) => setTimeout(resolve, 500));

      const result = cache.get("test", { key: "value" });
      expect(result).toBe("result");
    });

    test("不同参数生成不同缓存键", () => {
      cache.set("test", { key: "value1" }, "result1");
      cache.set("test", { key: "value2" }, "result2");

      expect(cache.get("test", { key: "value1" })).toBe("result1");
      expect(cache.get("test", { key: "value2" })).toBe("result2");
    });
  });

  describe("缓存淘汰策略", () => {
    test("超过 maxSize 时淘汰最老的缓存", () => {
      const maxSize = 5;

      // 填满缓存
      for (let i = 0; i < maxSize; i++) {
        cache.set("test", { key: `value${i}` }, `result${i}`);
      }

      expect(cache.getStats().size).toBe(5);

      // 添加第 6 个，应该淘汰最老的
      cache.set("test", { key: "value5" }, "result5");

      expect(cache.getStats().size).toBe(5);
      expect(cache.get("test", { key: "value0" })).toBeNull(); // 最老的被淘汰
      expect(cache.get("test", { key: "value5" })).toBe("result5"); // 新的可以访问
    });

    test("cleanup 清理过期缓存", async () => {
      cache.set("test", { key: "value1" }, "result1");
      cache.set("test", { key: "value2" }, "result2");

      // 等待过期
      await new Promise((resolve) => setTimeout(resolve, 1200));

      const cleaned = cache.cleanup();
      expect(cleaned).toBe(2);
      expect(cache.getStats().size).toBe(0);
    });

    test("cleanup 只清理过期缓存", async () => {
      cache.set("test", { key: "value1" }, "result1");

      // 等待一段时间但不过期
      await new Promise((resolve) => setTimeout(resolve, 500));

      cache.set("test", { key: "value2" }, "result2");

      const cleaned = cache.cleanup();
      expect(cache.getStats().size).toBe(2); // 都未过期
    });
  });

  describe("缓存命中统计", () => {
    test("记录缓存命中次数", () => {
      cache.set("test", { key: "value" }, "result");

      cache.get("test", { key: "value" });
      cache.get("test", { key: "value" });
      cache.get("test", { key: "value" });

      const stats = cache.getStats();
      expect(stats.totalHits).toBe(3);
    });

    test("未命中不计入统计", () => {
      cache.get("test", { key: "value" });

      const stats = cache.getStats();
      expect(stats.totalHits).toBe(0);
    });
  });

  describe("便捷函数", () => {
    test("createPerformanceCache 创建缓存", () => {
      const c = createPerformanceCache<string>({
        enableLogging: false,
        maxSize: 10,
        ttl: 2000,
      });

      expect(c).toBeInstanceOf(ResponseCache);
      expect(c.getStats().ttl).toBe(2000);
      expect(c.getStats().maxSize).toBe(10);
    });
  });
});

describe("RequestQueue", () => {
  let queue: RequestQueue;

  beforeEach(() => {
    queue = new RequestQueue({
      enableLogging: false,
      maxConcurrent: 2,
    });
  });

  afterEach(() => {
    queue.clear();
  });

  describe("RequestQueue 类结构", () => {
    test("RequestQueue 类存在", () => {
      expect(RequestQueue).toBeDefined();
    });

    test("创建队列实例", () => {
      const q = new RequestQueue();
      expect(q).toBeInstanceOf(RequestQueue);
    });

    test("getStats 返回统计信息", () => {
      const stats = queue.getStats();
      expect(stats).toHaveProperty("queueLength");
      expect(stats).toHaveProperty("activeRequests");
      expect(stats).toHaveProperty("maxConcurrent");
    });

    test("初始统计信息正确", () => {
      const stats = queue.getStats();
      expect(stats.queueLength).toBe(0);
      expect(stats.activeRequests).toBe(0);
      expect(stats.maxConcurrent).toBe(2);
    });
  });

  describe("请求队列和并发控制", () => {
    test("并发请求限制", async () => {
      let activeCount = 0;
      let maxActiveCount = 0;

      const createTask = () => async () => {
        activeCount++;
        maxActiveCount = Math.max(maxActiveCount, activeCount);

        // 模拟异步操作
        await new Promise((resolve) => setTimeout(resolve, 100));

        activeCount--;
        return "done";
      };

      // 添加 5 个任务
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(queue.add(createTask()));
      }

      await Promise.all(promises);

      expect(maxActiveCount).toBe(2); // 最多 2 个并发
    });

    test("任务按顺序执行", async () => {
      const executionOrder: number[] = [];

      const createTask = (id: number) => async () => {
        executionOrder.push(id);
        await new Promise((resolve) => setTimeout(resolve, 10));
        return id;
      };

      // 添加任务
      const promises = [];
      for (let i = 0; i < 3; i++) {
        promises.push(queue.add(createTask(i)));
      }

      await Promise.all(promises);

      // 验证任务被执行
      expect(executionOrder.length).toBe(3);
      expect(executionOrder).toContain(0);
      expect(executionOrder).toContain(1);
      expect(executionOrder).toContain(2);
    });

    test("请求错误处理", async () => {
      const errorTask = async () => {
        throw new Error("Task failed");
      };

      await expect(queue.add(errorTask)).rejects.toThrow("Task failed");
    });

    test("getStats 反映当前状态", async () => {
      const slowTask = async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return "done";
      };

      // 添加任务
      const promise = queue.add(slowTask);

      // 等待任务开始
      await new Promise((resolve) => setTimeout(resolve, 10));

      const stats = queue.getStats();
      expect(stats.activeRequests).toBe(1);

      await promise;
    });
  });

  describe("队列管理", () => {
    test("clear 清空队列", () => {
      queue.clear();

      const stats = queue.getStats();
      expect(stats.queueLength).toBe(0);
    });
  });

  describe("便捷函数", () => {
    test("createRequestQueue 创建队列", () => {
      const q = createRequestQueue({
        enableLogging: false,
        maxConcurrent: 5,
      });

      expect(q).toBeInstanceOf(RequestQueue);
      expect(q.getStats().maxConcurrent).toBe(5);
    });
  });
});

describe("PerformanceMonitor", () => {
  let monitor: PerformanceMonitor;

  beforeEach(() => {
    monitor = new PerformanceMonitor({
      enableLogging: false,
    });
  });

  afterEach(() => {
    monitor.reset();
  });

  describe("PerformanceMonitor 类结构", () => {
    test("PerformanceMonitor 类存在", () => {
      expect(PerformanceMonitor).toBeDefined();
    });

    test("创建监控器实例", () => {
      const m = new PerformanceMonitor();
      expect(m).toBeInstanceOf(PerformanceMonitor);
    });

    test("getMetrics 返回性能指标", () => {
      const metrics = monitor.getMetrics();
      expect(metrics).toHaveProperty("totalRequests");
      expect(metrics).toHaveProperty("cacheHits");
      expect(metrics).toHaveProperty("avgResponseTime");
      expect(metrics).toHaveProperty("maxResponseTime");
      expect(metrics).toHaveProperty("avgQueueTime");
    });

    test("初始指标正确", () => {
      const metrics = monitor.getMetrics();
      expect(metrics.totalRequests).toBe(0);
      expect(metrics.cacheHits).toBe(0);
      expect(metrics.avgResponseTime).toBe(0);
      expect(metrics.maxResponseTime).toBe(0);
      expect(metrics.avgQueueTime).toBe(0);
    });
  });

  describe("性能指标记录", () => {
    test("startRequest 和 endRequest 记录请求", () => {
      const requestId = "req-1";
      monitor.startRequest(requestId, "completion");

      const responseTime = monitor.endRequest(requestId, false);

      expect(responseTime).toBeGreaterThanOrEqual(0);

      const metrics = monitor.getMetrics();
      expect(metrics.totalRequests).toBe(1);
    });

    test("endRequest 返回响应时间", async () => {
      const requestId = "req-1";
      monitor.startRequest(requestId, "completion");

      // 模拟处理时间
      await new Promise((resolve) => setTimeout(resolve, 50));

      const responseTime = monitor.endRequest(requestId, false);

      expect(responseTime).toBeGreaterThanOrEqual(50);
    });

    test("recordCacheHit 增加缓存命中数", () => {
      monitor.recordCacheHit();
      monitor.recordCacheHit();

      const metrics = monitor.getMetrics();
      expect(metrics.cacheHits).toBe(2);
    });

    test("endRequest 记录缓存命中", () => {
      const requestId = "req-1";
      monitor.startRequest(requestId, "completion");

      monitor.endRequest(requestId, true);

      const metrics = monitor.getMetrics();
      expect(metrics.cacheHits).toBe(1);
    });

    test("maxResponseTime 正确更新", async () => {
      const requestId1 = "req-1";
      const requestId2 = "req-2";

      monitor.startRequest(requestId1, "completion");
      await new Promise((resolve) => setTimeout(resolve, 50));
      monitor.endRequest(requestId1, false);

      monitor.startRequest(requestId2, "completion");
      await new Promise((resolve) => setTimeout(resolve, 100));
      monitor.endRequest(requestId2, false);

      const metrics = monitor.getMetrics();
      expect(metrics.maxResponseTime).toBeGreaterThanOrEqual(100);
    });
  });

  describe("缓存命中率计算", () => {
    test("getCacheHitRate 计算命中率", () => {
      monitor.startRequest("req-1", "completion");
      monitor.endRequest("req-1", true); // 缓存命中

      monitor.startRequest("req-2", "completion");
      monitor.endRequest("req-2", false); // 未命中

      const hitRate = monitor.getCacheHitRate();
      expect(hitRate).toBeCloseTo(0.5, 1);
    });

    test("无请求时命中率为 0", () => {
      const hitRate = monitor.getCacheHitRate();
      expect(hitRate).toBe(0);
    });

    test("全部命中时命中率为 1", () => {
      monitor.startRequest("req-1", "completion");
      monitor.endRequest("req-1", true);

      monitor.startRequest("req-2", "completion");
      monitor.endRequest("req-2", true);

      const hitRate = monitor.getCacheHitRate();
      expect(hitRate).toBe(1);
    });
  });

  describe("性能报告", () => {
    test("printReport 打印报告", () => {
      monitor.startRequest("req-1", "completion");
      monitor.endRequest("req-1", true);

      // 不抛出错误即为成功
      expect(() => monitor.printReport()).not.toThrow();
    });

    test("reset 重置指标", () => {
      monitor.startRequest("req-1", "completion");
      monitor.endRequest("req-1", false);

      monitor.reset();

      const metrics = monitor.getMetrics();
      expect(metrics.totalRequests).toBe(0);
      expect(metrics.cacheHits).toBe(0);
    });
  });

  describe("便捷函数", () => {
    test("createPerformanceMonitor 创建监控器", () => {
      const m = createPerformanceMonitor({
        enableLogging: false,
      });

      expect(m).toBeInstanceOf(PerformanceMonitor);
    });
  });
});
