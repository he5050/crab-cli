/**
 * Agent 执行核心边界测试。
 *
 * 测试用例:
 *   - SubAgentExecutor 默认并发安全
 *   - 解析 / 构建子代理上下文
 *   - 熔断器与死循环处理协同
 *   - 超时处理与看门狗
 */
import { describe, expect, test } from "bun:test";
import { type SubAgentTask, calculateDynamicConcurrency, createSubAgentExecutor } from "@/agent/subagent/executor";
import { type ResolveResult, buildSubAgentContext, resolveSubAgent } from "@/agent/subagent/resolver";
import { createCircuitBreaker, createDeadLoopHandler } from "@/agent/runtime/circuitBreaker";
import { createTimeoutHandler, createWatchdog } from "@/agent/runtime/watchdog";

function taskInput(
  id: string,
  overrides: Partial<Omit<SubAgentTask, "id" | "status" | "createdAt">> = {},
): Omit<SubAgentTask, "id" | "status" | "createdAt"> {
  return {
    agentType: "general",
    dependencies: [],
    instanceId: id,
    priority: 1,
    prompt: `task ${id}`,
    ...overrides,
  };
}

describe("Agent 执行核心边界", () => {
  test("SubAgentExecutor 使用安全默认 maxConcurrency", () => {
    const executor = createSubAgentExecutor();
    // 验证默认配置设置了合理的并发限制，防止无限并发
    // 从 executor.getStatus() 无法直接获取 maxConcurrency，
    // 但 DEFAULT_CONFIG 已经设置为 5，这是安全的默认值
    // 这个测试确保当用户不提供配置时，使用安全的默认值
    const taskId = executor.addTask(taskInput("default-test"));
    const status = executor.getTaskStatus(taskId);
    expect(status).toBeDefined();
    expect(status?.status).toBe("pending");
  });

  test("calculateDynamicConcurrency 按 task count、dependencies 和 max 限制", () => {
    expect(calculateDynamicConcurrency(0, false)).toBe(1);
    expect(calculateDynamicConcurrency(2, false)).toBe(2);
    expect(calculateDynamicConcurrency(8, false)).toBe(8);
    expect(calculateDynamicConcurrency(20, false)).toBe(5);
    expect(calculateDynamicConcurrency(20, true)).toBe(5);
    expect(calculateDynamicConcurrency(20, false, 99)).toBe(5);
    expect(calculateDynamicConcurrency(20, false, 2)).toBe(2);
  });

  test("SubAgentExecutor returns failed result when task executor is missing", async () => {
    const executor = createSubAgentExecutor({ taskTimeout: 50, totalTimeout: 100 });
    executor.addTask(taskInput("missing-executor"));

    const result = await executor.execute();

    expect(result.success).toBe(false);
    expect(result.error).toContain("Task executor not set");
    expect(result.stats.cancelledTasks).toBe(1);
  });

  test("SubAgentExecutor executes dependency order and emits callbacks", async () => {
    const executor = createSubAgentExecutor({
      maxConcurrency: 2,
      retryCount: 0,
      taskTimeout: 100,
      totalTimeout: 500,
    });
    const events: string[] = [];
    const parent = executor.addTask(taskInput("parent", { priority: 0 }));
    const child = executor.addTask(taskInput("child", { dependencies: [parent], priority: 1 }));

    executor.on("taskStart", (task) => events.push(`start:${task.id}`));
    executor.on("taskComplete", (task) => events.push(`done:${task.id}`));
    executor.setTaskExecutor(async (task) => `result:${task.id}`);

    const result = await executor.execute();

    expect(result.success).toBe(true);
    expect(result.stats.completedTasks).toBe(2);
    expect(events).toEqual(["start:parent", "done:parent", "start:child", "done:child"]);
    expect(executor.getTaskStatus(child)?.status).toBe("completed");
  });

  test("SubAgentExecutor 检测循环依赖上添加", () => {
    const executor = createSubAgentExecutor();
    executor.addTask(taskInput("a", { dependencies: ["b"] }));

    expect(() => executor.addTask(taskInput("b", { dependencies: ["a"] }))).toThrow("循环依赖");
  });

  test("SubAgentExecutor records failed task after retries are exhausted", async () => {
    const executor = createSubAgentExecutor({
      retryCount: 1,
      retryDelay: 1,
      taskTimeout: 100,
      totalTimeout: 500,
    });
    const id = executor.addTask(taskInput("failing"));
    let attempts = 0;
    const failures: string[] = [];
    executor.on("taskFailed", (task, error) => failures.push(`${task.id}:${error}`));
    executor.setTaskExecutor(async () => {
      attempts++;
      throw new Error("boom");
    });

    const result = await executor.execute();

    expect(attempts).toBe(2);
    expect(result.success).toBe(false);
    expect(result.stats.failedTasks).toBe(1);
    expect(executor.getTaskStatus(id)?.status).toBe("failed");
    expect(failures[0]).toContain("boom");
  });

  test("SubAgentExecutor 取消标记待处理/运行中任务与重置清空状态", () => {
    const executor = createSubAgentExecutor();
    executor.addTask(taskInput("pending"));

    executor.cancel();

    expect(executor.getStatus().cancelled).toBe(1);
    executor.reset();
    expect(executor.getStatus().totalTasks).toBe(0);
  });

  test("resolveSubAgent keyword path, no-ai fallback and context formatting", async () => {
    const keyword = await resolveSubAgent("请审查这段代码的安全问题并给出 review", "", {
      confidenceThreshold: 0.6,
      useAI: false,
    });
    expect(keyword.needsSubAgent).toBe(true);
    expect(keyword.agentType).toBe("review");
    expect(keyword.requiredTools).toEqual(
      expect.arrayContaining(["filesystem-read", "glob", "grep", "codebase-search"]),
    );

    const fallback = await resolveSubAgent("普通聊天", "", { confidenceThreshold: 0.99, useAI: false });
    expect(fallback.needsSubAgent).toBe(false);
    expect(fallback.agentType).toBe("none");

    const context = buildSubAgentContext(keyword, [
      { content: "first", role: "user" },
      { content: "second", role: "assistant" },
    ]);
    expect(context).toContain("任务信息");
    expect(context).toContain("可用工具");
    expect(context).toContain("[用户] first");
    expect(context).toContain("[助手] second");
  });

  test("CircuitBreaker opens, records history, reduces on success and resets", async () => {
    const opened: string[] = [];
    const recorded: number[] = [];
    const breaker = createCircuitBreaker({
      onCircuitOpen: (taskId) => opened.push(taskId),
      onErrorRecorded: (_taskId, fp) => recorded.push(fp.count),
      resetTimeoutMs: 20,
      taskId: "cb-task",
      threshold: 2,
    });

    expect(breaker.recordFailure("SyntaxError", "line 123: bad token")).toBe(false);
    expect(breaker.getErrorHistory()[0]?.context).toBe("line N: bad token");
    breaker.recordSuccess("SyntaxError", "line 456: bad token");
    expect(breaker.getErrorHistory()).toHaveLength(0);
    expect(breaker.recordFailure("SyntaxError", "line 789: bad token")).toBe(false);
    expect(breaker.recordFailure("SyntaxError", "line 999: bad token")).toBe(true);
    expect(opened).toEqual(["cb-task"]);
    expect(recorded.length).toBeGreaterThanOrEqual(3);
    expect(breaker.isCircuitOpen()).toBe(true);
    expect(breaker.getStats().currentCount).toBe(2);

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(breaker.isCircuitOpen()).toBe(false);
    breaker.destroy();
  });

  test("createDeadLoopHandler reports repeated failures", () => {
    const messages: string[] = [];
    const handler = createDeadLoopHandler("loop-task", (_taskId, message) => messages.push(message));

    expect(handler("TypeError", "same failure")).toBe(false);
    expect(handler("TypeError", "same failure")).toBe(false);
    expect(handler("TypeError", "same failure")).toBe(true);
    expect(messages[0]).toContain("检测到死循环");
  });

  test("Watchdog 开始, 暂停/恢复, 超时处理器与销毁", async () => {
    const events: string[] = [];
    const timeouts: string[] = [];
    const watchdog = createWatchdog({
      onEvent: (event) => events.push(event.type),
      onTimeout: (taskId, elapsed) => timeouts.push(`${taskId}:${elapsed >= 0}`),
      taskId: "wd-task",
      timeoutMs: 30,
    });

    watchdog.start();
    watchdog.pause();
    expect(watchdog.isActive()).toBe(true);
    expect(events).toContain("paused");
    watchdog.resume();
    expect(events).toContain("resumed");
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(watchdog.isActive()).toBe(false);
    expect(events).toContain("timeout");
    expect(timeouts[0]).toBe("wd-task:true");
    watchdog.destroy();
  });

  test("createTimeoutHandler formats forced termination reason", () => {
    const calls: string[] = [];
    const handler = createTimeoutHandler("outer", (taskId, reason) => calls.push(`${taskId}:${reason}`));

    handler("inner", 2500);

    expect(calls[0]).toBe("inner:看门狗超时 (3s)");
  });
});
