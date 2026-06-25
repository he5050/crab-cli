import type { EventHandler, EventPayload, EventQueueItem } from "./types";

interface DispatchOptions {
  type: string;
  payload: EventPayload<unknown>;
  handlers: Map<string, Set<EventHandler<any>>>;
  prefixHandlers: Map<string, Set<EventHandler<any>>>;
  wildcardHandlers: Set<EventHandler<any>>;
  handlerTimeoutMs: number;
  log: {
    debug: (message: string) => void;
    error: (message: string) => void;
    warn: (message: string) => void;
  };
}

export function drainDispatchItems(
  items: EventQueueItem[],
  dispatch: (type: string, payload: EventPayload<unknown>) => void,
): void {
  items.sort((a, b) => a.priority - b.priority);
  for (const item of items) {
    dispatch(item.type, item.payload);
  }
}

export function dispatchEventThroughHandlers(options: DispatchOptions): void {
  const { handlers, payload, prefixHandlers, type, wildcardHandlers } = options;

  const typeHandlers = handlers.get(type);
  if (typeHandlers) {
    for (const handler of typeHandlers) {
      executeEventHandler(handler, payload, type, options);
    }
  }

  if (prefixHandlers.size > 0) {
    for (const [prefix, handlersForPrefix] of prefixHandlers) {
      if (!type.startsWith(prefix)) {
        continue;
      }
      for (const handler of handlersForPrefix) {
        executeEventHandler(handler, payload, `${prefix}*`, options);
      }
    }
  }

  for (const handler of wildcardHandlers) {
    executeEventHandler(handler, payload, "*", options);
  }
}

function executeEventHandler(
  handler: EventHandler<any>,
  payload: EventPayload<unknown>,
  type: string,
  options: Pick<DispatchOptions, "handlerTimeoutMs" | "log">,
): void {
  const handleError = (error: unknown): void => {
    options.log.error(
      `事件处理器错误 (${type}): ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
  };

  const invoke = (): unknown => {
    try {
      return handler(payload);
    } catch (error) {
      handleError(error);
      return undefined;
    }
  };

  if (options.handlerTimeoutMs <= 0) {
    invoke();
    return;
  }

  const result = invoke();
  if (!(result instanceof Promise)) {
    return;
  }

  let completed = false;

  const timer = setTimeout(() => {
    if (!completed) {
      options.log.warn(`事件处理器超时 (${type}): 超过 ${options.handlerTimeoutMs}ms`);
    }
  }, options.handlerTimeoutMs);

  result
    .then(() => {
      completed = true;
      clearTimeout(timer);
    })
    .catch((error: unknown) => {
      completed = true;
      clearTimeout(timer);
      handleError(error);
    });
}
