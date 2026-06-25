/**
 * EventBus Context — 为 UI 层提供依赖注入能力。
 *
 * 职责:
 *   - 通过 Solid Context 向下传递 EventBus 实例
 *   - 默认回退到全局 globalBus，保持向后兼容
 *   - 测试时可替换为 mock EventBus
 *
 * 使用:
 *   const eventBus = useEventBus();
 *   eventBus.publish(AppEvent.Toast, { message: "hello" });
 */
import { createContext, useContext } from "solid-js";
import { globalBus, type EventBus } from "@bus";

const EventBusContext = createContext<EventBus>(globalBus);

export function EventBusProvider(props: { eventBus?: EventBus; children: any }) {
  return <EventBusContext.Provider value={props.eventBus ?? globalBus}>{props.children}</EventBusContext.Provider>;
}

export function useEventBus(): EventBus {
  return useContext(EventBusContext);
}
