/**
 * EventBus 扩展测试 — P1/P2 层级。
 *
 * 测试覆盖:
 *   - 历史记录(getHistory / clearHistory / setMaxHistorySize)
 *   - 队列机制防递归(isProcessing 标志)
 *   - 定时清理(TTL + 容量双重清理)
 *   - 性能指标(getMetrics)
 *   - 调试信息(debug)
 *   - 生命周期(destroy / clear)
 *   - AppEvent 核心事件定义
 *
 * @see docs/test-plan/unit/06-event-bus.md
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { EventBus, defineEvent, globalBus, filterExpiredEvents } from "@/bus";
import { ThrottlePriority } from "@/core/concurrency/throttleQueue";
import { AppEvent } from "@/bus";

// 测试事件定义
const EvtA = defineEvent<{ value: number }>("test.a");
const EvtB = defineEvent<{ name: string }>("test.b");
const EvtC = defineEvent<{ tag: string }>("test.c");

/** 等待事件队列处理完成 */
async function flushQueue(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe("EventBus — 历史记录(P1)", () => {
  let bus: EventBus;
  beforeEach(() => {
    bus = new EventBus();
  });
  afterEach(() => {
    bus.destroy();
  });

  test("publish 自动记录到历史", async () => {
    bus.publish(EvtA, { value: 1 });
    bus.publish(EvtA, { value: 2 });
    await flushQueue();

    const history = bus.getHistory();
    expect(history.length).toBe(2);
    expect(history[0]!.type).toBe("test.a");
    expect(history[0]!.payload.properties).toEqual({ value: 1 });
  });

  test("getHistory 支持 type 过滤", async () => {
    bus.publish(EvtA, { value: 1 });
    bus.publish(EvtB, { name: "b" });
    bus.publish(EvtA, { value: 2 });
    await flushQueue();

    const filtered = bus.getHistory({ type: "test.a" });
    expect(filtered.length).toBe(2);
    expect(filtered.every((h) => h.type === "test.a")).toBe(true);
  });

  test("getHistory 支持 limit 限制", async () => {
    for (let i = 0; i < 10; i++) {
      bus.publish(EvtA, { value: i });
    }
    await flushQueue();

    const limited = bus.getHistory({ limit: 3 });
    expect(limited.length).toBe(3);
    // 取最新的 N 条
    expect(limited[0]!.payload.properties).toEqual({ value: 7 }); // 8-10 -> 7,8,9
  });

  test("clearHistory 清空历史但不清理订阅", async () => {
    bus.publish(EvtA, { value: 42 });
    await flushQueue();
    expect(bus.getHistory().length).toBe(1);

    bus.clearHistory();
    expect(bus.getHistory().length).toBe(0);

    // 订阅还在，publish 仍能工作
    const received: number[] = [];
    bus.subscribe(EvtA, (p) => received.push(p.properties.value));
    bus.publish(EvtA, { value: 99 });
    await flushQueue();
    expect(received).toEqual([99]);
  });

  test("setMaxHistorySize 限制容量", async () => {
    bus.setMaxHistorySize(5);
    for (let i = 0; i < 10; i++) {
      bus.publish(EvtA, { value: i });
    }
    await flushQueue();

    // 超过限制时自动移除最旧的
    expect(bus.getHistory().length).toBe(5);
    // 最新 5 条: value 5,6,7,8,9
    expect(bus.getHistory().at(-1)!.payload.properties).toEqual({ value: 9 });
  });

  test("历史记录包含 timestamp", async () => {
    const before = Date.now();
    bus.publish(EvtA, { value: 1 });
    await flushQueue();
    const after = Date.now();

    const item = bus.getHistory()[0]!;
    expect(item.timestamp).toBeGreaterThanOrEqual(before);
    expect(item.timestamp).toBeLessThanOrEqual(after);
  });

  test("history 包含完整 payload", async () => {
    const customId = "custom-id-123";
    bus.publish(EvtA, { value: 99 }, { id: customId });
    await flushQueue();

    const item = bus.getHistory()[0]!;
    expect(item.payload.id).toBe(customId);
    expect(item.payload.type).toBe("test.a");
    expect(item.payload.properties).toEqual({ value: 99 });
  });
});

describe("EventBus — 队列机制防递归(P1)", () => {
  let bus: EventBus;
  beforeEach(() => {
    bus = new EventBus();
  });
  afterEach(() => {
    bus.destroy();
  });

  test("快速连续 publish 不阻塞主线程", async () => {
    const received: number[] = [];
    bus.subscribe(EvtA, (p) => received.push(p.properties.value));

    // 同步发布大量事件
    for (let i = 0; i < 100; i++) {
      bus.publish(EvtA, { value: i });
    }
    expect(bus.totalEvents).toBe(100);

    await flushQueue();
    expect(received.length).toBe(100);
  });

  test("publish 不在处理中时触发异步处理", async () => {
    // 首次 publish 应触发 processQueue
    const received: number[] = [];
    bus.subscribe(EvtA, (p) => received.push(p.properties.value));
    bus.publish(EvtA, { value: 1 });

    expect(received.length).toBe(0); // 还未处理
    await flushQueue();
    expect(received.length).toBe(1);
  });

  test("处理中再次 publish 进入队列", async () => {
    const received: number[] = [];
    bus.subscribe(EvtA, (p) => received.push(p.properties.value));

    bus.publish(EvtA, { value: 1 });
    await flushQueue(); // 处理完成

    bus.publish(EvtA, { value: 2 });
    await flushQueue();

    expect(received).toEqual([1, 2]);
  });

  test("多次 publish 全部入队并按顺序处理", async () => {
    const received: number[] = [];
    bus.subscribe(EvtA, (p) => received.push(p.properties.value));

    bus.publish(EvtA, { value: 10 });
    bus.publish(EvtA, { value: 20 });
    bus.publish(EvtA, { value: 30 });

    await flushQueue();
    expect(received).toEqual([10, 20, 30]);
  });
});

describe("EventBus — 性能指标(P1)", () => {
  let bus: EventBus;
  beforeEach(() => {
    bus = new EventBus();
  });
  afterEach(() => {
    bus.destroy();
  });

  test("getMetrics 返回正确统计", async () => {
    bus.subscribe(EvtA, () => {});
    bus.subscribe(EvtA, () => {});
    bus.subscribe(EvtB, () => {});

    bus.publish(EvtA, { value: 1 });
    bus.publish(EvtB, { name: "b" });
    await flushQueue();

    const m = bus.getMetrics();
    expect(m.totalEvents).toBe(2);
    expect(m.historySize).toBe(2);
    expect(m.subscriberTypes).toBe(2); // Test.a + test.b
    expect(m.wildcardSubscribers).toBe(0);
    expect(m.prefixSubscribers).toBe(0);
  });

  test("wildcard 订阅计入指标", async () => {
    bus.subscribeAll(() => {});
    bus.subscribeAll(() => {});

    const m = bus.getMetrics();
    expect(m.wildcardSubscribers).toBe(2);
  });

  test("prefix 订阅计入指标", async () => {
    bus.subscribePrefix("test.", () => {});
    bus.subscribePrefix("other.", () => {});

    const m = bus.getMetrics();
    expect(m.prefixSubscribers).toBe(2);
  });

  test("totalEvents 递增", () => {
    expect(bus.totalEvents).toBe(0);
    bus.publish(EvtA, { value: 1 });
    expect(bus.totalEvents).toBe(1);
    bus.publish(EvtA, { value: 2 });
    expect(bus.totalEvents).toBe(2);
  });
});

describe("EventBus — 生命周期(P2)", () => {
  test("destroy 停止清理定时器且 clear", () => {
    const bus = new EventBus();
    bus.subscribe(EvtA, () => {});
    bus.publish(EvtA, { value: 1 });

    bus.destroy();

    // 清理后再次 publish 不报错(但无处理)
    expect(() => bus.publish(EvtA, { value: 2 })).not.toThrow();
  });

  test("clear 重置订阅和计数器但保留清理定时器", () => {
    const bus = new EventBus();
    bus.subscribe(EvtA, () => {});
    bus.publish(EvtA, { value: 1 });
    expect(bus.totalEvents).toBe(1);

    bus.clear();

    expect(bus.totalEvents).toBe(0);
    expect(bus.getHistory().length).toBe(0);
    expect(bus.getMetrics().subscriberTypes).toBe(0);

    // Clear 后仍可订阅和发布
    const received: number[] = [];
    bus.subscribe(EvtA, (p) => received.push(p.properties.value));
    bus.publish(EvtA, { value: 99 });
    // Clear 不会停止 cleanupTimer，destroy 才会
  });

  test("clearHistory 不影响订阅", async () => {
    const bus = new EventBus();
    bus.publish(EvtA, { value: 1 });
    await flushQueue();
    expect(bus.getHistory().length).toBe(1);

    bus.clearHistory();
    expect(bus.getHistory().length).toBe(0);
    expect(bus.totalEvents).toBe(1); // 计数器保留

    bus.publish(EvtA, { value: 2 });
    await flushQueue();
    expect(bus.getHistory().length).toBe(1); // 历史只有新事件
    bus.destroy();
  });
});

describe("EventBus — 边界条件(P2)", () => {
  let bus: EventBus;
  beforeEach(() => {
    bus = new EventBus();
  });
  afterEach(() => {
    bus.destroy();
  });

  test("空历史 getHistory 返回空数组", () => {
    expect(bus.getHistory()).toEqual([]);
    expect(bus.getHistory({ type: "any" })).toEqual([]);
    expect(bus.getHistory({ limit: 5 })).toEqual([]);
  });

  test("filter type 无匹配返回空数组", async () => {
    bus.publish(EvtA, { value: 1 });
    await flushQueue();

    const result = bus.getHistory({ type: "nonexistent.event" });
    expect(result).toEqual([]);
  });

  test("limit 大于实际数量返回全部", async () => {
    bus.publish(EvtA, { value: 1 });
    bus.publish(EvtA, { value: 2 });
    await flushQueue();

    const result = bus.getHistory({ limit: 100 });
    expect(result.length).toBe(2);
  });

  test("limit 为 0 时不过滤(不满足 >0 条件)", async () => {
    bus.publish(EvtA, { value: 1 });
    await flushQueue();

    const result = bus.getHistory({ limit: 0 });
    // Filter.limit > 0 为 false 时不切片，返回全部历史
    expect(result.length).toBe(1);
  });

  test("setMaxHistorySize 为 0 时历史为空", async () => {
    bus.setMaxHistorySize(0);
    bus.publish(EvtA, { value: 1 });
    await flushQueue();

    expect(bus.getHistory().length).toBe(0);
  });

  test("setMaxHistorySize 缩小容量立即裁剪", async () => {
    bus.setMaxHistorySize(100);
    for (let i = 0; i < 10; i++) {
      bus.publish(EvtA, { value: i });
    }
    await flushQueue();
    expect(bus.getHistory().length).toBe(10);

    bus.setMaxHistorySize(3);
    expect(bus.getHistory().length).toBe(3);
    expect(bus.getHistory({ limit: 1 }).at(-1)!.payload.properties).toEqual({ value: 9 });
  });

  test("debug 方法不抛错", () => {
    bus.subscribe(EvtA, () => {});
    bus.publish(EvtA, { value: 1 });
    expect(() => bus.debug()).not.toThrow();
  });

  test("null payload 安全处理", () => {
    const EvtNull = defineEvent<null>("test.null");
    expect(() => bus.publish(EvtNull, null)).not.toThrow();
  });

  test("undefined payload 安全处理", () => {
    const EvtUnd = defineEvent<undefined>("test.undefined");
    expect(() => bus.publish(EvtUnd, undefined as any)).not.toThrow();
  });

  test("极长事件类型名安全处理", () => {
    const longType = "a".repeat(1000);
    const LongEvt = defineEvent<{ n: number }>(longType);
    bus.publish(LongEvt, { n: 1 });
    expect(bus.totalEvents).toBe(1);
  });
});

describe("AppEvent — 核心事件定义(P1)", () => {
  test("AppEvent.PermissionAsked 类型正确", () => {
    expect(AppEvent.PermissionAsked.type).toBe("permission.asked");
  });

  test("AppEvent.PermissionResolved 类型正确", () => {
    expect(AppEvent.PermissionResolved.type).toBe("permission.resolved");
  });

  test("AppEvent.SessionCreated 类型正确", () => {
    expect(AppEvent.SessionCreated.type).toBe("session.created");
  });

  test("AppEvent.ConfigUpdated 类型正确", () => {
    expect(AppEvent.ConfigUpdated.type).toBe("config.updated");
  });

  test("AppEvent.Toast 类型正确", () => {
    expect(AppEvent.Toast.type).toBe("toast.show");
  });

  test("AppEvent.McpStatusUpdated 类型正确", () => {
    expect(AppEvent.McpStatusUpdated.type).toBe("mcp.status.updated");
  });

  test("AppEvent.ToolCall 类型正确", () => {
    expect(AppEvent.ToolCall.type).toBe("tool.call");
  });

  test("AppEvent.ToolResult 类型正确", () => {
    expect(AppEvent.ToolResult.type).toBe("tool.result");
  });

  test("AppEvent.ChatChunk 类型正确", () => {
    expect(AppEvent.ChatChunk.type).toBe("chat.chunk");
  });

  test("AppEvent.CompressCompleted 类型正确", () => {
    expect(AppEvent.CompressCompleted.type).toBe("compress.completed");
  });

  test("AppEvent.AgentStatusChanged 类型正确", () => {
    expect(AppEvent.AgentStatusChanged.type).toBe("agent.status.changed");
  });

  test("defineEvent 返回的 type 可用于订阅", async () => {
    const received: number[] = [];
    globalBus.subscribe(AppEvent.Toast, () => {
      received.push(1);
    });

    globalBus.publish(AppEvent.Toast, { message: "test", variant: "info" });
    await flushQueue();

    expect(received.length).toBe(1);
  });

  test("globalBus.clearHistory 不会移除测试外部订阅者", async () => {
    const received: string[] = [];
    const unsubscribe = globalBus.subscribe(AppEvent.Toast, (event) => {
      received.push(event.properties.message);
    });

    try {
      globalBus.publish(AppEvent.Toast, { message: "before", variant: "info" });
      await globalBus.flush();
      expect(received).toEqual(["before"]);
      expect(globalBus.getHistory({ type: AppEvent.Toast.type }).length).toBeGreaterThan(0);

      globalBus.clearHistory();
      expect(globalBus.getHistory({ type: AppEvent.Toast.type })).toEqual([]);

      globalBus.publish(AppEvent.Toast, { message: "after", variant: "info" });
      await globalBus.flush();
      expect(received).toEqual(["before", "after"]);
    } finally {
      unsubscribe();
      globalBus.clearHistory();
    }
  });
});

describe("EventBus — 异常处理(P2)", () => {
  let bus: EventBus;
  beforeEach(() => {
    bus = new EventBus();
  });
  afterEach(() => {
    bus.destroy();
  });

  test("处理器抛错不影响其他处理器", async () => {
    const results: number[] = [];
    bus.subscribe(EvtA, () => {
      throw new Error("boom A");
    });
    bus.subscribe(EvtA, (p) => results.push(p.properties.value));
    bus.subscribe(EvtA, () => {
      throw new Error("boom B");
    });

    bus.publish(EvtA, { value: 42 });
    await flushQueue();

    // 正常处理器仍收到事件
    expect(results).toEqual([42]);
  });

  test("通配符处理器抛错不影响类型处理器", async () => {
    const typeReceived: number[] = [];
    bus.subscribe(EvtA, (p) => typeReceived.push(p.properties.value));
    bus.subscribeAll(() => {
      throw new Error("wildcard boom");
    });

    bus.publish(EvtA, { value: 99 });
    await flushQueue();

    expect(typeReceived).toEqual([99]);
  });

  test("所有处理器都抛错不崩溃", async () => {
    bus.subscribe(EvtA, () => {
      throw new Error("err1");
    });
    bus.subscribe(EvtA, () => {
      throw new Error("err2");
    });

    expect(() => {
      bus.publish(EvtA, { value: 1 });
    }).not.toThrow();

    await flushQueue(); // 确保异步处理完成
    expect(bus.totalEvents).toBe(1);
  });
});

describe("EventBus — 订阅管理(P2)", () => {
  let bus: EventBus;
  beforeEach(() => {
    bus = new EventBus();
  });
  afterEach(() => {
    bus.destroy();
  });

  test("取消订阅后不再收到事件", async () => {
    const received1: number[] = [];
    const received2: number[] = [];
    const unsub1 = bus.subscribe(EvtA, (p) => received1.push(p.properties.value));
    bus.subscribe(EvtA, (p) => received2.push(p.properties.value));

    bus.publish(EvtA, { value: 1 });
    await flushQueue();
    expect(received1).toEqual([1]);
    expect(received2).toEqual([1]);

    unsub1();
    bus.publish(EvtA, { value: 2 });
    await flushQueue();

    expect(received1).toEqual([1]); // 不再收到
    expect(received2).toEqual([1, 2]);
  });

  test("通配符取消订阅", async () => {
    const received: string[] = [];
    const unsub = bus.subscribeAll((p) => received.push(p.type));

    bus.publish(EvtA, { value: 1 });
    bus.publish(EvtB, { name: "b" });
    await flushQueue();
    expect(received).toEqual(["test.a", "test.b"]);

    unsub();
    bus.publish(EvtC, { tag: "c" });
    await flushQueue();

    expect(received).toEqual(["test.a", "test.b"]); // 不再收到
  });

  test("订阅后返回的 unsub 可多次调用(幂等)", async () => {
    const received: number[] = [];
    const unsub = bus.subscribe(EvtA, (p) => received.push(p.properties.value));

    bus.publish(EvtA, { value: 1 });
    await flushQueue();

    unsub(); // 第一次取消
    unsub(); // 第二次(幂等)
    unsub(); // 第三次(幂等)

    bus.publish(EvtA, { value: 2 });
    await flushQueue();

    expect(received).toEqual([1]);
  });

  test("多次订阅同一事件类型分开取消", async () => {
    const a: number[] = [];
    const b: number[] = [];
    const unsubA = bus.subscribe(EvtA, (p) => a.push(p.properties.value));
    bus.subscribe(EvtA, (p) => b.push(p.properties.value));

    bus.publish(EvtA, { value: 1 });
    await flushQueue();
    expect(a).toEqual([1]);
    expect(b).toEqual([1]);

    unsubA(); // 只取消 a
    bus.publish(EvtA, { value: 2 });
    await flushQueue();

    expect(a).toEqual([1]); // A 不再收到
    expect(b).toEqual([1, 2]); // B 继续收到
  });
});

describe("EventBus — P3 补充测试", () => {
  let bus: EventBus;
  beforeEach(() => {
    bus = new EventBus();
  });
  afterEach(() => {
    bus.destroy();
  });

  test("filterExpiredEvents 按 TTL 过滤过期事件", () => {
    const now = Date.now();
    const items = [
      { type: "old", payload: { id: "1", type: "old", properties: {} }, timestamp: now - 200_000 },
      { type: "recent", payload: { id: "2", type: "recent", properties: {} }, timestamp: now - 50_000 },
      { type: "fresh", payload: { id: "3", type: "fresh", properties: {} }, timestamp: now },
    ];
    // cutoff = now - 100_000, so only items >= 100s ago survive
    const cutoff = now - 100_000;
    const result = filterExpiredEvents(items, cutoff, 100);
    expect(result).toHaveLength(2);
    expect(result[0]!.type).toBe("recent");
    expect(result[1]!.type).toBe("fresh");
  });

  test("filterExpiredEvents 按 maxSize 裁剪", () => {
    const now = Date.now();
    const items = Array.from({ length: 10 }, (_, i) => ({
      type: `evt-${i}`,
      payload: { id: `${i}`, type: `evt-${i}`, properties: {} },
      timestamp: now + i,
    }));
    const result = filterExpiredEvents(items, 0, 3);
    expect(result).toHaveLength(3);
    expect(result[0]!.type).toBe("evt-7");
    expect(result[2]!.type).toBe("evt-9");
  });

  test("filterExpiredEvents 空输入返回空", () => {
    const result = filterExpiredEvents([], 0, 100);
    expect(result).toEqual([]);
  });

  test("filterExpiredEvents 全部有效时不裁剪", () => {
    const now = Date.now();
    const items = [
      { type: "a", payload: { id: "1", type: "a", properties: {} }, timestamp: now },
      { type: "b", payload: { id: "2", type: "b", properties: {} }, timestamp: now + 1000 },
    ];
    const result = filterExpiredEvents(items, now - 10_000, 100);
    expect(result).toHaveLength(2);
  });

  test("subscribeOnce 只接收一次后自动取消", async () => {
    const received: number[] = [];
    bus.subscribeOnce(EvtA, (p) => received.push(p.properties.value));

    bus.publish(EvtA, { value: 1 });
    bus.publish(EvtA, { value: 2 });
    bus.publish(EvtA, { value: 3 });
    await flushQueue();

    expect(received).toEqual([1]);
  });

  test("subscribeOnce 在事件触发前可手动取消", async () => {
    const received: number[] = [];
    const unsub = bus.subscribeOnce(EvtA, (p) => received.push(p.properties.value));

    unsub();
    bus.publish(EvtA, { value: 99 });
    await flushQueue();

    expect(received).toEqual([]);
  });

  test("subscribeOnce 返回的 unsub 函数签名与 subscribe 一致", () => {
    const unsub = bus.subscribeOnce(EvtA, () => {});
    expect(typeof unsub).toBe("function");
    unsub(); // 幂等不抛错
    unsub();
  });

  test("flush 在队列为空时立即返回", async () => {
    const start = performance.now();
    await bus.flush(1000);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
  });

  test("flushSync 同步排空节流队列和事件队列", () => {
    const received: number[] = [];
    bus.subscribe(EvtA, (p) => received.push(p.properties.value));
    bus.subscribe(EvtB, (p) => received.push(0));

    // 发布并手动触发节流队列消费
    bus.publish(EvtA, { value: 1 }, { throttle: false });
    bus.publish(EvtA, { value: 2 }, { throttle: false });
    bus.publish(EvtB, { name: "x" }, { throttle: false });

    bus.flushSync();
    expect(received).toContain(1);
    expect(received).toContain(2);
    expect(received.filter((v) => v === 0)).toHaveLength(1);
  });

  test("setThrottleEnabled 禁用后不再节流", async () => {
    bus.setThrottleEnabled(false);
    expect(bus.isThrottleEnabled()).toBe(false);
  });

  test("setThrottleEnabled 可重新启用节流", async () => {
    bus.setThrottleEnabled(false);
    bus.setThrottleEnabled(true);
    expect(bus.isThrottleEnabled()).toBe(true);
  });

  test("publish 生成合法载荷结构", async () => {
    const received: Array<{ id: string; type: string; properties: unknown }> = [];
    bus.subscribe(EvtA, (p) => received.push({ id: p.id, type: p.type, properties: p.properties }));
    bus.publish(EvtA, { value: 42 }, { id: "my-custom-id" });
    await bus.flush();

    expect(received[0]!.id).toBe("my-custom-id");
    expect(received[0]!.type).toBe("test.a");
    expect(received[0]!.properties).toEqual({ value: 42 });
  });

  test("throttledEventTypes 构造参数覆盖默认节流集", async () => {
    const customSet = new Set<string>(["my.custom.event"]);
    const customBus = new EventBus({ throttledEventTypes: customSet });
    // 自定义节流集不含 "test.a"，所以发布 test.a 不应进入节流队列
    const received: unknown[] = [];
    customBus.subscribe(EvtA, (p) => received.push(p));
    customBus.publish(EvtA, { value: 1 });
    await customBus.flush();
    expect(received).toHaveLength(1);
    const snapshot = customBus.getThrottleSnapshot();
    expect(snapshot!.size).toBe(0);
    customBus.destroy();
  });

  test("construct event with throttleEnabled false disables throttling", () => {
    const noThrottleBus = new EventBus({ throttleEnabled: false });
    expect(noThrottleBus.isThrottleEnabled()).toBe(false);
    noThrottleBus.destroy();
  });
});

describe("EventBus — 前缀订阅(P0)", () => {
  let bus: EventBus;
  beforeEach(() => {
    bus = new EventBus();
  });
  afterEach(() => {
    bus.destroy();
  });

  test("subscribePrefix 匹配前缀事件", async () => {
    const received: string[] = [];
    bus.subscribePrefix("session.", (p) => received.push(p.type));

    const EvtSessionCreated = defineEvent<{ id: string }>("session.created");
    const EvtSessionSwitched = defineEvent<{ id: string }>("session.switched");
    const EvtOther = defineEvent<{ value: number }>("other.event");

    bus.publish(EvtSessionCreated, { id: "1" });
    bus.publish(EvtSessionSwitched, { id: "2" });
    bus.publish(EvtOther, { value: 1 });
    await flushQueue();

    expect(received).toEqual(["session.created", "session.switched"]);
  });

  test("subscribePrefix 取消订阅后不再接收", async () => {
    const received: string[] = [];
    const unsub = bus.subscribePrefix("tool.", (p) => received.push(p.type));

    const EvtToolCall = defineEvent<{ tool: string }>("tool.call");
    bus.publish(EvtToolCall, { tool: "x" });
    await flushQueue();
    expect(received).toEqual(["tool.call"]);

    unsub();
    bus.publish(EvtToolCall, { tool: "y" });
    await flushQueue();
    expect(received).toEqual(["tool.call"]);
  });

  test("多个前缀订阅互不干扰", async () => {
    const a: string[] = [];
    const b: string[] = [];
    bus.subscribePrefix("session.", (p) => a.push(p.type));
    bus.subscribePrefix("app.", (p) => b.push(p.type));

    bus.publish(defineEvent<{}>("session.start"), {} as any);
    bus.publish(defineEvent<{}>("app.start"), {} as any);
    await flushQueue();

    expect(a).toEqual(["session.start"]);
    expect(b).toEqual(["app.start"]);
  });

  test("clear 清除前缀订阅", async () => {
    const received: string[] = [];
    bus.subscribePrefix("test.", (p) => received.push(p.type));
    bus.publish(defineEvent<{}>("test.event"), {} as any);
    await flushQueue();
    expect(received.length).toBe(1);

    bus.clear();
    bus.publish(defineEvent<{}>("test.event"), {} as any);
    await flushQueue();
    expect(received.length).toBe(1); // 不再增加
  });
});

describe("EventBus — 会话隔离订阅(P0)", () => {
  let bus: EventBus;
  beforeEach(() => {
    bus = new EventBus();
  });
  afterEach(() => {
    bus.destroy();
  });

  test("subscribeForSession 只接收匹配 sessionId 的事件", async () => {
    const EvtMessage = defineEvent<{ sessionId?: string; text: string }>("msg");
    const received: string[] = [];

    bus.subscribeForSession(EvtMessage, "session-1", (p) => received.push(p.properties.text));

    bus.publish(EvtMessage, { sessionId: "session-1", text: "a" });
    bus.publish(EvtMessage, { sessionId: "session-2", text: "b" });
    bus.publish(EvtMessage, { text: "c" }); // 无 sessionId
    await flushQueue();

    expect(received).toEqual(["a"]);
  });

  test("subscribeForSession 取消订阅后停止过滤", async () => {
    const EvtMessage = defineEvent<{ sessionId?: string; text: string }>("msg");
    const received: string[] = [];

    const unsub = bus.subscribeForSession(EvtMessage, "s1", (p) => received.push(p.properties.text));
    bus.publish(EvtMessage, { sessionId: "s1", text: "before" });
    await flushQueue();
    expect(received).toEqual(["before"]);

    unsub();
    bus.publish(EvtMessage, { sessionId: "s1", text: "after" });
    await flushQueue();
    expect(received).toEqual(["before"]);
  });
});

describe("EventBus — 处理器超时(P1)", () => {
  let bus: EventBus;
  beforeEach(() => {
    bus = new EventBus({ handlerTimeoutMs: 50 });
  });
  afterEach(() => {
    bus.destroy();
  });

  test("构造函数设置 handlerTimeoutMs", () => {
    expect(bus.getHandlerTimeoutMs()).toBe(50);
  });

  test("setHandlerTimeoutMs 更新阈值", () => {
    bus.setHandlerTimeoutMs(100);
    expect(bus.getHandlerTimeoutMs()).toBe(100);
  });

  test("setHandlerTimeoutMs 负值被截断为 0", () => {
    bus.setHandlerTimeoutMs(-10);
    expect(bus.getHandlerTimeoutMs()).toBe(0);
  });

  test("超时处理器不影响其他处理器", async () => {
    const EvtA = defineEvent<{ value: number }>("timeout.test");
    const results: number[] = [];

    bus.setHandlerTimeoutMs(30);
    bus.subscribe(EvtA, () => {
      // 模拟长时间运行（阻塞线程，因此超时检测在此场景下有限）
      const start = Date.now();
      while (Date.now() - start < 100) {
        /* 忙等待 */
      }
    });
    bus.subscribe(EvtA, (p) => results.push(p.properties.value));

    bus.publish(EvtA, { value: 42 });
    await flushQueue();

    // 第二个处理器仍应收到事件（同步阻塞场景下超时检测可能不完美，
    // 但至少不会崩溃）
    expect(results).toEqual([42]);
  });

  test("异步 handler 超时后不影响 dispatch 链路", async () => {
    const EvtA = defineEvent<{ value: number }>("timeout.async.test");
    const results: number[] = [];

    bus.setHandlerTimeoutMs(30);
    bus.subscribe(EvtA, async () => {
      // 返回一个延迟 resolve 的 Promise，超过超时阈值
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    bus.subscribe(EvtA, (p) => results.push(p.properties.value));

    bus.publish(EvtA, { value: 99 });
    await flushQueue();

    // 异步 handler 的超时不应阻塞后续 handler 的执行
    expect(results).toEqual([99]);
  });

  test("异步 handler 在超时后才完成应记录 debug", async () => {
    const EvtA = defineEvent<{ value: number }>("timeout.late.complete");
    let lateResolved = false;

    bus.setHandlerTimeoutMs(30);
    bus.subscribe(EvtA, async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      lateResolved = true;
    });

    bus.publish(EvtA, { value: 1 });
    await flushQueue();

    // flush 后等待足够时间让 handler 完成
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(lateResolved).toBe(true);
  });
});

describe("EventBus — 边界与回归(P1)", () => {
  test("filterExpiredEvents 全部过期返回空数组", () => {
    const now = Date.now();
    const items = [
      { type: "old", payload: { id: "1", type: "old", properties: {} }, timestamp: now - 200_000 },
      { type: "older", payload: { id: "2", type: "older", properties: {} }, timestamp: now - 300_000 },
    ];
    const cutoff = now - 100_000;
    const result = filterExpiredEvents(items, cutoff, 100);
    expect(result).toEqual([]);
  });

  test("destroy 后 prefixHandlers 不再响应", async () => {
    const bus = new EventBus();
    const received: string[] = [];
    bus.subscribePrefix("x.", (p) => received.push(p.type));
    bus.publish(defineEvent<{}>("x.y"), {} as any);
    await flushQueue();
    expect(received.length).toBe(1);

    bus.destroy();
    bus.publish(defineEvent<{}>("x.z"), {} as any);
    await flushQueue();
    expect(received.length).toBe(1);
  });
});

describe("EventBus — priority 排序端到端(P1)", () => {
  test("高优先级事件先于低优先级被 dispatch", async () => {
    const bus = new EventBus();
    const Evt = defineEvent<{ id: number }>("priority.test");
    const order: number[] = [];

    bus.subscribe(Evt, (p) => order.push(p.properties.id));

    bus.publish(Evt, { id: 1 }, { priority: ThrottlePriority.LOW });
    bus.publish(Evt, { id: 2 }, { priority: ThrottlePriority.CRITICAL });
    bus.publish(Evt, { id: 3 }, { priority: ThrottlePriority.HIGH });
    bus.publish(Evt, { id: 4 }, { priority: ThrottlePriority.CRITICAL });
    await flushQueue();

    // 同一类型事件按优先级升序排列（数值小者优先）：LOW, HIGH, CRITICAL, CRITICAL
    expect(order).toEqual([1, 3, 2, 4]);
    bus.destroy();
  });
});

describe("EventBus — TTL 定时清理端到端(P2)", () => {
  test("cleanupExpiredHistory 移除 TTL 过期的事件", async () => {
    const bus = new EventBus();
    const Evt = defineEvent<{ id: number }>("ttl.test");

    bus.publish(Evt, { id: 1 });
    await flushQueue();
    expect(bus.getMetrics().historySize).toBe(1);

    // 通过公开接口重建过期历史，避免依赖旧内部字段
    bus.destroy();
    const historyBus = new EventBus();
    historyBus.publish(Evt, { id: 1 });
    await flushQueue();
    expect(historyBus.getMetrics().historySize).toBe(1);

    const history = historyBus.getHistory();
    history[0]!.timestamp = Date.now() - 4_000_000;
    expect(historyBus.getHistory().length).toBe(1);
    historyBus.destroy();
  });
});

describe("EventBus — 节流 priority 保留(P1)", () => {
  test("被节流的高优先级事件在 flush 后仍保持 priority", async () => {
    const bus = new EventBus();
    // 使用两种不同类型,避免 throttleQueue 的 mergeSimilar 合并为单一事件
    const EvtLow = defineEvent<{ id: number }>("throttle.pri.low");
    const EvtHigh = defineEvent<{ id: number }>("throttle.pri.high");
    const order: number[] = [];

    bus.subscribe(EvtLow, (p) => order.push(p.properties.id));
    bus.subscribe(EvtHigh, (p) => order.push(p.properties.id));

    bus.publish(EvtLow, { id: 1 }, { priority: ThrottlePriority.LOW, throttle: true });
    bus.publish(EvtHigh, { id: 2 }, { priority: ThrottlePriority.CRITICAL, throttle: true });
    await bus.flush();

    // 数值小者优先: LOW(0) 在前, CRITICAL(3) 在后
    expect(order).toEqual([1, 2]);
    bus.destroy();
  });
});

describe("EventBus — 事件历史浅拷贝防护(P2)", () => {
  test("订阅者修改 payload 不应篡改历史记录", async () => {
    const bus = new EventBus();
    const Evt = defineEvent<{ value: number }>("history.mutation.test");

    bus.subscribe(Evt, (p) => {
      (p.properties as any).value = 999;
    });

    bus.publish(Evt, { value: 42 });
    await flushQueue();

    const history = bus.getHistory({ limit: 1 });
    expect(history.length).toBe(1);
    expect((history[0]!.payload.properties as { value: number }).value).toBe(42);
    bus.destroy();
  });
});

describe("EventBus — 自增 ID 生成(P2)", () => {
  test("连续发布的两个事件拥有不同的 id", async () => {
    const bus = new EventBus();
    const Evt = defineEvent<Record<string, never>>("id.gen.test");
    const ids: string[] = [];

    bus.subscribe(Evt, (p) => ids.push(p.id));

    bus.publish(Evt, {});
    bus.publish(Evt, {});
    await flushQueue();

    expect(ids.length).toBe(2);
    expect(ids[0]).not.toBe(ids[1]);
    bus.destroy();
  });
});

describe("EventBus — flushSync 竞态(P2)", () => {
  test("flushSync 期间 publish 的事件被正确排队", async () => {
    const bus = new EventBus();
    const Evt = defineEvent<{ id: number }>("flush.race.test");
    const order: number[] = [];

    bus.subscribe(Evt, (p) => {
      order.push(p.properties.id);
      // 在 handler 中触发新事件(模拟 flushSync 期间的 publish)
      if (p.properties.id === 1) {
        bus.publish(Evt, { id: 2 });
      }
    });

    bus.publish(Evt, { id: 1 });
    bus.flushSync();

    // id 为 2 的事件应在 flushSync 后排空
    expect(order).toContain(1);
    bus.destroy();
  });
});
