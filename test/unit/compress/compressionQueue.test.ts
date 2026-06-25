/**
 * CompressionQueue 测试。
 *
 * 测试用例:
 *   - 入队和执行
 *   - 取消任务
 *   - 暂停/恢复
 *   - 优先级排序
 *   - 队列状态摘要
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { CompressionQueue, createCompressionQueue, CompressionPriority } from "@/compress/runtime/compressionQueue";

describe("CompressionQueue", () => {
  let queue: CompressionQueue;

  beforeEach(() => {
    queue = new CompressionQueue({ maxConcurrency: 2, taskTimeoutMs: 1000 });
  });

  afterEach(() => {
    queue.clear();
  });

  test("初始状态为空", () => {
    expect(queue.size()).toBe(0);
    expect(queue.runningCount()).toBe(0);
  });

  test("enqueue 返回任务 ID", () => {
    const id = queue.enqueue("session-1", async () => {});
    expect(id).toBeTruthy();
    expect(id.startsWith("compress-")).toBe(true);
  });

  test("队列满时 reject 策略抛出错误", () => {
    const tinyQueue = createCompressionQueue({
      maxConcurrency: 1,
      maxQueueSize: 2,
      onQueueFull: "reject",
    });

    tinyQueue.enqueue("s1", async () => {});
    tinyQueue.enqueue("s2", async () => {});

    expect(() => tinyQueue.enqueue("s3", async () => {})).toThrow("压缩队列已满");
  });

  test("队列满时 drop-lowest 策略丢弃低优先级", () => {
    const tinyQueue = createCompressionQueue({
      maxConcurrency: 1,
      maxQueueSize: 2,
      onQueueFull: "drop-lowest",
    });

    tinyQueue.enqueue("low", async () => {}, { priority: CompressionPriority.LOW });
    tinyQueue.enqueue("high", async () => {}, { priority: CompressionPriority.HIGH });
    // 第 3 个会触发 drop-lowest，踢掉 "low"
    const id = tinyQueue.enqueue("normal", async () => {}, { priority: CompressionPriority.NORMAL });

    expect(id).toBeTruthy();
    const tasks = tinyQueue.getSessionTasks("low");
    expect(tasks).toHaveLength(0);
  });

  test("cancel 取消等待中的任务", () => {
    const id = queue.enqueue("session-1", async () => {}, { priority: CompressionPriority.LOW });
    // 由于 maxConcurrency=2 且队列没在消费，任务应该在队列中
    const result = queue.cancel(id);
    expect(result).toBe(true);
  });

  test("cancel 不存在的任务返回 false", () => {
    expect(queue.cancel("nonexistent")).toBe(false);
  });

  test("cancelSession 取消会话的所有任务", () => {
    queue.enqueue("session-1", async () => {});
    queue.enqueue("session-1", async () => {});
    queue.enqueue("session-2", async () => {});

    const count = queue.cancelSession("session-1");
    expect(count).toBe(2);
  });

  test("pause 暂停队列", () => {
    queue.pause();
    const summary = queue.getSummary();
    expect(summary.isPaused).toBe(true);
  });

  test("resume 恢复队列", () => {
    queue.pause();
    queue.resume();
    const summary = queue.getSummary();
    expect(summary.isPaused).toBe(false);
  });

  test("clear 清空队列", () => {
    queue.enqueue("s1", async () => {});
    queue.enqueue("s2", async () => {});
    queue.clear();
    expect(queue.size()).toBe(0);
  });

  test("getSummary 返回正确摘要", () => {
    queue.enqueue("s1", async () => {});
    const summary = queue.getSummary();
    expect(summary.pending).toBe(1);
    expect(summary.running).toBe(0);
    expect(summary.isPaused).toBe(false);
  });

  test("getSessionTasks 返回指定会话的任务", () => {
    queue.enqueue("s1", async () => {});
    queue.enqueue("s1", async () => {});
    queue.enqueue("s2", async () => {});

    const s1Tasks = queue.getSessionTasks("s1");
    expect(s1Tasks).toHaveLength(2);
  });

  test("subscribe 返回取消订阅函数", () => {
    const unsub = queue.subscribe(() => {});
    queue.enqueue("s1", async () => {});
    unsub();
    expect(typeof unsub).toBe("function");
  });

  test("waitForAll 在队列为空时立即 resolve", async () => {
    await expect(queue.waitForAll()).resolves.toBeUndefined();
  });

  test("createCompressionQueue 创建实例", () => {
    const q = createCompressionQueue({ maxConcurrency: 3 });
    expect(q).toBeDefined();
    expect(q.size()).toBe(0);
  });
});
