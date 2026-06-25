/**
 * EventBus 核心测试。
 *
 * 测试用例:
 *   - 订阅与发布
 *   - 取消订阅
 *   - 多事件监听
 *   - 异步事件处理
 */
import { describe, expect, test } from "bun:test";
import { EventBus, defineEvent } from "@/bus";

const TestEvent = defineEvent<{ value: number }>("test.event");
const OtherEvent = defineEvent<{ name: string }>("other.event");

describe("EventBus — 事件总线", () => {
  test("subscribe + publish 单事件正常接收", async () => {
    const bus = new EventBus();
    const received: number[] = [];
    bus.subscribe(TestEvent, (payload) => {
      received.push(payload.properties.value);
    });
    bus.publish(TestEvent, { value: 42 });

    // 等待异步处理
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(received).toEqual([42]);
  });

  test("unsubscribe 后不再接收事件", async () => {
    const bus = new EventBus();
    const received: number[] = [];
    const unsub = bus.subscribe(TestEvent, (payload) => {
      received.push(payload.properties.value);
    });
    bus.publish(TestEvent, { value: 1 });

    // 等待第一个事件处理完成
    await new Promise((resolve) => setTimeout(resolve, 10));

    unsub();
    bus.publish(TestEvent, { value: 2 });

    // 等待第二个事件(应该不会被处理)
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(received).toEqual([1]);
  });

  test("多订阅者全部收到事件", async () => {
    const bus = new EventBus();
    const a: number[] = [];
    const b: number[] = [];
    bus.subscribe(TestEvent, (payload) => a.push(payload.properties.value));
    bus.subscribe(TestEvent, (payload) => b.push(payload.properties.value));
    bus.publish(TestEvent, { value: 99 });

    // 等待异步处理
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(a).toEqual([99]);
    expect(b).toEqual([99]);
  });

  test("通配符订阅者收到所有事件", async () => {
    const bus = new EventBus();
    const types: string[] = [];
    bus.subscribeAll((payload) => types.push(payload.type));
    bus.publish(TestEvent, { value: 1 });
    bus.publish(OtherEvent, { name: "hello" });

    // 等待异步处理
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(types).toEqual(["test.event", "other.event"]);
  });

  test("发布未订阅事件不报错", () => {
    const bus = new EventBus();
    expect(() => bus.publish(TestEvent, { value: 1 })).not.toThrow();
  });

  test("事件载荷包含 id 和 type", async () => {
    const bus = new EventBus();
    let payload: any;
    bus.subscribe(TestEvent, (p) => {
      payload = p;
    });
    bus.publish(TestEvent, { value: 1 });

    // 等待异步处理
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(payload.id).toBeDefined();
    expect(payload.type).toBe("test.event");
    expect(payload.properties).toEqual({ value: 1 });
  });

  test("事件计数器递增", () => {
    const bus = new EventBus();
    expect(bus.totalEvents).toBe(0);
    bus.publish(TestEvent, { value: 1 });
    bus.publish(TestEvent, { value: 2 });
    expect(bus.totalEvents).toBe(2);
  });

  test("clear 清除所有订阅者和计数", () => {
    const bus = new EventBus();
    bus.subscribe(TestEvent, () => {});
    bus.subscribeAll(() => {});
    bus.publish(TestEvent, { value: 1 });
    bus.clear();
    expect(bus.totalEvents).toBe(0);
  });

  test("处理器抛错不影响其他处理器", async () => {
    const bus = new EventBus();
    const received: number[] = [];
    bus.subscribe(TestEvent, () => {
      throw new Error("boom");
    });
    bus.subscribe(TestEvent, (payload) => received.push(payload.properties.value));
    bus.publish(TestEvent, { value: 1 });

    // 等待异步处理
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(received).toEqual([1]);
  });
});
