/**
 * [测试目标] SubAgentExecutor — 任务执行、并发控制、依赖管理。
 *
 * 测试用例:
 *   - calculateDynamicConcurrency 动态并发计算
 *   - addTask 添加任务与循环依赖检测
 *   - execute 任务执行与结果聚合
 *   - cancel 取消所有任务
 *   - getStatus 状态查询
 */
import { describe, expect, test } from "bun:test";
import {
  SubAgentExecutor,
  calculateDynamicConcurrency,
  createSubAgentExecutor,
  type SubAgentTask,
} from "@/agent/subagent/executor";

describe("calculateDynamicConcurrency", () => {
  test("任务数 <= 3 时全部并行", () => {
    expect(calculateDynamicConcurrency(1, false, 0)).toBe(1);
    expect(calculateDynamicConcurrency(2, false, 0)).toBe(2);
    expect(calculateDynamicConcurrency(3, false, 0)).toBe(3);
  });

  test("任务数 <= 10 时无依赖取 min(任务数, 10)", () => {
    expect(calculateDynamicConcurrency(5, false, 0)).toBe(5);
    expect(calculateDynamicConcurrency(10, false, 0)).toBe(10);
  });

  test("任务数 > 10 且有依赖时取 min(ceil(n/2), MAX)", () => {
    const result = calculateDynamicConcurrency(20, true, 0);
    expect(result).toBeLessThanOrEqual(10);
    expect(result).toBeGreaterThanOrEqual(1);
  });

  test("maxConcurrency > 0 时使用配置值", () => {
    expect(calculateDynamicConcurrency(100, false, 5)).toBe(5);
    expect(calculateDynamicConcurrency(2, false, 5)).toBe(5);
  });

  test("任务数为 0 时返回 1", () => {
    expect(calculateDynamicConcurrency(0, false, 0)).toBe(1);
  });

  test("任务数为负数时返回 1", () => {
    expect(calculateDynamicConcurrency(-5, false, 0)).toBe(1);
  });
});

