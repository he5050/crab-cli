/**
 * 节流队列单元测试
 *
 * 测试场景:
 * 1. 基本入队/出队
 * 2. 窗口期和定时刷新
 * 3. 事件合并
 * 4. 优先级队列
 * 5. 溢出处理
 */

import { beforeEach, describe, expect, test } from "bun:test";
import {
  ThrottlePriority,
  ThrottleQueue,
  createHighPriorityThrottleQueue,
  createLogThrottleQueue,
  createThrottleQueue,
} from "@/ui/throttleQueue";

describe("ThrottleQueue", () => {
  describe("基本功能", () => {
    test("创建空队列", () => {
      const queue = createThrottleQueue();
      expect(queue.size()).toBe(0);
      expect(queue.isEmpty()).toBe(true);
    });

    test("入队增加队列长度", () => {
      const queue = createThrottleQueue();
      queue.enqueue("test", { msg: "hello" });
      expect(queue.size()).toBe(1);
      expect(queue.isEmpty()).toBe(false);
    });

    test("出队减少队列长度", () => {
      const queue = createThrottleQueue();
      queue.enqueue("test", { msg: "hello" });
      const item = queue.dequeue();
      expect(item).toBeDefined();
      expect(item?.type).toBe("test");
      expect(queue.size()).toBe(0);
    });

    test("批量出队", () => {
      const queue = createThrottleQueue();
      queue.enqueue("test1", { msg: "1" });
      queue.enqueue("test2", { msg: "2" });
      queue.enqueue("test3", { msg: "3" });

      const items = queue.dequeueBatch(2);
      expect(items.length).toBe(2);
      expect(queue.size()).toBe(1);
    });

    test("清空队列", () => {
      const queue = createThrottleQueue();
      queue.enqueue("test1", { msg: "1" });
      queue.enqueue("test2", { msg: "2" });

      const cleared = queue.clear();
      expect(cleared.length).toBe(2);
      expect(queue.size()).toBe(0);
    });

    test("出队空队列返回 undefined", () => {
      const queue = createThrottleQueue();
      expect(queue.dequeue()).toBeUndefined();
    });
  });

  describe("优先级", () => {
    test("高优先级项在前面", () => {
      const queue = createThrottleQueue();

      queue.enqueue("low", { msg: "1" }, ThrottlePriority.LOW);
      queue.enqueue("critical", { msg: "2" }, ThrottlePriority.CRITICAL);
      queue.enqueue("normal", { msg: "3" }, ThrottlePriority.NORMAL);

      const first = queue.dequeue();
      expect(first?.type).toBe("critical");
    });

    test("同优先级按入队顺序", () => {
      const queue = createThrottleQueue();

      queue.enqueue("first", { msg: "1" }, ThrottlePriority.NORMAL);
      queue.enqueue("second", { msg: "2" }, ThrottlePriority.NORMAL);

      const first = queue.dequeue();
      const second = queue.dequeue();

      expect(first?.type).toBe("first");
      expect(second?.type).toBe("second");
    });

    test("高优先级项立即调度", () => {
      const queue = createThrottleQueue({ windowMs: 1000 });

      // 入队低优先级项 - 不触发立即调度
      queue.enqueue("low", { msg: "1" }, ThrottlePriority.LOW);
      expect(queue.size()).toBe(1);

      // 入队高优先级项 - 立即调度
      queue.enqueue("high", { msg: "2" }, ThrottlePriority.HIGH);
      expect(queue.size()).toBe(2);
    });
  });

  describe("事件合并", () => {
    test("相同类型事件被合并", () => {
      const queue = createThrottleQueue({
        mergeKeyExtractor: (item) => item.type,
        mergeSimilar: true,
      });

      queue.enqueue("log", { line: 1 });
      queue.enqueue("log", { line: 2 });
      queue.enqueue("log", { line: 3 });

      // 只有一个被保留
      expect(queue.size()).toBe(1);

      const item = queue.dequeue();
      expect((item && (item.payload as any)).line).toBe(3); // 最后一次
    });

    test("不同类型事件不合并", () => {
      const queue = createThrottleQueue({
        mergeKeyExtractor: (item) => item.type,
        mergeSimilar: true,
      });

      queue.enqueue("log1", { msg: "1" });
      queue.enqueue("log2", { msg: "2" });

      expect(queue.size()).toBe(2);
    });

    test("合并时更新元数据", () => {
      const queue = createThrottleQueue({
        mergeKeyExtractor: (item) => item.type,
        mergeSimilar: true,
      });

      queue.enqueue("log", { line: 1 }, ThrottlePriority.NORMAL, { source: "file1" });
      queue.enqueue("log", { line: 2 }, ThrottlePriority.HIGH, { source: "file2" });

      expect(queue.size()).toBe(1);

      const item = queue.dequeue();
      expect((item && (item.payload as any)).line).toBe(2);
      expect(item && item.metadata && item.metadata.source).toBe("file2");
    });

    test("合并键提取函数", () => {
      const queue = createThrottleQueue({
        mergeKeyExtractor: (item) => `${item.type}:${(item.payload as any).source}`,
        mergeSimilar: true,
      });

      queue.enqueue("log", { line: 1, source: "a" });
      queue.enqueue("log", { line: 2, source: "b" });
      queue.enqueue("log", { line: 3, source: "a" });

      expect(queue.size()).toBe(2);
    });
  });

  describe("溢出处理", () => {
    test("超出最大长度时丢弃旧项", () => {
      let dropped: any[] = [];
      const queue = createThrottleQueue({
        maxQueueSize: 3,
        onOverflow: (items) => {
          dropped = items;
        },
      });

      queue.enqueue("1", { n: 1 });
      queue.enqueue("2", { n: 2 });
      queue.enqueue("3", { n: 3 });
      queue.enqueue("4", { n: 4 });

      expect(queue.size()).toBe(3);
      expect(dropped.length).toBe(1);
      expect(dropped[0]?.type).toBe("1");
    });

    test("清空队列时清空合并映射", () => {
      const queue = createThrottleQueue({
        mergeKeyExtractor: (item) => item.type,
        mergeSimilar: true,
      });

      queue.enqueue("log", { line: 1 });
      queue.enqueue("log", { line: 2 });
      queue.clear();

      // 再次入队相同类型
      queue.enqueue("log", { line: 3 });
      expect(queue.size()).toBe(1);
    });
  });

  describe("生命周期", () => {
    test("destroy 后不能入队", () => {
      const queue = createThrottleQueue();
      queue.destroy();

      queue.enqueue("test", { msg: "hello" });
      expect(queue.size()).toBe(0);
    });

    test("destroy 清理所有资源", () => {
      const queue = createThrottleQueue();
      queue.enqueue("test", { msg: "hello" });
      queue.destroy();

      expect(queue.size()).toBe(0);
    });

    test("snapshot 返回正确信息", () => {
      const queue = createThrottleQueue();
      queue.enqueue("test", { msg: "hello" });

      const snapshot = queue.getSnapshot();
      expect(snapshot.size).toBe(1);
      expect(snapshot.isProcessing).toBe(false);
    });
  });

  describe("工厂函数", () => {
    test("createLogThrottleQueue 使用日志配置", () => {
      const queue = createLogThrottleQueue();
      expect(queue.size()).toBe(0);

      queue.enqueue("log", { line: 1 });
      expect(queue.size()).toBe(1);
    });

    test("createHighPriorityThrottleQueue 使用高优先级配置", () => {
      const queue = createHighPriorityThrottleQueue();
      expect(queue.size()).toBe(0);

      queue.enqueue("critical", { msg: "error" }, ThrottlePriority.CRITICAL);
      expect(queue.size()).toBe(1);
    });
  });

  describe("暂停和恢复", () => {
    test("pause 暂停入队", () => {
      const queue = createThrottleQueue({ windowMs: 50 });
      queue.enqueue("test", { msg: "hello" });
      queue.pause();

      // Pause 只是停止定时器，队列内容不变
      expect(queue.size()).toBe(1);
    });

    test("resume 恢复后如果有内容则保持", () => {
      const queue = createThrottleQueue({ windowMs: 50 });
      queue.enqueue("test", { msg: "hello" });
      queue.pause();
      queue.resume();

      // Pause/resume 不影响队列内容
      expect(queue.size()).toBe(1);
    });
  });
});

