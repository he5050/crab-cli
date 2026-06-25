/**
 * LoopManager 高级场景测试。
 *
 * 补充 loopManager.test.ts 未覆盖的边界场景:
 *   - parseLoopSchedule cron/every/简单格式解析
 *   - validateCron 各种校验分支
 *   - calculateNextCronRun 时间计算
 *   - LoopManager pauseLoop/resumeLoop 完整生命周期
 *   - LoopManager stopAll 批量停止
 *   - LoopManager cancelLoop 清理定时器
 *   - LoopManager formatLoopSummary 包含统计信息
 *   - LoopManager getHistory / clearHistory 历史记录管理
 */
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  LoopManager,
  __resetLoopManagerDepsForTesting,
  __setLoopManagerDepsForTesting,
  parseLoopSchedule,
  validateCron,
  calculateNextCronRun,
} from "@/mission";
import { cleanupTestDir, createProjectTmpTestDir } from "../../helpers/testPaths";

// Mock taskManager
const mockCreateTask = mock(() => Promise.resolve("mock_task_id"));
const mockGetTask = mock(() => ({ status: "completed" }));

describe("LoopManager 高级场景", () => {
  let manager: LoopManager;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createProjectTmpTestDir(process.cwd(), "loop-adv-");
    manager = new LoopManager();
    manager.setProjectDir(tempDir);
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
    manager.stopAll();
    __resetLoopManagerDepsForTesting();
    cleanupTestDir(tempDir);
  });

  describe("parseLoopSchedule 格式解析", () => {
    test("parseLoopSchedule 解析 cron 格式", () => {
      const result = parseLoopSchedule("cron */5 * * * * 测试提示词");

      expect(result).not.toBeNull();
      if (result && "cronExpr" in result) {
        expect(result.cronExpr).toBe("*/5 * * * *");
        expect(result.prompt).toBe("测试提示词");
      } else {
        // 不应走到 interval 分支
        throw new Error("期望返回 cron 格式结果");
      }
    });

    test("parseLoopSchedule 解析 every 格式", () => {
      const result = parseLoopSchedule("every 30m 测试");

      expect(result).not.toBeNull();
      if (result && "intervalMs" in result) {
        expect(result.intervalMs).toBe(1_800_000);
        expect(result.intervalLabel).toBe("30m");
        expect(result.prompt).toBe("测试");
      } else {
        throw new Error("期望返回 interval 格式结果");
      }
    });

    test("parseLoopSchedule 解析简单格式", () => {
      const result = parseLoopSchedule("5m 测试");

      expect(result).not.toBeNull();
      if (result && "intervalMs" in result) {
        expect(result.intervalMs).toBe(300_000);
        expect(result.intervalLabel).toBe("5m");
        expect(result.prompt).toBe("测试");
      } else {
        throw new Error("期望返回 interval 格式结果");
      }
    });

    test("parseLoopSchedule 无效输入返回 null", () => {
      expect(parseLoopSchedule("invalid input")).toBeNull();
      expect(parseLoopSchedule("")).toBeNull();
      expect(parseLoopSchedule("abc")).toBeNull();
    });
  });

  describe("validateCron 校验", () => {
    test("validateCron 有效表达式", () => {
      const result = validateCron("0 9 * * *");

      expect(result.valid).toBe(true);
    });

    test("validateCron 字段数不对", () => {
      const result = validateCron("0 9 * *");

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain("5");
    });

    test("validateCron 范围超出", () => {
      // 分钟字段 60 超出 [0-59]
      const result = validateCron("60 0 * * *");

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain("分钟");
    });

    test("validateCron 小时范围超出", () => {
      // 小时字段 25 超出 [0-23]
      const result = validateCron("0 25 * * *");

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain("小时");
    });
  });

  describe("calculateNextCronRun 计算", () => {
    test("calculateNextCronRun 基本计算", () => {
      // "30 14 * * *" → 今天或明天 14:30
      const nextTimestamp = calculateNextCronRun("30 14 * * *");
      const now = Date.now();

      expect(nextTimestamp).toBeGreaterThan(now);

      // 验证计算出的时间是 14:30 (某天)
      const nextDate = new Date(nextTimestamp);
      expect(nextDate.getHours()).toBe(14);
      expect(nextDate.getMinutes()).toBe(30);
      expect(nextDate.getSeconds()).toBe(0);
    });

    test("calculateNextCronRun 步进格式 */5", () => {
      const nextTimestamp = calculateNextCronRun("*/5 * * * *");
      const now = Date.now();
      expect(nextTimestamp).toBeGreaterThan(now);

      const nextDate = new Date(nextTimestamp);
      expect(nextDate.getMinutes() % 5).toBe(0);
    });

    test("calculateNextCronRun 星期字段", () => {
      // "0 9 * * 1" → 下一个周一 9:00
      const nextTimestamp = calculateNextCronRun("0 9 * * 1");
      const now = Date.now();
      expect(nextTimestamp).toBeGreaterThan(now);

      const nextDate = new Date(nextTimestamp);
      expect(nextDate.getDay()).toBe(1); // 周一
      expect(nextDate.getHours()).toBe(9);
      expect(nextDate.getMinutes()).toBe(0);
    });

    test("calculateNextCronRun 日期字段", () => {
      // "0 0 1 * *" → 下一个每月1号 0:00
      const nextTimestamp = calculateNextCronRun("0 0 1 * *");
      const now = Date.now();
      expect(nextTimestamp).toBeGreaterThan(now);

      const nextDate = new Date(nextTimestamp);
      expect(nextDate.getDate()).toBe(1);
      expect(nextDate.getHours()).toBe(0);
      expect(nextDate.getMinutes()).toBe(0);
    });

    test("calculateNextCronRun 月+日组合", () => {
      // "0 12 25 12 *" → 12月25日 12:00
      const nextTimestamp = calculateNextCronRun("0 12 25 12 *");
      const now = Date.now();
      expect(nextTimestamp).toBeGreaterThan(now);

      const nextDate = new Date(nextTimestamp);
      expect(nextDate.getMonth() + 1).toBe(12);
      expect(nextDate.getDate()).toBe(25);
      expect(nextDate.getHours()).toBe(12);
    });
  });

  describe("LoopManager pauseLoop/resumeLoop 生命周期", () => {
    test("完整暂停/恢复生命周期", () => {
      const mockConfig = { mcpServers: {}, models: {} } as any;
      const loop = manager.createLoop({
        intervalLabel: "1s",
        intervalMs: 1000,
        prompt: "生命周期测试",
      });

      // 初始状态: active=true, enabled=true
      expect(loop.active).toBe(true);
      expect(loop.enabled).toBe(true);

      // 启动定时器
      manager.startLoop(loop.id, mockConfig);
      const started = manager.getLoop(loop.id)!;
      expect(started._timer).toBeDefined();

      // 暂停
      const paused = manager.pauseLoop(loop.id);
      expect(paused).toBe(true);
      const afterPause = manager.getLoop(loop.id)!;
      expect(afterPause.active).toBe(true);
      expect(afterPause.enabled).toBe(false);
      expect(afterPause._timer).toBeUndefined();

      // 恢复
      const resumed = manager.resumeLoop(loop.id, mockConfig);
      expect(resumed).toBe(true);
      const afterResume = manager.getLoop(loop.id)!;
      expect(afterResume.active).toBe(true);
      expect(afterResume.enabled).toBe(true);
    });
  });

  describe("LoopManager stopAll 批量停止", () => {
    test("stopAll 停止所有循环", () => {
      const mockConfig = { mcpServers: {}, models: {} } as any;
      const loop1 = manager.createLoop({
        intervalLabel: "1s",
        intervalMs: 1000,
        prompt: "Loop A",
      });
      const loop2 = manager.createLoop({
        intervalLabel: "2s",
        intervalMs: 2000,
        prompt: "Loop B",
      });

      manager.startLoop(loop1.id, mockConfig);
      manager.startLoop(loop2.id, mockConfig);

      // 确认两个都有定时器
      expect(manager.getLoop(loop1.id)!._timer).toBeDefined();
      expect(manager.getLoop(loop2.id)!._timer).toBeDefined();

      // 批量停止
      manager.stopAll();

      const loops = manager.listLoops();
      expect(loops[0]!.active).toBe(false);
      expect(loops[1]!.active).toBe(false);
    });
  });

  describe("LoopManager cancelLoop 清理", () => {
    test("cancelLoop 清理定时器", () => {
      const mockConfig = { mcpServers: {}, models: {} } as any;
      const loop = manager.createLoop({
        intervalLabel: "1s",
        intervalMs: 1000,
        prompt: "取消清理测试",
      });

      manager.startLoop(loop.id, mockConfig);
      expect(manager.getLoop(loop.id)!._timer).toBeDefined();

      const cancelled = manager.cancelLoop(loop.id);
      expect(cancelled).toBeDefined();
      expect(cancelled!.active).toBe(false);
      // 定时器应被清理
      const after = manager.getLoop(loop.id)!;
      expect(after._timer).toBeUndefined();
    });
  });

  describe("LoopManager formatLoopSummary 统计信息", () => {
    test("formatLoopSummary 包含统计信息", () => {
      const loop = manager.createLoop({
        intervalLabel: "5m",
        intervalMs: 300_000,
        prompt: "统计摘要测试",
      });

      const summary = manager.formatLoopSummary(loop);

      // 基本字段
      expect(summary).toContain(loop.id);
      expect(summary).toContain("5m");
      expect(summary).toContain("统计摘要测试");
      // runCount 为 0 时不应有统计行
      expect(summary).toContain("累计执行: 0 次");
    });

    test("formatLoopSummary 执行后包含统计行", async () => {
      const mockConfig = { mcpServers: {}, models: {} } as any;
      const loop = manager.createLoop({
        intervalLabel: "1ms",
        intervalMs: 1,
        prompt: "执行统计测试",
      });

      manager.startLoop(loop.id, mockConfig);

      // 等待至少一次执行
      await Bun.sleep(50);

      // 重新获取最新 loop 状态
      const currentLoop = manager.getLoop(loop.id)!;
      const summary = manager.formatLoopSummary(currentLoop);

      expect(summary).toContain("统计:");
      expect(summary).toContain("成功");
    });
  });

  describe("LoopManager getHistory / clearHistory", () => {
    test("getHistory 返回历史记录", async () => {
      const mockConfig = { mcpServers: {}, models: {} } as any;
      const loop = manager.createLoop({
        intervalLabel: "1ms",
        intervalMs: 1,
        prompt: "历史记录测试",
      });

      manager.startLoop(loop.id, mockConfig);

      // 等待至少一次执行
      await Bun.sleep(50);

      const history = manager.getHistory(loop.id);

      expect(history.length).toBeGreaterThanOrEqual(1);
      const first = history[0]!;
      expect(first.loopId).toBe(loop.id);
      expect(first.status).toBe("success");
    });

    test("clearHistory 清除历史", async () => {
      const mockConfig = { mcpServers: {}, models: {} } as any;
      const loop = manager.createLoop({
        intervalLabel: "1ms",
        intervalMs: 1,
        prompt: "清除历史测试",
      });

      manager.startLoop(loop.id, mockConfig);

      // 等待至少一次执行
      await Bun.sleep(50);

      // 确认有历史
      expect(manager.getHistory(loop.id).length).toBeGreaterThanOrEqual(1);

      // 清除
      const cleared = manager.clearHistory(loop.id);
      expect(cleared).toBe(true);

      // 清除后历史为空
      const after = manager.getHistory(loop.id);
      expect(after).toEqual([]);
    });
  });
});

afterAll(() => {
  __resetLoopManagerDepsForTesting();
});
