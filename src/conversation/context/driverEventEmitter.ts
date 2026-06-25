/**
 * Driver 事件发射器 — ConversationDriver 事件订阅管理。
 *
 * 从 ConversationHandler 提取的独立职责:
 *   - 管理 ConversationDriverEvent → listener 映射
 *   - 提供事件订阅/取消订阅
 *   - 提供事件发射
 *
 * 边界:
 *   1. 不涉及事件内容的具体结构(统一 unknown)
 *   2. 不与 EventBus 全局事件交互
 */
export type { ConversationDriverEvent, ConversationDriverListener } from "../types/driver";

interface ListenerEntry {
  listener: (payload: unknown) => void;
}

/**
 * 通用类型安全的事件发射器，用于 ConversationDriver 接口实现。
 */
export class DriverEventEmitter<TEvent extends string = string> {
  private listeners = new Map<TEvent, Set<ListenerEntry>>();

  /** 订阅事件，返回取消订阅函数 */
  on(event: TEvent, listener: (payload: unknown) => void): () => void {
    const entry: ListenerEntry = { listener };
    const set = this.listeners.get(event) ?? new Set<ListenerEntry>();
    set.add(entry);
    this.listeners.set(event, set);
    return () => {
      set.delete(entry);
      if (set.size === 0) {
        this.listeners.delete(event);
      }
    };
  }

  /** 发射事件到所有订阅者 */
  emit(event: TEvent, payload: unknown): void {
    const set = this.listeners.get(event);
    if (!set) {
      return;
    }
    for (const entry of set) {
      entry.listener(payload);
    }
  }

  /** 销毁所有监听器 */
  destroy(): void {
    this.listeners.clear();
  }
}
