/**
 * 事件总线 spy 工具 — 测试期间订阅 AppEvent 并收集载荷。
 *
 * 用法:
 *   const spy = createEventBusSpy();
 *   spy.subscribe([AppEvent.ChatChunk, AppEvent.Log]);
 *   // ... 触发被测代码
 *   expect(spy.collected(AppEvent.ChatChunk)).toEqual([{ chunk: "hi" }]);
 *   spy.unsubscribeAll();
 *
 * 支持隔离的 EventBus 实例:
 *   const bus = new EventBus();
 *   const spy = createEventBusSpy(bus);
 */
import type { EventBus } from "@/bus";
import { globalBus } from "@/bus";
import type { AppEvent } from "@/bus";
import type { EventPayloadMap } from "@/bus";

type AnyEvent = (typeof AppEvent)[keyof typeof AppEvent];

export function createEventBusSpy(bus: EventBus = globalBus) {
  const collected = new Map<string, unknown[]>();
  // 独立 unsub Map,避免用 `${key}__unsub` 这种脆弱字符串后缀
  const unsubs = new Map<string, () => void>();

  function subscribeAll(events: AnyEvent[]) {
    for (const evt of events) {
      const key = evt.type;
      if (!collected.has(key)) {
        collected.set(key, []);
      }
      // 已存在则跳过(避免重复订阅造成重复收集)
      if (unsubs.has(key)) {
        continue;
      }
      const handler = (payload: unknown) => {
        collected.get(key)!.push(payload);
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const unsub = bus.subscribe(evt as any, handler as any);
      unsubs.set(key, unsub);
    }
  }

  function unsubscribeAll() {
    for (const [key, unsub] of unsubs) {
      unsub();
      unsubs.delete(key);
    }
  }

  function clear() {
    collected.clear();
  }

  function collectedOf<K extends keyof typeof AppEvent>(event: (typeof AppEvent)[K]): EventPayloadMap[K][] {
    return (collected.get(event.type) ?? []) as EventPayloadMap[K][];
  }

  return {
    clear,
    collected: collectedOf,
    subscribe: subscribeAll,
    unsubscribeAll,
  };
}
