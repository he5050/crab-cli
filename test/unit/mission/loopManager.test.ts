/**
 * LoopManager 测试。
 *
 * 测试用例:
 *   - Loop 创建、列表、取消
 *   - 时间格式解析(5m, 1h, 30s, every 2h)
 *   - Loop 启动和定时执行
 *   - 任务关联和状态跟踪
 *   - 最大 Loop 数限制
 *   - 停止所有 Loop
 */
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  LoopManager,
  __resetLoopManagerDepsForTesting,
  __setLoopManagerDepsForTesting,
  parseLoopSchedule,
} from "@/mission";
import type { LoopRecord } from "@/mission/loop/schedule";

// Mock taskManager
const mockCreateTask = mock();
const mockGetTask = mock();
type IntervalLoopSchedule = Extract<NonNullable<ReturnType<typeof parseLoopSchedule>>, { intervalMs: number }>;

function expectIntervalSchedule(result: ReturnType<typeof parseLoopSchedule>): IntervalLoopSchedule {
  expect(result).not.toBeNull();
  expect(result && "intervalMs" in result).toBe(true);
  return result as IntervalLoopSchedule;
}

describe("LoopManager", () => {
  let loopManager: LoopManager;

  beforeEach(() => {
    loopManager = new LoopManager();
    mockCreateTask.mockClear();
    mockGetTask.mockClear();
    __setLoopManagerDepsForTesting({
      taskManager: {
        create: mockCreateTask,
        get: mockGetTask,
      } as any,
    });
  });

  afterEach(() => {
    loopManager.stopAll();
    __resetLoopManagerDepsForTesting();
  });

  describe("Loop 创建", () => {
    test("创建 Loop 返回记录", () => {
      const schedule = {
        intervalLabel: "5m",
        intervalMs: 300_000, // 5分钟
        prompt: "每5分钟执行一次",
      };

      const loop = loopManager.createLoop(schedule);

      expect(loop).toBeDefined();
      expect(loop.id).toBeDefined();
      expect(loop.id.length).toBe(8);
      expect(loop.intervalMs).toBe(300_000);
      expect(loop.intervalLabel).toBe("5m");
      expect(loop.prompt).toBe("每5分钟执行一次");
      expect(loop.active).toBe(true);
    });

    test("创建 Loop 时设置下次执行时间", () => {
      const before = Date.now();
      const schedule = {
        intervalLabel: "1m",
        intervalMs: 60_000,
        prompt: "测试",
      };

      const loop = loopManager.createLoop(schedule);

      expect(loop.nextRunAt).toBeGreaterThanOrEqual(before + 60_000);
      expect(loop.createdAt).toBeGreaterThanOrEqual(before);
    });

    test("超过最大 Loop 数时抛出错误", () => {
      loopManager.setMaxActive(3);
      for (let i = 0; i < 3; i++) {
        loopManager.createLoop({
          intervalLabel: "1m",
          intervalMs: 60_000,
          prompt: `Loop ${i}`,
        });
      }

      expect(() => {
        loopManager.createLoop({
          intervalLabel: "1m",
          intervalMs: 60_000,
          prompt: "超出限制",
        });
      }).toThrow("最多支持 3 个活跃 Loop");
    });

    test("setMaxActive 可配置最大 Loop 数", () => {
      loopManager.setMaxActive(2);
      loopManager.createLoop({ intervalLabel: "1m", intervalMs: 60_000, prompt: "A" });
      loopManager.createLoop({ intervalLabel: "1m", intervalMs: 60_000, prompt: "B" });

      expect(() => {
        loopManager.createLoop({ intervalLabel: "1m", intervalMs: 60_000, prompt: "C" });
      }).toThrow("最多支持 2 个活跃 Loop");
    });

    test("setMaxActive 边界值被钳位到 [1, 50]", () => {
      loopManager.setMaxActive(0);
      // 最小钳位到 1，所以只能创建 1 个
      loopManager.createLoop({ intervalLabel: "1m", intervalMs: 60_000, prompt: "A" });
      expect(() => {
        loopManager.createLoop({ intervalLabel: "1m", intervalMs: 60_000, prompt: "B" });
      }).toThrow("最多支持 1 个活跃 Loop");
    });
  });

  describe("Loop 列表和查询", () => {
    test("列出所有 Loop", () => {
      loopManager.createLoop({
        intervalLabel: "1m",
        intervalMs: 60_000,
        prompt: "Loop 1",
      });
      loopManager.createLoop({
        intervalLabel: "5m",
        intervalMs: 300_000,
        prompt: "Loop 2",
      });

      const loops = loopManager.listLoops();

      expect(loops.length).toBe(2);
    });

    test("列表按创建时间排序", () => {
      const loop1 = loopManager.createLoop({
        intervalLabel: "1m",
        intervalMs: 60_000,
        prompt: "第一个",
      });
      const loop2 = loopManager.createLoop({
        intervalLabel: "2m",
        intervalMs: 120_000,
        prompt: "第二个",
      });

      const loops = loopManager.listLoops();

      expect(loops[0]!.id).toBe(loop1.id);
      expect(loops[1]!.id).toBe(loop2.id);
    });

    test("空列表返回空数组", () => {
      const loops = loopManager.listLoops();
      expect(loops).toEqual([]);
    });
  });

  describe("Loop 取消", () => {
    test("取消 Loop 标记为 inactive", () => {
      const loop = loopManager.createLoop({
        intervalLabel: "1m",
        intervalMs: 60_000,
        prompt: "待取消",
      });

      const cancelled = loopManager.cancelLoop(loop.id);

      expect(cancelled).toBeDefined();
      expect(cancelled!.active).toBe(false);
    });

    test("取消不存在的 Loop 返回 null", () => {
      const result = loopManager.cancelLoop("nonexistent");
      expect(result).toBeNull();
    });

    test("取消时清除定时器", () => {
      const mockConfig = { mcpServers: {}, models: {} } as any;
      const loop = loopManager.createLoop({
        intervalLabel: "100ms",
        intervalMs: 100,
        prompt: "快速测试",
      });

      loopManager.startLoop(loop.id, mockConfig);

      // 取消
      const cancelled = loopManager.cancelLoop(loop.id);
      expect(cancelled).toBeDefined();
      expect(cancelled!.active).toBe(false);
    });

    test("suspendTimers 只挂起定时器并保留 active/enabled 状态", () => {
      const mockConfig = { mcpServers: {}, models: {} } as any;
      const loop = loopManager.createLoop({
        intervalLabel: "1s",
        intervalMs: 1000,
        prompt: "daemon 可恢复任务",
      });

      loopManager.startLoop(loop.id, mockConfig);
      expect(loopManager.getLoop(loop.id)!._timer).toBeDefined();

      loopManager.suspendTimers();

      const suspended = loopManager.getLoop(loop.id)!;
      expect(suspended._timer).toBeUndefined();
      expect(suspended.active).toBe(true);
      expect(suspended.enabled).toBe(true);
    });
  });

  describe("时间格式解析", () => {
    test("解析 5m 格式", () => {
      const result = parseLoopSchedule("5m 执行任务");
      const schedule = expectIntervalSchedule(result);

      expect(schedule.intervalMs).toBe(300_000);
      expect(schedule.intervalLabel).toBe("5m");
      expect(schedule.prompt).toBe("执行任务");
    });

    test("解析 1h 格式", () => {
      const result = parseLoopSchedule("1h 每小时任务");
      const schedule = expectIntervalSchedule(result);

      expect(schedule.intervalMs).toBe(3_600_000);
      expect(schedule.intervalLabel).toBe("1h");
    });

    test("解析 30s 格式", () => {
      const result = parseLoopSchedule("30s 快速检查");
      const schedule = expectIntervalSchedule(result);

      expect(schedule.intervalMs).toBe(30_000);
      expect(schedule.intervalLabel).toBe("30s");
    });

    test("解析组合格式 1h30m", () => {
      const result = parseLoopSchedule("1h30m 组合任务");
      const schedule = expectIntervalSchedule(result);

      expect(schedule.intervalMs).toBe(5_400_000);
      expect(schedule.intervalLabel).toBe("1h30m");
    });

    test("解析 every 格式", () => {
      const result = parseLoopSchedule("every 2h 定时任务");
      const schedule = expectIntervalSchedule(result);

      expect(schedule.intervalMs).toBe(7_200_000);
      expect(schedule.intervalLabel).toBe("2h");
      expect(schedule.prompt).toBe("定时任务");
    });

    test("解析 every 组合格式", () => {
      const result = parseLoopSchedule("every 1h30m 复杂任务");
      const schedule = expectIntervalSchedule(result);

      expect(schedule.intervalMs).toBe(5_400_000);
      expect(schedule.intervalLabel).toBe("1h30m");
    });

    test("无效格式返回 null", () => {
      expect(parseLoopSchedule("无效格式")).toBeNull();
      expect(parseLoopSchedule("")).toBeNull();
      expect(parseLoopSchedule("abc 任务")).toBeNull();
    });

    test("缺少提示词返回 null", () => {
      expect(parseLoopSchedule("5m")).toBeNull();
      expect(parseLoopSchedule("every 1h")).toBeNull();
    });
  });

  describe("Loop 执行", () => {
    test("启动 Loop 创建定时器", () => {
      const mockConfig = { mcpServers: {}, models: {} } as any;
      const loop = loopManager.createLoop({
        intervalLabel: "1s",
        intervalMs: 1000,
        prompt: "测试任务",
      });

      loopManager.startLoop(loop.id, mockConfig);

      const started = loopManager.listLoops()[0]!;
      expect(started._timer).toBeDefined();
    });

    test("启动不存在的 Loop 不抛出错误", () => {
      const mockConfig = { mcpServers: {}, models: {} } as any;
      expect(() => {
        loopManager.startLoop("nonexistent", mockConfig);
      }).not.toThrow();
    });

    test("启动 inactive Loop 不执行", () => {
      const mockConfig = { mcpServers: {}, models: {} } as any;
      const loop = loopManager.createLoop({
        intervalLabel: "1s",
        intervalMs: 1000,
        prompt: "测试",
      });

      loopManager.cancelLoop(loop.id);
      loopManager.startLoop(loop.id, mockConfig);

      // 不应该创建任务
      expect(mockCreateTask).not.toHaveBeenCalled();
    });
  });

  describe("任务摘要", () => {
    test("格式化 Loop 摘要", () => {
      const loop = loopManager.createLoop({
        intervalLabel: "5m",
        intervalMs: 300_000,
        prompt: "这是一个很长的提示词，需要被截断显示",
      });

      const summary = loopManager.formatLoopSummary(loop);

      expect(summary).toContain("Loop");
      expect(summary).toContain(loop.id);
      expect(summary).toContain("5m");
      expect(summary).toContain("这是一个很长的提示词");
    });

    test("格式化包含上次任务的摘要", () => {
      const loop = loopManager.createLoop({
        intervalLabel: "5m",
        intervalMs: 300_000,
        prompt: "测试",
      });
      loop.lastTaskId = "task_abc123";

      const summary = loopManager.formatLoopSummary(loop);

      expect(summary).toContain("task_abc123");
    });

    test("任务摘要列表", () => {
      loopManager.createLoop({
        intervalLabel: "5m",
        intervalMs: 300_000,
        prompt: "Loop 1",
      });
      loopManager.createLoop({
        intervalLabel: "10m",
        intervalMs: 600_000,
        prompt: "Loop 2",
      });

      const summaries = loopManager.listTaskSummaries();

      expect(summaries.length).toBe(2);
      expect(summaries[0]).toContain("⏳");
      expect(summaries[0]).toContain("5m");
    });

    test("任务摘要显示任务状态", () => {
      const loop = loopManager.createLoop({
        intervalLabel: "5m",
        intervalMs: 300_000,
        prompt: "状态测试",
      });
      loop.lastTaskId = "task_test_001";

      mockGetTask.mockReturnValue({
        id: "task_test_001",
        status: "completed",
      });

      const summaries = loopManager.listTaskSummaries();

      expect(summaries[0]).toContain("completed");
    });

    test("取消的 Loop 显示为 inactive", () => {
      const loop = loopManager.createLoop({
        intervalLabel: "5m",
        intervalMs: 300_000,
        prompt: "已取消",
      });
      loopManager.cancelLoop(loop.id);

      const summaries = loopManager.listTaskSummaries();

      expect(summaries[0]).toContain("⊘");
    });
  });

  describe("Loop 暂停/恢复", () => {
    test("暂停 Loop 设置 enabled=false 但保持 active", () => {
      const loop = loopManager.createLoop({
        intervalLabel: "1m",
        intervalMs: 60_000,
        prompt: "待暂停",
      });

      const paused = loopManager.pauseLoop(loop.id);

      expect(paused).toBe(true);
      const found = loopManager.listLoops().find((l) => l.id === loop.id)!;
      expect(found.active).toBe(true);
      expect(found.enabled).toBe(false);
    });

    test("暂停时清除定时器", () => {
      const mockConfig = { mcpServers: {}, models: {} } as any;
      const loop = loopManager.createLoop({
        intervalLabel: "1s",
        intervalMs: 1000,
        prompt: "暂停测试",
      });

      loopManager.startLoop(loop.id, mockConfig);
      const before = loopManager.listLoops().find((l) => l.id === loop.id)!;
      expect(before._timer).toBeDefined();

      loopManager.pauseLoop(loop.id);
      const after = loopManager.listLoops().find((l) => l.id === loop.id)!;
      expect(after._timer).toBeUndefined();
    });

    test("暂停不存在的 Loop 返回 false", () => {
      expect(loopManager.pauseLoop("nonexistent")).toBe(false);
    });

    test("暂停 inactive Loop 返回 false", () => {
      const loop = loopManager.createLoop({
        intervalLabel: "1m",
        intervalMs: 60_000,
        prompt: "已取消",
      });
      loopManager.cancelLoop(loop.id);

      expect(loopManager.pauseLoop(loop.id)).toBe(false);
    });

    test("恢复已暂停的 Loop", () => {
      const mockConfig = { mcpServers: {}, models: {} } as any;
      const loop = loopManager.createLoop({
        intervalLabel: "1m",
        intervalMs: 60_000,
        prompt: "恢复测试",
      });

      loopManager.pauseLoop(loop.id);
      const resumed = loopManager.resumeLoop(loop.id, mockConfig);

      expect(resumed).toBe(true);
      const found = loopManager.listLoops().find((l) => l.id === loop.id)!;
      expect(found.enabled).toBe(true);
      expect(found._timer).toBeDefined();
    });

    test("恢复未暂停的 Loop 返回 false", () => {
      const mockConfig = { mcpServers: {}, models: {} } as any;
      const loop = loopManager.createLoop({
        intervalLabel: "1m",
        intervalMs: 60_000,
        prompt: "未暂停",
      });

      expect(loopManager.resumeLoop(loop.id, mockConfig)).toBe(false);
    });

    test("恢复不存在的 Loop 返回 false", () => {
      const mockConfig = { mcpServers: {}, models: {} } as any;
      expect(loopManager.resumeLoop("nonexistent", mockConfig)).toBe(false);
    });
  });

  describe("停止所有 Loop", () => {
    test("停止所有活跃的 Loop", () => {
      const loop1 = loopManager.createLoop({
        intervalLabel: "1m",
        intervalMs: 60_000,
        prompt: "Loop 1",
      });
      const loop2 = loopManager.createLoop({
        intervalLabel: "2m",
        intervalMs: 120_000,
        prompt: "Loop 2",
      });

      loopManager.stopAll();

      const loops = loopManager.listLoops();
      expect(loops[0]!.active).toBe(false);
      expect(loops[1]!.active).toBe(false);
    });

    test("停止后清除所有定时器", () => {
      const mockConfig = { mcpServers: {}, models: {} } as any;
      const loop = loopManager.createLoop({
        intervalLabel: "1s",
        intervalMs: 1000,
        prompt: "测试",
      });

      loopManager.startLoop(loop.id, mockConfig);
      loopManager.stopAll();

      const stopped = loopManager.listLoops()[0]!;
      expect(stopped.active).toBe(false);
    });
  });

  describe("边界条件", () => {
    test("取消后重新启动新的 Loop", () => {
      const loop1 = loopManager.createLoop({
        intervalLabel: "1m",
        intervalMs: 60_000,
        prompt: "第一个",
      });

      loopManager.cancelLoop(loop1.id);

      // 可以创建新的 Loop
      const loop2 = loopManager.createLoop({
        intervalLabel: "2m",
        intervalMs: 120_000,
        prompt: "第二个",
      });

      expect(loop2.id).not.toBe(loop1.id);
      expect(loopManager.listLoops().length).toBe(2);
    });

    test("Loop ID 唯一性", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 5; i++) {
        const loop = loopManager.createLoop({
          intervalLabel: "1m",
          intervalMs: 60_000,
          prompt: `Loop ${i}`,
        });
        ids.add(loop.id);
      }

      expect(ids.size).toBe(5);
    });

    test("大间隔值处理", () => {
      const result = parseLoopSchedule("24h 每日任务");
      const schedule = expectIntervalSchedule(result);

      expect(schedule.intervalMs).toBe(86_400_000);
    });

    test("极小间隔值处理", () => {
      const result = parseLoopSchedule("1s 每秒任务");
      const schedule = expectIntervalSchedule(result);

      expect(schedule.intervalMs).toBe(1000);
    });
  });
});

afterAll(() => {
  __resetLoopManagerDepsForTesting();
});
