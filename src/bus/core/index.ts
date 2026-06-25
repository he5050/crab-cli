/**
 * Bus Core — 事件总线核心实现统一导出。
 *
 * 本文件为 bus 模块内部子模块出入口，不直接对外暴露。
 * 外部消费者应通过 `@bus` 统一入口引用。
 */

// ─── 类型 ───────────────────────────────────────────────────
export type { EventDefinition, EventPayload, EventHandler, EventQueueItem, EventHistoryItem } from "./types";

// ─── EventBus 主类 + 全局单例 ──────────────────────────────
export { EventBus, globalBus } from "./eventBus";

// ─── 工具函数 ──────────────────────────────────────────────
export { defineEvent, filterExpiredEvents } from "./utils";

// ─── 进程生命周期 ──────────────────────────────────────────
export { installGlobalProcessHandlers, uninstallGlobalProcessHandlers, __resetGlobalBusForTest } from "./lifecycle";

// ─── 内部管理器（供高级场景直接使用） ──────────────────────
export { EventBusHistoryManager } from "./history";
export { EventBusQueueRuntime } from "./queueRuntime";
export { EventBusSubscriptionsManager } from "./subscriptions";
export { EventBusThrottleManager } from "./throttle";
export { drainDispatchItems, dispatchEventThroughHandlers } from "./dispatch";

// ─── Durable Event Store ───────────────────────────────────
export {
  persistEvent,
  replayEvents,
  getGlobalEventStream,
  getLatestVersion,
  deleteEventsByAggregate,
} from "./durableStore";
export type { DurableEventRecord } from "./durableStore";
