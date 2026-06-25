import type { EventDefinition, EventHandler, EventPayload } from "./types";

interface EventBusSubscriptionsManagerOptions {
  handlers: Map<string, Set<EventHandler<any>>>;
  prefixHandlers: Map<string, Set<EventHandler<any>>>;
  wildcardHandlers: Set<EventHandler<any>>;
  validatePayloadInDev: () => boolean;
  maxSubscribersPerType: () => number;
  log: { warn: (message: string) => void };
}

export class EventBusSubscriptionsManager {
  constructor(private readonly options: EventBusSubscriptionsManagerOptions) {}

  subscribe<T>(def: EventDefinition<T>, handler: EventHandler<T>): () => void {
    if (!this.options.handlers.has(def.type)) {
      this.options.handlers.set(def.type, new Set());
    }
    const set = this.options.handlers.get(def.type)!;
    if (set.size >= this.options.maxSubscribersPerType()) {
      this.options.log.warn(
        `订阅者数量已达上限 (${this.options.maxSubscribersPerType()}) for ${def.type};建议检查内存泄漏`,
      );
    }
    set.add(handler);

    return () => {
      this.options.handlers.get(def.type)?.delete(handler);
    };
  }

  subscribeOnce<T>(def: EventDefinition<T>, handler: EventHandler<T>): () => void {
    const unsub = this.subscribe(def, (payload) => {
      unsub();
      handler(payload);
    });
    return unsub;
  }

  subscribeForSession<T extends { sessionId?: string }>(
    def: EventDefinition<T>,
    sessionId: string,
    handler: EventHandler<T>,
  ): () => void {
    return this.subscribe(def, (payload) => {
      const props = payload.properties as { sessionId?: string };
      if (this.options.validatePayloadInDev() && !("sessionId" in (payload.properties as object))) {
        this.options.log.warn(`subscribeForSession: 事件 ${def.type} 的载荷缺少 sessionId 字段`);
      }
      if (props.sessionId === sessionId) {
        handler(payload as EventPayload<T>);
      }
    });
  }

  subscribeAll(handler: EventHandler<unknown>): () => void {
    this.options.wildcardHandlers.add(handler);
    return () => {
      this.options.wildcardHandlers.delete(handler);
    };
  }

  subscribePrefix(prefix: string, handler: EventHandler<unknown>): () => void {
    if (!this.options.prefixHandlers.has(prefix)) {
      this.options.prefixHandlers.set(prefix, new Set());
    }
    this.options.prefixHandlers.get(prefix)!.add(handler);

    return () => {
      this.options.prefixHandlers.get(prefix)?.delete(handler);
    };
  }
}
