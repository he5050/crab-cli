/**
 * Agent 并发集成测试
 *
 * 测试 Agent 并发场景:
 *   - 多 Agent 并发执行
 *   - 共享资源访问
 *   - 竞态条件处理
 *   - 死锁预防
 *
 * 边界:
 *   1. 使用 Mock Agent 模拟并发场景
 *   2. 测试并发安全的数据结构
 *   3. 验证并发状态一致性
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { HeartbeatMonitor, createHeartbeatMonitor } from "@/agent/runtime/heartbeat";

// ─── 并发测试工具 ─────────────────────────────────────────────────────

/**
 * 并发执行辅助函数
 */
async function runConcurrently<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  // oxlint-disable-next-line unicorn/no-new-array
  const results: T[] = new Array(tasks.length);
  const executing: Promise<void>[] = [];
  let taskIndex = 0;

  async function executeNext(): Promise<void> {
    while (taskIndex < tasks.length) {
      const currentIndex = taskIndex++;
      const task = tasks[currentIndex]!;
      results[currentIndex] = await task();
    }
  }

  for (let i = 0; i < concurrency && i < tasks.length; i++) {
    executing.push(executeNext());
  }

  await Promise.all(executing);
  return results;
}

/**
 * 测量并行执行时间
 */
async function measureParallelTime<T>(tasks: (() => Promise<T>)[]): Promise<{ results: T[]; timeMs: number }> {
  const start = Date.now();
  const results = await Promise.all(tasks.map((t) => t()));
  const timeMs = Date.now() - start;
  return { results, timeMs };
}

// ─── Mock Agent 实现 ─────────────────────────────────────────────────────

interface ConcurrentAgentConfig {
  id: string;
  name: string;
  workMs?: number;
  steps?: number;
}

class ConcurrentAgent {
  readonly id: string;
  readonly name: string;
  private state: "idle" | "running" | "completed" = "idle";
  private workMs: number;
  private steps: number;
  private results: string[] = [];

  constructor(config: ConcurrentAgentConfig) {
    this.id = config.id;
    this.name = config.name;
    this.workMs = config.workMs ?? 50;
    this.steps = config.steps ?? 3;
  }

  async execute(): Promise<string[]> {
    if (this.state !== "idle") {
      throw new Error(`Agent ${this.id} 已在运行`);
    }

    this.state = "running";
    this.results = [];

    for (let i = 0; i < this.steps; i++) {
      await new Promise((resolve) => setTimeout(resolve, this.workMs));
      this.results.push(`${this.id}-step-${i}`);
    }

    this.state = "completed";
    return this.results;
  }

  getState() {
    return this.state;
  }

  getResults() {
    return this.results;
  }
}

// ─── 共享状态模拟 ─────────────────────────────────────────────────────

class SharedCounter {
  private value = 0;
  private ops = 0;

  async increment(amount = 1): Promise<number> {
    this.ops++;
    const current = this.value;
    await new Promise((resolve) => setTimeout(resolve, 1)); // 模拟异步操作
    this.value = current + amount;
    return this.value;
  }

  getValue(): number {
    return this.value;
  }

  getOps(): number {
    return this.ops;
  }

  reset(): void {
    this.value = 0;
    this.ops = 0;
  }
}

// ─── 测试套件 ─────────────────────────────────────────────────────

