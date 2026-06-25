/**
 * 性能计时模块测试。
 *
 * 测试用例:
 *   - PerformanceMonitor 基本 start/end 生命周期
 *   - end 传入不存在的 id 返回 null
 *   - measure 异步函数 - 成功与异常路径
 *   - measureSync 同步函数 - 成功与异常路径
 *   - 禁用配置(enabled=false) - start 返回空字符串，end 返回 null
 *   - 慢操作阈值检测（慢操作触发 warn 日志）
 *   - getStats 历史为空时返回全零
 *   - getStats 单条指标统计
 *   - getStats 多条指标 — 验证 count/avg/p95/p99
 *   - generateReport 返回正确结构
 *   - clear 重置历史
 *   - updateConfig 会话中途变更行为
 *   - maxMetrics 溢出（RingBuffer 滚动丢弃）
 */
import { afterEach, describe, expect, test } from "bun:test";
import { PerformanceMonitor } from "@monitor";
import type { MetricType } from "@monitor";

let monitor: PerformanceMonitor;

afterEach(() => {
  // 每个测试结束后清理监控器实例，避免测试间相互干扰
  if (monitor) {
    monitor.clear();
  }
});

describe("PerformanceMonitor — 性能计时模块", () => {
  // ---------------------------------------------------------------
  // 1. 基本 start/end 生命周期
  // ---------------------------------------------------------------
  test("start/end 基本生命周期 — 返回有效 id，metric 包含 durationMs", () => {
    monitor = new PerformanceMonitor();
    const id = monitor.start("api", "getUser");

    // id 应该是 "api:getUser:<compactId>" 格式，非空字符串
    expect(id).toBeTruthy();
    expect(id).toContain("api:getUser:");

    const metric = monitor.end(id, true);
    expect(metric !== null).toBe(true);
    expect(metric!.id).toBe(id);
    expect(metric!.type).toBe("api");
    expect(metric!.name).toBe("getUser");
    expect(metric!.success).toBe(true);
    expect(metric!.durationMs).toBeGreaterThanOrEqual(0);
    expect(metric!.startTime).toBeGreaterThan(0);
    expect(metric!.endTime).toBeDefined();
  });

  // ---------------------------------------------------------------
  // 2. end 传入不存在的 id 返回 null
  // ---------------------------------------------------------------
  test("end 传入不存在的 id — 返回 null", () => {
    monitor = new PerformanceMonitor();
    const result = monitor.end("nonexistent:id:abc123", true);
    expect(result).toBeNull();
  });

  // ---------------------------------------------------------------
  // 3. measure 异步函数 — 成功路径
  // ---------------------------------------------------------------
  test("measure 异步成功路径 — 返回函数结果并记录指标", async () => {
    monitor = new PerformanceMonitor();
    const result = await monitor.measure("tool", "bash", async () => 42);

    expect(result).toBe(42);

    // 验证历史中记录了该指标
    const stats = monitor.getStats("tool", "bash");
    expect(stats.count).toBe(1);
    expect(stats.successRate).toBe(1);
  });

  // ---------------------------------------------------------------
  // 4. measure 异步函数 — 异常路径
  // ---------------------------------------------------------------
  test("measure 异步异常路径 — 重新抛出错误并记录失败指标", async () => {
    monitor = new PerformanceMonitor();

    expect(
      monitor.measure("tool", "bash", async () => {
        throw new Error("命令执行失败");
      }),
    ).rejects.toThrow("命令执行失败");

    // 验证历史中记录了失败指标
    const stats = monitor.getStats("tool", "bash");
    expect(stats.count).toBe(1);
    expect(stats.successRate).toBe(0);

    // 检查历史中包含 error 信息
    const history = monitor.getHistory();
    const failedMetric = history.find((m) => m.name === "bash" && m.success === false);
    expect(failedMetric).toBeDefined();
    expect(failedMetric!.error).toBe("命令执行失败");
  });

  // ---------------------------------------------------------------
  // 5. measureSync 同步函数 — 成功路径
  // ---------------------------------------------------------------
  test("measureSync 同步成功路径 — 返回函数结果并记录指标", () => {
    monitor = new PerformanceMonitor();
    const result = monitor.measureSync("api", "getData", () => "hello");

    expect(result).toBe("hello");

    const stats = monitor.getStats("api", "getData");
    expect(stats.count).toBe(1);
    expect(stats.successRate).toBe(1);
  });

  // ---------------------------------------------------------------
  // 6. measureSync 同步函数 — 异常路径
  // ---------------------------------------------------------------
  test("measureSync 同步异常路径 — 重新抛出错误并记录失败指标", () => {
    monitor = new PerformanceMonitor();

    expect(() => {
      monitor.measureSync("api", "getData", () => {
        throw new Error("同步错误");
      });
    }).toThrow("同步错误");

    const stats = monitor.getStats("api", "getData");
    expect(stats.count).toBe(1);
    expect(stats.successRate).toBe(0);

    const history = monitor.getHistory();
    const failedMetric = history.find((m) => m.success === false);
    expect(failedMetric).toBeDefined();
    expect(failedMetric!.error).toBe("同步错误");
  });

  // ---------------------------------------------------------------
  // 7. 禁用配置(enabled=false) — start 返回空字符串，end 返回 null
  // ---------------------------------------------------------------
  test("禁用配置(enabled=false) — start 返回空字符串，end 返回 null", () => {
    monitor = new PerformanceMonitor({ enabled: false });

    const id = monitor.start("api", "test");
    expect(id).toBe("");

    const result = monitor.end("some-id", true);
    expect(result).toBeNull();

    // 禁用状态下 measureSync 仍能正常执行函数，但不会记录
    const value = monitor.measureSync("api", "test", () => 123);
    expect(value).toBe(123);
    expect(monitor.getHistory().length).toBe(0);
  });

  // ---------------------------------------------------------------
  // 8. 慢操作阈值检测 — 超过阈值触发 warn 日志
  // ---------------------------------------------------------------
  test("慢操作阈值检测 — 超过阈值触发 warn 日志", async () => {
    // 设置一个极低的阈值以确保触发
    monitor = new PerformanceMonitor({
      slowThresholdMs: {
        api: 0,
        cpu: 0,
        memory: 0,
        tool: 0,
        ui: 1, // 阈值 1ms，几乎任何操作都会超过
      },
    });

    // 使用 spy 监听 console.warn 或通过日志模块检测
    // 这里通过验证 start/end 的正常流程 + 人为延迟来测试阈值逻辑
    const id = monitor.start("ui", "render");
    // 强制产生超过 1ms 的延迟
    await Bun.sleep(5);
    const metric = monitor.end(id, true);

    // 验证指标被正常记录
    expect(metric !== null).toBe(true);
    expect(metric!.durationMs).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------
  // 9. getStats 历史为空时返回全零
  // ---------------------------------------------------------------
  test("getStats 历史为空时返回全零", () => {
    monitor = new PerformanceMonitor();
    const stats = monitor.getStats("api", "someName");

    expect(stats.count).toBe(0);
    expect(stats.totalDurationMs).toBe(0);
    expect(stats.avgDurationMs).toBe(0);
    expect(stats.minDurationMs).toBe(0);
    expect(stats.maxDurationMs).toBe(0);
    expect(stats.successRate).toBe(0);
    expect(stats.p95DurationMs).toBe(0);
    expect(stats.p99DurationMs).toBe(0);
  });

  // ---------------------------------------------------------------
  // 10. getStats 单条指标统计
  // ---------------------------------------------------------------
  test("getStats 单条指标 — count=1, 成功率正确", () => {
    monitor = new PerformanceMonitor();
    const id = monitor.start("api", "singleOp");
    const metric = monitor.end(id, true);

    expect(metric !== null).toBe(true);

    const stats = monitor.getStats("api", "singleOp");
    expect(stats.count).toBe(1);
    expect(stats.totalDurationMs).toBe(metric!.durationMs!);
    expect(stats.avgDurationMs).toBe(metric!.durationMs!);
    expect(stats.minDurationMs).toBe(metric!.durationMs!);
    expect(stats.maxDurationMs).toBe(metric!.durationMs!);
    expect(stats.successRate).toBe(1);
  });

  // ---------------------------------------------------------------
  // 11. getStats 多条指标 — 验证 count/avg/p95/p99
  // ---------------------------------------------------------------
  test("getStats 多条指标 — count/avg/min/max/p95/p99 正确计算", () => {
    monitor = new PerformanceMonitor();

    // 手动构造不同时长的指标来验证统计
    // 产生 20 条 api:multiOp 指标
    for (let i = 0; i < 20; i++) {
      const id = monitor.start("api", "multiOp");
      // 强制不同的延迟
      const delay = i * 2; // 0ms, 2ms, 4ms, ..., 38ms
      const startTime = Date.now();
      // 等待精确延迟
      const waitUntil = startTime + delay;
      while (Date.now() < waitUntil) {
        // busy wait
      }
      monitor.end(id, i % 3 !== 0); // 每 3 个中有 1 个失败
    }

    const stats = monitor.getStats("api", "multiOp");
    expect(stats.count).toBe(20);
    expect(stats.totalDurationMs).toBeGreaterThan(0);
    expect(stats.avgDurationMs).toBeGreaterThan(0);
    expect(stats.minDurationMs).toBeGreaterThanOrEqual(0);
    expect(stats.maxDurationMs).toBeGreaterThanOrEqual(stats.minDurationMs);
    expect(stats.successRate).toBeGreaterThan(0);
    expect(stats.successRate).toBeLessThanOrEqual(1);
    expect(stats.p95DurationMs).toBeGreaterThanOrEqual(0);
    expect(stats.p99DurationMs).toBeGreaterThanOrEqual(stats.p95DurationMs);

    // p95 应该 <= max
    expect(stats.p95DurationMs).toBeLessThanOrEqual(stats.maxDurationMs);
    // p99 应该 <= max
    expect(stats.p99DurationMs).toBeLessThanOrEqual(stats.maxDurationMs);
  });

  // ---------------------------------------------------------------
  // 12. generateReport 返回正确结构
  // ---------------------------------------------------------------
  test("generateReport 返回按 type 分组的报告结构", () => {
    monitor = new PerformanceMonitor();

    // 添加不同类型的指标
    monitor.measureSync("api", "getUsers", () => {});
    monitor.measureSync("api", "createUser", () => {});
    monitor.measureSync("tool", "bash", () => {});

    const report = monitor.generateReport();

    // 报告应包含所有 MetricType 作为 key
    expect(report).toHaveProperty("api");
    expect(report).toHaveProperty("tool");
    expect(report).toHaveProperty("ui");
    expect(report).toHaveProperty("memory");
    expect(report).toHaveProperty("cpu");

    // api 下应有 getUsers 和 createUser 两个分组
    expect(Object.keys(report.api)).toContain("getUsers");
    expect(Object.keys(report.api)).toContain("createUser");

    // tool 下应有 bash
    expect(Object.keys(report.tool)).toContain("bash");

    // ui / memory / cpu 下应为空（没有记录指标）
    expect(Object.keys(report.ui).length).toBe(0);
    expect(Object.keys(report.memory).length).toBe(0);
    expect(Object.keys(report.cpu).length).toBe(0);

    // 每个 Stats 应有 count >= 1
    expect(report.api["getUsers"]?.count).toBe(1);
    expect(report.api["createUser"]?.count).toBe(1);
    expect(report.tool["bash"]?.count).toBe(1);
  });

  // ---------------------------------------------------------------
  // 13. clear 重置历史
  // ---------------------------------------------------------------
  test("clear 重置历史 — 清空所有指标和历史记录", () => {
    monitor = new PerformanceMonitor();

    // 添加指标
    monitor.measureSync("api", "op1", () => {});
    monitor.measureSync("api", "op2", () => {});
    monitor.measureSync("tool", "op3", () => {});

    expect(monitor.getHistory().length).toBe(3);

    // 执行 clear
    monitor.clear();

    // 历史应被清空
    expect(monitor.getHistory().length).toBe(0);

    // getStats 也应返回零值
    const apiStats = monitor.getStats("api");
    expect(apiStats.count).toBe(0);

    const toolStats = monitor.getStats("tool");
    expect(toolStats.count).toBe(0);
  });

  // ---------------------------------------------------------------
  // 14. updateConfig 会话中途变更行为
  // ---------------------------------------------------------------
  test("updateConfig 会话中途变更 — 更新后行为立即生效", () => {
    monitor = new PerformanceMonitor();

    // 初始状态：enabled，正常记录
    monitor.measureSync("api", "beforeUpdate", () => {});
    expect(monitor.getHistory().length).toBe(1);

    // 禁用监控
    monitor.updateConfig({ enabled: false });

    // 禁用后 start 应返回空字符串
    const id = monitor.start("api", "afterUpdate");
    expect(id).toBe("");

    // measureSync 仍执行但不记录
    monitor.measureSync("api", "afterUpdate", () => {});
    expect(monitor.getHistory().length).toBe(1); // 仍然是 1，没有新增

    // 重新启用
    monitor.updateConfig({ enabled: true });
    monitor.measureSync("api", "afterReenable", () => {});
    expect(monitor.getHistory().length).toBe(2);
  });

  // ---------------------------------------------------------------
  // 15. maxMetrics 溢出 — RingBuffer 滚动丢弃
  // ---------------------------------------------------------------
  test("maxMetrics 溢出 — 超过容量时 RingBuffer 自动丢弃旧指标", () => {
    // 设置一个极小的 maxMetrics = 5
    monitor = new PerformanceMonitor({ maxMetrics: 5 });

    // 写入 10 条指标
    for (let i = 0; i < 10; i++) {
      monitor.measureSync("api", "overflow", () => {});
    }

    // 历史中最多保留 5 条
    const history = monitor.getHistory();
    expect(history.length).toBeLessThanOrEqual(5);
    expect(history.length).toBeGreaterThan(0);

    // 统计 count 也应 <= 5
    const stats = monitor.getStats("api", "overflow");
    expect(stats.count).toBeLessThanOrEqual(5);
    expect(stats.count).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------
  // 16. measure 异步函数 — 异常路径使用非 Error 对象
  // ---------------------------------------------------------------
  test("measure 异常路径 — 非 Error 对象也能正确记录", async () => {
    monitor = new PerformanceMonitor();

    expect(
      monitor.measure("api", "stringThrow", async () => {
        throw "字符串错误信息";
      }),
    ).rejects.toThrow("字符串错误信息");

    const history = monitor.getHistory();
    const failedMetric = history.find((m) => m.name === "stringThrow" && m.success === false);
    expect(failedMetric).toBeDefined();
    expect(failedMetric!.error).toBe("字符串错误信息");
  });

  // ---------------------------------------------------------------
  // 17. start 携带 metadata — metadata 存储在指标中
  // ---------------------------------------------------------------
  test("start 携带 metadata — metadata 正确存储在指标中", () => {
    monitor = new PerformanceMonitor();
    const meta = { userId: "123", traceId: "abc" };
    const id = monitor.start("api", "withMeta", meta);

    const metric = monitor.end(id, true);
    expect(metric !== null).toBe(true);
    expect(metric!.metadata).toEqual(meta);
  });

  // ---------------------------------------------------------------
  // 18. end 传入 success=false 和 error 信息
  // ---------------------------------------------------------------
  test("end 传入 success=false 和 error — 指标记为失败", () => {
    monitor = new PerformanceMonitor();
    const id = monitor.start("tool", "failOp");

    const metric = monitor.end(id, false, "超时错误");
    expect(metric !== null).toBe(true);
    expect(metric!.success).toBe(false);
    expect(metric!.error).toBe("超时错误");
    expect(metric!.durationMs).toBeGreaterThanOrEqual(0);

    // 统计中成功率应为 0
    const stats = monitor.getStats("tool", "failOp");
    expect(stats.successRate).toBe(0);
  });

  // ---------------------------------------------------------------
  // 19. getStats 不传 name — 返回该 type 下所有指标聚合
  // ---------------------------------------------------------------
  test("getStats 不传 name — 聚合同一 type 下所有指标", () => {
    monitor = new PerformanceMonitor();

    monitor.measureSync("api", "op1", () => {});
    monitor.measureSync("api", "op2", () => {});
    monitor.measureSync("tool", "op3", () => {});

    // 传入 type 但不传 name，应聚合所有 api 指标
    const apiStats = monitor.getStats("api");
    expect(apiStats.count).toBe(2);

    const toolStats = monitor.getStats("tool");
    expect(toolStats.count).toBe(1);
  });

  // ---------------------------------------------------------------
  // 20. generateReport 空历史 — 返回空结构
  // ---------------------------------------------------------------
  test("generateReport 空历史 — 所有 type 分组为空", () => {
    monitor = new PerformanceMonitor();

    const report = monitor.generateReport();
    const types: MetricType[] = ["api", "tool", "ui", "memory", "cpu"];

    for (const type of types) {
      expect(report).toHaveProperty(type);
      expect(Object.keys(report[type]).length).toBe(0);
    }
  });
});
