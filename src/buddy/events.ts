/**
 * Buddy 事件系统
 *
 * 独立 EventEmitter，不污染核心 EventBus(AppEvent)。
 */

import { EventEmitter } from "node:events";

export interface CompanionEventPayload {
  reaction?: string;
  petAt?: number;
  refresh?: boolean;
}

class CompanionEvents extends EventEmitter {
  emitChange(payload: CompanionEventPayload): void {
    this.emit("change", payload);
  }

  onChange(listener: (payload: CompanionEventPayload) => void): () => void {
    this.on("change", listener);
    return () => {
      this.off("change", listener);
    };
  }
}

export const companionEvents = new CompanionEvents();

/** 发射对话气泡反应 */
export function companionReaction(text: string): void {
  companionEvents.emitChange({ reaction: text });
}

/** 发射抚摸事件 */
export function companionPetAt(time = Date.now()): void {
  companionEvents.emitChange({ petAt: time });
}

/** 发射刷新事件（companion 属性变更后） */
export function companionRefresh(): void {
  companionEvents.emitChange({ refresh: true });
}

/** 订阅 companion 事件 */
export type CompanionEventHandler = (payload: CompanionEventPayload) => void;

/** 便捷订阅函数 */
export function onCompanionReaction(handler: CompanionEventHandler): () => void {
  return companionEvents.onChange(handler);
}