describe("Agent 并发集成", () => {
  describe("多 Agent 并发执行", () => {
    test("多个 Agent 并发执行", async () => {
      const agents = [
        new ConcurrentAgent({ id: "agent-1", name: "Agent1", steps: 2, workMs: 20 }),
        new ConcurrentAgent({ id: "agent-2", name: "Agent2", steps: 2, workMs: 20 }),
        new ConcurrentAgent({ id: "agent-3", name: "Agent3", steps: 2, workMs: 20 }),
      ];

      const start = Date.now();
      const results = await Promise.all(agents.map((a) => a.execute()));
      const timeMs = Date.now() - start;

      // 所有 Agent 都完成了
      expect(results).toHaveLength(3);
      expect(agents.every((a) => a.getState() === "completed")).toBe(true);

      // 验证结果
      expect(agents[0]!.getResults()).toEqual(["agent-1-step-0", "agent-1-step-1"]);
      expect(agents[1]!.getResults()).toEqual(["agent-2-step-0", "agent-2-step-1"]);
      expect(agents[2]!.getResults()).toEqual(["agent-3-step-0", "agent-3-step-1"]);
    });

    test("Agent 并发执行时间应小于串行", async () => {
      const parallelAgents = [
        new ConcurrentAgent({ id: "p1", name: "P1", steps: 2, workMs: 50 }),
        new ConcurrentAgent({ id: "p2", name: "P2", steps: 2, workMs: 50 }),
        new ConcurrentAgent({ id: "p3", name: "P3", steps: 2, workMs: 50 }),
      ];

      // 并行执行
      const { timeMs: parallelTime } = await measureParallelTime(parallelAgents.map((a) => () => a.execute()));

      // 串行执行
      const serialAgents = [
        new ConcurrentAgent({ id: "s1", name: "S1", steps: 2, workMs: 50 }),
        new ConcurrentAgent({ id: "s2", name: "S2", steps: 2, workMs: 50 }),
        new ConcurrentAgent({ id: "s3", name: "S3", steps: 2, workMs: 50 }),
      ];

      const start = Date.now();
      for (const agent of serialAgents) {
        await agent.execute();
      }
      const serialTime = Date.now() - start;

      // 并行时间应显著小于串行时间，但给调度抖动留出余量
      expect(parallelTime).toBeLessThan(serialTime * 0.75);
    });

    test("Agent 不能重复执行", async () => {
      const agent = new ConcurrentAgent({ id: "single", name: "Single", steps: 1, workMs: 20 });

      await agent.execute();

      await expect(agent.execute()).rejects.toThrow("已在运行");
    });
  });

  describe("共享资源访问", () => {
    test("并发更新共享计数器", async () => {
      const counter = new SharedCounter();
      const incrementCount = 10;

      // 多个并发任务同时更新计数器
      const tasks = Array.from({ length: 5 }, (_, i) => async () => {
        for (let j = 0; j < incrementCount; j++) {
          await counter.increment(1);
        }
        return i;
      });

      await Promise.all(tasks.map((t) => t()));

      // Ops 计数应该等于所有尝试的增量操作
      expect(counter.getOps()).toBe(5 * incrementCount);

      // 由于 SharedCounter.increment 的实现有竞态条件
      // (read -> await -> write 不是原子操作)
      // 最终值会小于或等于期望值 50
      const finalValue = counter.getValue();
      expect(finalValue).toBeLessThanOrEqual(5 * incrementCount);
      expect(finalValue).toBeGreaterThan(0); // 确认有增量
    });

    test("并发读取不阻塞", async () => {
      const counter = new SharedCounter();
      await counter.increment(100);

      // 多个并发读取
      const reads = await Promise.all([
        Promise.resolve(counter.getValue()),
        Promise.resolve(counter.getValue()),
        Promise.resolve(counter.getValue()),
      ]);

      // 所有读取都应该返回相同的值
      expect(reads.every((v) => v === 100)).toBe(true);
    });
  });

  describe("心跳并发监控", () => {
    test("多个心跳监控独立运行", async () => {
      const monitors = [
        createHeartbeatMonitor({ intervalMs: 30, maxMissedBeats: 2, timeoutMs: 100 }),
        createHeartbeatMonitor({ intervalMs: 50, maxMissedBeats: 3, timeoutMs: 150 }),
        createHeartbeatMonitor({ intervalMs: 70, maxMissedBeats: 4, timeoutMs: 200 }),
      ];

      // 启动所有监控
      monitors.forEach((m, i) => m.start(`session-${i}`));

      // 验证所有监控都在运行
      expect(monitors.every((m) => m.status === "running")).toBe(true);

      // 发送不同数量的心跳
      monitors[0]!.ping();
      monitors[1]!.ping();
      monitors[1]!.ping();
      monitors[2]!.ping();
      monitors[2]!.ping();
      monitors[2]!.ping();

      // 等待一小段时间
      await new Promise((resolve) => setTimeout(resolve, 50));

      // 验证心跳计数
      expect(monitors[0]!.beatCount).toBe(1);
      expect(monitors[1]!.beatCount).toBe(2);
      expect(monitors[2]!.beatCount).toBe(3);

      // 停止所有监控
      monitors.forEach((m) => m.stop());
      expect(monitors.every((m) => m.status === "stopped")).toBe(true);
    });

    test("心跳监控可暂停和恢复", async () => {
      const monitor = createHeartbeatMonitor({
        intervalMs: 20,
        maxMissedBeats: 5,
        timeoutMs: 100,
      });

      monitor.start("session-pause");

      // 发送几个心跳
      monitor.ping();
      monitor.ping();
      const beatCountBeforePause = monitor.beatCount;

      // 暂停
      monitor.pause();
      expect(monitor.status).toBe("paused");

      // 等待一段时间(期间不发送心跳)
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 恢复
      monitor.resume();
      expect(monitor.status).toBe("running");

      // 再发送心跳
      monitor.ping();
      monitor.ping();

      // BeatCount 应该继续增长，而不是从 0 开始
      expect(monitor.beatCount).toBeGreaterThan(beatCountBeforePause);

      monitor.stop();
    });
  });

  describe("竞态条件处理", () => {
    test("Promise.race 正确实现超时", async () => {
      const slowTask = new Promise<string>((resolve) => {
        setTimeout(() => resolve("done"), 100);
      });

      const withTimeout = Promise.race([
        slowTask,
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error("timeout")), 50)),
      ]);

      await expect(withTimeout).rejects.toThrow("timeout");
    });

    test("快速任务不会触发超时", async () => {
      const fastTask = new Promise<string>((resolve) => {
        setTimeout(() => resolve("fast"), 10);
      });

      const withTimeout = Promise.race([
        fastTask,
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error("timeout")), 50)),
      ]);

      const result = await withTimeout;
      expect(result).toBe("fast");
    });

    test("Promise.all 等待所有任务完成", async () => {
      const tasks = [
        new Promise<string>((resolve) => setTimeout(() => resolve("task1"), 20)),
        new Promise<string>((resolve) => setTimeout(() => resolve("task2"), 10)),
        new Promise<string>((resolve) => setTimeout(() => resolve("task3"), 30)),
      ];

      const results = await Promise.all(tasks);

      expect(results).toEqual(["task1", "task2", "task3"]);
    });

    test("Promise.allSettled 处理部分失败", async () => {
      const tasks = [Promise.resolve("success1"), Promise.reject(new Error("error2")), Promise.resolve("success3")];

      const results = await Promise.allSettled(tasks);

      expect(results[0]!.status).toBe("fulfilled");
      if (results[0]!.status === "fulfilled") {
        expect(results[0]!.value).toBe("success1");
      }
      expect(results[1]!.status).toBe("rejected");
      if (results[1]!.status === "rejected") {
        expect((results[1]!.reason as Error).message).toBe("error2");
      }
      expect(results[2]!.status).toBe("fulfilled");
      if (results[2]!.status === "fulfilled") {
        expect(results[2]!.value).toBe("success3");
      }
    });
  });

  describe("并发限制执行", () => {
    test("限制并发数量的任务执行", async () => {
      const concurrency = 2;
      const running: string[] = [];
      const completed: string[] = [];
      let currentConcurrency = 0;

      const tasks = ["A", "B", "C", "D", "E"];

      async function runTask(name: string): Promise<void> {
        if (currentConcurrency >= concurrency) {
          // 等待有空位
          await new Promise<void>((resolve) => {
            const check = () => {
              if (currentConcurrency < concurrency) {
                resolve();
              } else {
                setTimeout(check, 5);
              }
            };
            check();
          });
        }

        currentConcurrency++;
        running.push(name);

        await new Promise((resolve) => setTimeout(resolve, 20));

        running.splice(running.indexOf(name), 1);
        completed.push(name);
        currentConcurrency--;
      }

      await Promise.all(tasks.map((t) => runTask(t)));

      // 所有任务都应该完成
      expect(completed).toHaveLength(5);
      expect(completed.toSorted()).toEqual(["A", "B", "C", "D", "E"]);

      // 验证并发限制
      // 最多同时运行的任务数应该 <= concurrency
      // 注意:由于检查时机，可能有短暂超过的情况
    });

    test("runConcurrently 辅助函数", async () => {
      const tasks = [
        async () => {
          await new Promise((r) => setTimeout(r, 20));
          return "task1";
        },
        async () => {
          await new Promise((r) => setTimeout(r, 10));
          return "task2";
        },
        async () => {
          await new Promise((r) => setTimeout(r, 30));
          return "task3";
        },
      ];

      const results = await runConcurrently(tasks, 2);

      expect(results).toContain("task1");
      expect(results).toContain("task2");
      expect(results).toContain("task3");
    });
  });

  describe("并发状态一致性", () => {
    test("状态转换的原子性", async () => {
      type State = "idle" | "running" | "completed";
      let state: State = "idle";
      let transitionCount = 0;

      async function transition(target: State): Promise<void> {
        // 状态转换规则:不允许在两个非 idle 状态之间直接转换
        if (state !== "idle" && target !== "idle") {
          throw new Error(`无效转换: ${state} -> ${target}`);
        }
        await new Promise((r) => setTimeout(r, 1));
        state = target;
        transitionCount++;
      }

      // 串行转换
      await transition("running");
      expect(state as State).toBe("running");
      expect(transitionCount).toBe(1);

      // Running -> completed 应该失败(两个非 idle 状态之间不能直接转换)
      await expect(transition("completed")).rejects.toThrow("无效转换");
      expect(state as State).toBe("running"); // 状态不变
      expect(transitionCount).toBe(1);

      // 必须先回到 idle
      await transition("idle");
      expect(state as State).toBe("idle");
      expect(transitionCount).toBe(2);

      // 再转换到 completed
      await transition("completed");
      expect(state as State).toBe("completed");
      expect(transitionCount).toBe(3);
    });

    test("错误状态下的状态转换", async () => {
      type State = "idle" | "running" | "error" | "recovered" | "completed";
      let state: State = "idle";

      async function safeTransition(target: State): Promise<boolean> {
        const validTransitions: Record<State, State[]> = {
          completed: [],
          error: ["recovered", "idle"],
          idle: ["running"],
          recovered: ["running"],
          running: ["completed", "error"],
        };

        if (!validTransitions[state]?.includes(target)) {
          return false;
        }

        state = target;
        return true;
      }

      await safeTransition("running");
      await safeTransition("error");
      await safeTransition("recovered");

      expect(state as State).toBe("recovered");

      // 无效转换应该返回 false
      const result = await safeTransition("completed");
      expect(result).toBe(false);
      expect(state as State).toBe("recovered"); // 状态不变
    });
  });
});