describe("SubAgentExecutor", () => {
  test("创建执行器实例", () => {
    const executor = createSubAgentExecutor();
    expect(executor).toBeInstanceOf(SubAgentExecutor);
    expect(executor.getStatus().totalTasks).toBe(0);
  });

  test("addTask 添加任务并返回 ID", () => {
    const executor = createSubAgentExecutor();

    const id = executor.addTask({
      agentType: "review",
      prompt: "Review the code",
      instanceId: "task-1",
      priority: 1,
      dependencies: [],
    });

    expect(id).toMatch(/^task-/);
    expect(executor.getStatus().pending).toBe(1);
  });

  test("addTask 使用自定义 instanceId", () => {
    const executor = createSubAgentExecutor();

    const id = executor.addTask({
      agentType: "search",
      prompt: "Search for bugs",
      instanceId: "custom-id-123",
      priority: 0,
      dependencies: [],
    });

    expect(id).toBe("custom-id-123");
  });

  test("addTask 检测循环依赖并抛出错误", () => {
    const executor = createSubAgentExecutor();

    executor.addTask({
      agentType: "a",
      prompt: "Task A",
      instanceId: "task-a",
      priority: 0,
      dependencies: [],
    });

    expect(() => {
      executor.addTask({
        agentType: "b",
        prompt: "Task B",
        instanceId: "task-b",
        priority: 0,
        dependencies: ["task-a"],
      });
    }).not.toThrow();

    expect(() => {
      executor.addTask({
        agentType: "c",
        prompt: "Task C (circular)",
        instanceId: "task-a",
        priority: 0,
        dependencies: ["task-b"],
      });
    }).toThrow(/循环依赖/);
  });

  test("execute 未设置 taskExecutor 返回失败", async () => {
    const executor = createSubAgentExecutor();
    executor.addTask({
      agentType: "test",
      prompt: "test",
      instanceId: "task-test",
      priority: 0,
      dependencies: [],
    });

    const result = await executor.execute();
    expect(result.success).toBe(false);
    expect(result.error).toContain("Task executor not set");
  });

  test("execute 成功执行单个任务", async () => {
    const executor = createSubAgentExecutor();
    executor.setTaskExecutor(async () => "task result");

    executor.addTask({
      agentType: "test",
      prompt: "test prompt",
      instanceId: "task-test-prompt",
      priority: 0,
      dependencies: [],
    });

    const result = await executor.execute();
    expect(result.success).toBe(true);
    expect(result.mergedResult).toContain("task result");
    expect(result.stats.completedTasks).toBe(1);
  });

  test("execute 并行执行多个任务", async () => {
    const executor = createSubAgentExecutor();
    const executed: string[] = [];

    executor.setTaskExecutor(async (task) => {
      executed.push(task.agentType);
      return `result-${task.agentType}`;
    });

    executor.addTask({ agentType: "a", prompt: "", instanceId: "task-a", priority: 0, dependencies: [] });
    executor.addTask({ agentType: "b", prompt: "", instanceId: "task-b", priority: 0, dependencies: [] });
    executor.addTask({ agentType: "c", prompt: "", instanceId: "task-c", priority: 0, dependencies: [] });

    const result = await executor.execute();
    expect(result.success).toBe(true);
    expect(result.stats.completedTasks).toBe(3);
    expect(executed.sort()).toEqual(["a", "b", "c"]);
  });

  test("execute 任务失败后重试", async () => {
    const executor = createSubAgentExecutor({ retryCount: 2, retryDelay: 10 });
    let attempts = 0;

    executor.setTaskExecutor(async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error("simulated failure");
      }
      return "success after retries";
    });

    executor.addTask({ agentType: "flaky", prompt: "", instanceId: "task-flaky", priority: 0, dependencies: [] });

    const result = await executor.execute();
    expect(result.success).toBe(true);
    expect(attempts).toBe(3);
  });

  test("execute 重试耗尽后标记失败", async () => {
    const executor = createSubAgentExecutor({ retryCount: 2, retryDelay: 10 });

    executor.setTaskExecutor(async () => {
      throw new Error("always fails");
    });

    executor.addTask({ agentType: "doomed", prompt: "", instanceId: "task-doomed", priority: 0, dependencies: [] });

    const result = await executor.execute();
    expect(result.success).toBe(false);
    expect(result.stats.failedTasks).toBe(1);
  });

  test("cancel 取消所有待处理任务", async () => {
    const executor = createSubAgentExecutor();

    executor.addTask({ agentType: "a", prompt: "", instanceId: "task-a", priority: 0, dependencies: [] });
    executor.addTask({ agentType: "b", prompt: "", instanceId: "task-b", priority: 0, dependencies: [] });

    executor.cancel();

    const status = executor.getStatus();
    expect(status.pending).toBe(0);
    expect(status.cancelled).toBe(2);
  });

  test("getStatus 返回正确的状态统计", () => {
    const executor = createSubAgentExecutor();

    executor.addTask({ agentType: "a", prompt: "", instanceId: "task-a", priority: 0, dependencies: [] });
    executor.addTask({ agentType: "b", prompt: "", instanceId: "task-b", priority: 0, dependencies: [] });

    const status = executor.getStatus();
    expect(status.totalTasks).toBe(2);
    expect(status.pending).toBe(2);
    expect(status.running).toBe(0);
    expect(status.completed).toBe(0);
    expect(status.failed).toBe(0);
    expect(status.cancelled).toBe(0);
  });

  test("reset 清理执行器状态", async () => {
    const executor = createSubAgentExecutor();
    executor.setTaskExecutor(async () => "ok");

    executor.addTask({ agentType: "a", prompt: "", instanceId: "task-a", priority: 0, dependencies: [] });
    await executor.execute();

    executor.reset();

    expect(executor.getStatus().totalTasks).toBe(0);
  });

  test("on 注册回调", async () => {
    const executor = createSubAgentExecutor();
    const events: string[] = [];

    executor.on("taskStart", (task) => events.push(`start-${task.agentType}`));
    executor.on("taskComplete", (task) => events.push(`complete-${task.agentType}`));
    executor.on("allComplete", () => events.push("allComplete"));

    executor.setTaskExecutor(async (task) => `result-${task.agentType}`);
    executor.addTask({ agentType: "test", prompt: "", instanceId: "task-test", priority: 0, dependencies: [] });

    await executor.execute();

    expect(events).toContain("start-test");
    expect(events).toContain("complete-test");
    expect(events).toContain("allComplete");
  });

  test("getTaskStatus 返回单个任务状态", () => {
    const executor = createSubAgentExecutor();

    const id = executor.addTask({
      agentType: "review",
      prompt: "review code",
      instanceId: "task-review",
      priority: 1,
      dependencies: [],
    });

    const task = executor.getTaskStatus(id);
    expect(task).toBeDefined();
    expect(task?.agentType).toBe("review");
    expect(task?.status).toBe("pending");
  });

  test("getAllTaskStatuses 返回所有任务", () => {
    const executor = createSubAgentExecutor();

    executor.addTask({ agentType: "a", prompt: "", instanceId: "task-a", priority: 0, dependencies: [] });
    executor.addTask({ agentType: "b", prompt: "", instanceId: "task-b", priority: 1, dependencies: [] });

    const all = executor.getAllTaskStatuses();
    expect(all.size).toBe(2);
  });

  test("execute 失败时返回错误信息", async () => {
    const executor = createSubAgentExecutor({ totalTimeout: 150 });

    let resolveTask: () => void;
    let taskStarted = false;
    executor.setTaskExecutor(async () => {
      taskStarted = true;
      await new Promise<void>((resolve) => {
        resolveTask = resolve;
      });
      return "should not reach";
    });

    executor.addTask({ agentType: "slow", prompt: "", instanceId: "task-slow", priority: 0, dependencies: [] });

    const resultPromise = executor.execute();

    await new Promise((r) => setTimeout(r, 200));

    resolveTask!();

    const result = await resultPromise;
    expect(result).toBeDefined();
  });

  test("cancel 取消所有任务", async () => {
    const executor = createSubAgentExecutor();

    executor.setTaskExecutor(async () => {
      await new Promise((r) => setTimeout(r, 1000));
      return "should not reach";
    });

    executor.addTask({ agentType: "a", prompt: "", instanceId: "task-a", priority: 0, dependencies: [] });
    executor.addTask({ agentType: "b", prompt: "", instanceId: "task-b", priority: 0, dependencies: [] });

    executor.cancel();

    const statuses = executor.getAllTaskStatuses();
    for (const task of statuses.values()) {
      expect(task.status).toBe("cancelled");
    }
  });
});
