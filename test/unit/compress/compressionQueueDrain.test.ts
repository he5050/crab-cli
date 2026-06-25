/**
 * CompressionQueue drainQueue 测试。
 *
 * 测试用例:
 *   - 并发执行（maxConcurrency 限制）
 *   - drainQueue 按优先级调度
 *   - 任务完成后自动调度下一个
 *   - 超时处理
 *   - 任务失败后继续调度
 *   - waitForAll 等待所有任务完成
 *   - 暂停状态下不消费
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { CompressionQueue, CompressionPriority } from "@/compress/runtime/compressionQueue";

describe("CompressionQueue drainQueue", () => {
  let queue: CompressionQueue;

  beforeEach(() => {
    queue = new CompressionQueue({ maxConcurrency: 1, taskTimeoutMs: 5000 });
  });

  afterEach(() => {
    queue.clear();
  });

  test("maxConcurrency=1 时串行执行", async () => {
    const order: number[] = [];
    let resolve1: () => void;
    let resolve2: () => void;

    const p1 = new Promise<void>((r) => {
      resolve1 = r;
    });
    const p2 = new Promise<void>((r) => {
      resolve2 = r;
    });

    queue.enqueue("s1", async () => {
      order.push(1);
      await p1;
    });
    queue.enqueue("s2", async () => {
      order.push(2);
      await p2;
    });

    // 第一个任务应该在运行
    await new Promise((r) => setTimeout(r, 50));
    expect(queue.runningCount()).toBe(1);
    expect(order).toEqual([1]);

    // 完成第一个，第二个开始
    resolve1!();
    await new Promise((r) => setTimeout(r, 50));
    expect(order).toEqual([1, 2]);

    // 完成第二个
    resolve2!();
    await queue.waitForAll();
    expect(queue.runningCount()).toBe(0);
  });

  test("maxConcurrency=2 时并发执行两个任务", async () => {
    queue = new CompressionQueue({ maxConcurrency: 2, taskTimeoutMs: 5000 });

    let running = 0;
    const maxRunning: number[] = [];

    const track = async (id: number) => {
      running++;
      maxRunning.push(running);
      await new Promise((r) => setTimeout(r, 50));
      running--;
    };

    queue.enqueue("s1", () => track(1));
    queue.enqueue("s2", () => track(2));
    queue.enqueue("s3", () => track(3));

    await queue.waitForAll();

    // 至少有一个时刻 2 个任务在同时运行
    expect(Math.max(...maxRunning)).toBeGreaterThanOrEqual(2);
    expect(queue.runningCount()).toBe(0);
  });

  test("按优先级调度（高优先级先执行）", async () => {
    queue = new CompressionQueue({ maxConcurrency: 1, taskTimeoutMs: 5000 });

    const order: string[] = [];
    let resolveFirst: () => void;

    const p1 = new Promise<void>((r) => {
      resolveFirst = r;
    });

    // 入队顺序: LOW, NORMAL, HIGH
    queue.enqueue(
      "s-low",
      async () => {
        order.push("low");
      },
      { priority: CompressionPriority.LOW },
    );
    queue.enqueue(
      "s-normal",
      async () => {
        order.push("normal");
      },
      { priority: CompressionPriority.NORMAL },
    );
    queue.enqueue(
      "s-high",
      async () => {
        order.push("high");
        // 等待以阻塞队列
        await p1;
      },
      { priority: CompressionPriority.HIGH },
    );

    // 让 microtask 排序生效
    await new Promise((r) => setTimeout(r, 30));

    // HIGH 应该先执行
    expect(order).toEqual(["high"]);

    // 释放后等待所有完成
    resolveFirst!();
    await queue.waitForAll();
    // 所有 3 个都执行了，且 HIGH 是第一个
    expect(order).toHaveLength(3);
    expect(order[0]).toBe("high");
  });

  test("任务失败后继续调度下一个", async () => {
    const results: string[] = [];

    queue.enqueue("s-fail", async () => {
      throw new Error("任务失败");
    });
    queue.enqueue("s-ok", async () => {
      results.push("ok");
    });

    await queue.waitForAll();

    expect(results).toEqual(["ok"]);
    expect(queue.runningCount()).toBe(0);
    expect(queue.size()).toBe(0);
  });

  test("暂停状态下不消费队列", async () => {
    queue.pause();

    const executed: string[] = [];
    queue.enqueue("s1", async () => {
      executed.push("s1");
    });

    await new Promise((r) => setTimeout(r, 100));
    expect(executed).toHaveLength(0);
    expect(queue.size()).toBe(1);

    // 恢复后应该消费
    queue.resume();
    await queue.waitForAll();
    expect(executed).toEqual(["s1"]);
  });

  test("waitForAll 在任务完成后 resolve", async () => {
    let resolveTask: () => void;
    const p = new Promise<void>((r) => {
      resolveTask = r;
    });

    queue.enqueue("s1", async () => {
      await p;
    });

    // 等待 microtask 调度生效
    await new Promise((r) => setTimeout(r, 30));
    expect(queue.runningCount()).toBe(1);

    resolveTask!();
    await queue.waitForAll();
    expect(queue.runningCount()).toBe(0);
  });

  test("超时任务自动取消并调度下一个", async () => {
    queue = new CompressionQueue({ maxConcurrency: 1, taskTimeoutMs: 100 });

    const results: string[] = [];
    queue.enqueue("s-slow", async () => {
      await new Promise((r) => setTimeout(r, 10000)); // 模拟超时
      results.push("slow");
    });
    queue.enqueue("s-fast", async () => {
      results.push("fast");
    });

    await queue.waitForAll();

    // 超时后 fast 应该执行
    expect(results).toEqual(["fast"]);
    expect(queue.size()).toBe(0);
  });

  test("subscribe 在任务完成时触发回调", async () => {
    const changes: number[] = [];
    queue.subscribe(() => {
      changes.push(Date.now());
    });

    queue.enqueue("s1", async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    await queue.waitForAll();

    // 至少有一次状态变更（完成时）
    expect(changes.length).toBeGreaterThanOrEqual(1);
  });

  test("getSummary 在执行过程中反映运行状态", async () => {
    let resolveTask: () => void;
    const p = new Promise<void>((r) => {
      resolveTask = r;
    });

    queue.enqueue("s1", async () => {
      await p;
    });

    await new Promise((r) => setTimeout(r, 30));
    const summary = queue.getSummary();
    expect(summary.running).toBe(1);
    expect(summary.pending).toBe(0);

    resolveTask!();
    await queue.waitForAll();
  });

  test("completedTasks 记录已完成的任务", async () => {
    queue.enqueue("s1", async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    queue.enqueue("s2", async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    await queue.waitForAll();

    const summary = queue.getSummary();
    expect(summary.completed).toBe(2);
  });
});