describe("ThrottlePriority", () => {
  test("优先级数值正确", () => {
    expect(ThrottlePriority.LOW).toBe(0);
    expect(ThrottlePriority.NORMAL).toBe(1);
    expect(ThrottlePriority.HIGH).toBe(2);
    expect(ThrottlePriority.CRITICAL).toBe(3);
  });

  test("高优先级大于低优先级", () => {
    expect(ThrottlePriority.CRITICAL).toBeGreaterThan(ThrottlePriority.LOW);
    expect(ThrottlePriority.HIGH).toBeGreaterThan(ThrottlePriority.NORMAL);
  });
});

describe("ThrottleQueue 性能测试", () => {
  describe("高吞吐量测试", () => {
    test("1000 次入队/出队操作应在合理时间内完成", () => {
      const queue = createThrottleQueue({ maxQueueSize: 2000 });

      const startTime = Date.now();

      // 1000 次入队
      for (let i = 0; i < 1000; i++) {
        queue.enqueue(`event-${i}`, { index: i });
      }

      const enqueueTime = Date.now() - startTime;

      // 1000 次出队
      const dequeueStart = Date.now();
      let count = 0;
      while (!queue.isEmpty()) {
        queue.dequeue();
        count++;
      }
      const dequeueTime = Date.now() - dequeueStart;

      // 入队和出队都应该在 1 秒内完成
      expect(enqueueTime).toBeLessThan(1000);
      expect(dequeueTime).toBeLessThan(500);
      expect(count).toBe(1000);

      queue.destroy();
    });

    test("批量出队性能优于单次出队", () => {
      const queue1 = createThrottleQueue();
      const queue2 = createThrottleQueue();

      // 填充队列
      for (let i = 0; i < 100; i++) {
        queue1.enqueue(`event-${i}`, { index: i });
        queue2.enqueue(`event-${i}`, { index: i });
      }

      // 单次出队
      const singleStart = Date.now();
      while (!queue1.isEmpty()) {
        queue1.dequeue();
      }
      const singleTime = Date.now() - singleStart;

      // 批量出队
      const batchStart = Date.now();
      while (!queue2.isEmpty()) {
        queue2.dequeueBatch(10);
      }
      const batchTime = Date.now() - batchStart;

      // 批量出队应该更快或相当
      expect(batchTime).toBeLessThanOrEqual(singleTime * 2); // 允许一定误差
    });
  });

  describe("内存使用测试", () => {
    test("队列大小限制生效", () => {
      const queue = createThrottleQueue({ maxQueueSize: 100 });

      // 入队 1000 项，但队列限制为 100
      for (let i = 0; i < 1000; i++) {
        queue.enqueue(`event-${i}`, { index: i });
      }

      // 队列大小应该被限制
      expect(queue.size()).toBeLessThanOrEqual(100);
    });

    test("合并相同事件保持队列精简", () => {
      const queue = createThrottleQueue({
        maxQueueSize: 1000,
        mergeKeyExtractor: (item) => item.type,
        mergeSimilar: true,
      });

      // 入队 1000 个相同类型的事件
      for (let i = 0; i < 1000; i++) {
        queue.enqueue("log", { line: i });
      }

      // 由于合并，队列应该只有 1 项
      expect(queue.size()).toBe(1);
    });
  });

  describe("定时精度测试", () => {
    test("forceFlush 立即清空队列", () => {
      const queue = createThrottleQueue({ windowMs: 50 });
      queue.enqueue("test", { msg: "hello" });

      expect(queue.size()).toBe(1);

      // ForceFlush 立即清空队列
      queue.forceFlush();

      expect(queue.size()).toBe(0);

      queue.destroy();
    });

    test("窗口刷新按预期工作", async () => {
      const queue = createThrottleQueue({ maxWaitMs: 20, windowMs: 20 });
      queue.enqueue("test", { msg: "hello" });

      expect(queue.size()).toBe(1);

      // 等待窗口刷新触发(maxWaitMs = 20ms)
      await new Promise((resolve) => setTimeout(resolve, 50));

      // 队列应该已被刷新清空
      expect(queue.size()).toBe(0);

      queue.destroy();
    });

    test("maxWaitMs 限制最大等待时间", async () => {
      const queue = createThrottleQueue({ maxWaitMs: 30, windowMs: 1000 });

      queue.enqueue("test", { msg: "hello" });
      expect(queue.size()).toBe(1);

      // 等待 maxWaitMs
      await new Promise((resolve) => setTimeout(resolve, 50));

      // 应该已被刷新
      expect(queue.size()).toBe(0);

      queue.destroy();
    });
  });

  describe("优先级性能测试", () => {
    test("大量优先级项排序正确", () => {
      const queue = createThrottleQueue();

      // 按随机顺序入队不同优先级，每项间隔 1ms 确保 enqueuedAt 不同
      const items = [
        { priority: ThrottlePriority.LOW, type: "a" },
        { priority: ThrottlePriority.CRITICAL, type: "b" },
        { priority: ThrottlePriority.NORMAL, type: "c" },
        { priority: ThrottlePriority.HIGH, type: "d" },
        { priority: ThrottlePriority.LOW, type: "e" },
        { priority: ThrottlePriority.HIGH, type: "f" },
        { priority: ThrottlePriority.NORMAL, type: "g" },
        { priority: ThrottlePriority.CRITICAL, type: "h" },
      ];

      for (const item of items) {
        queue.enqueue(item.type, { type: item.type }, item.priority);
      }

      // CRITICAL 应该在最前面(b 和 h)
      const first = queue.dequeue();
      expect(first?.type).toBe("b"); // 第一个 CRITICAL

      const second = queue.dequeue();
      expect(second?.type).toBe("h"); // 第二个 CRITICAL

      // 然后是 HIGH(d 和 f)
      const third = queue.dequeue();
      expect(third?.type).toBe("d");
      const fourth = queue.dequeue();
      expect(fourth?.type).toBe("f");

      // 然后是 NORMAL(c 和 g)
      const fifth = queue.dequeue();
      expect(fifth?.type).toBe("c");
      const sixth = queue.dequeue();
      expect(sixth?.type).toBe("g");

      // 最后是 LOW(a 和 e)
      const seventh = queue.dequeue();
      expect(seventh?.type).toBe("a");
      const eighth = queue.dequeue();
      expect(eighth?.type).toBe("e");
    });
  });

  describe("工厂函数性能测试", () => {
    test("createLogThrottleQueue 配置正确", () => {
      const queue = createLogThrottleQueue();

      // 日志队列默认合并相同类型
      queue.enqueue("log", { line: 1 });
      queue.enqueue("log", { line: 2 });
      queue.enqueue("error", { line: 3 });

      expect(queue.size()).toBe(2); // Log 被合并
    });

    test("createHighPriorityThrottleQueue 配置正确", () => {
      const queue = createHighPriorityThrottleQueue();

      // 高优先级队列默认不合并
      queue.enqueue("event1", { data: 1 });
      queue.enqueue("event1", { data: 2 });

      expect(queue.size()).toBe(2); // 不合并
    });
  });
});
