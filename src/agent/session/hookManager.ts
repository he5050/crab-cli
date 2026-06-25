/**
 * Agent 生命周期钩子 — 允许在 Agent 执行的关键节点注入自定义逻辑。
 */
import { createLogger } from "@/core/logging/logger";

const log = createLogger("agent:hooks");

export type LifecycleEvent =
  | "beforeStart"
  | "afterStart"
  | "beforeStep"
  | "afterStep"
  | "onToolCall"
  | "onToolResult"
  | "onError"
  | "onComplete"
  | "onCancelled";

export type LifecycleHook = (context: HookContext) => void | Promise<void>;

export interface HookContext {
  sessionId?: string;
  agentName?: string;
  event: LifecycleEvent;
  timestamp: number;
  data?: Record<string, unknown>;
  error?: Error;
  stepIndex?: number;
  toolName?: string;
  async?: boolean;
}

export interface HookOptions {
  once?: boolean;
  priority?: number;
}

export class LifecycleHookManager {
  private hooks = new Map<LifecycleEvent, { hook: LifecycleHook; options: HookOptions }[]>();
  private executingEvents = new Set<LifecycleEvent>();

  on(event: LifecycleEvent, hook: LifecycleHook, options: HookOptions = {}): () => void {
    if (!this.hooks.has(event)) {
      this.hooks.set(event, []);
    }

    const hooks = this.hooks.get(event)!;
    const entry = { hook, options: { priority: 0, ...options } };

    const insertIndex = hooks.findIndex((h) => (h.options.priority ?? 0) < (entry.options.priority ?? 0));
    if (insertIndex === -1) {
      hooks.push(entry);
    } else {
      hooks.splice(insertIndex, 0, entry);
    }

    log.debug(`钩子已注册: ${event}, priority=${entry.options.priority}, once=${entry.options.once}`);

    return () => this.off(event, hook);
  }

  once(event: LifecycleEvent, hook: LifecycleHook, options: Omit<HookOptions, "once"> = {}): () => void {
    return this.on(event, hook, { ...options, once: true });
  }

  off(event: LifecycleEvent, hook: LifecycleHook): void {
    const hooks = this.hooks.get(event);
    if (!hooks) {
      return;
    }

    const index = hooks.findIndex((h) => h.hook === hook);
    if (index !== -1) {
      hooks.splice(index, 1);
      log.debug(`钩子已注销: ${event}`);
    }
  }

  async emit(event: LifecycleEvent, context: Omit<HookContext, "event" | "timestamp"> = {}): Promise<void> {
    const hooks = this.hooks.get(event);
    if (!hooks || hooks.length === 0) {
      return;
    }

    if (this.executingEvents.has(event)) {
      log.warn(`钩子事件 ${event} 正在执行中，跳过递归调用`);
      return;
    }

    this.executingEvents.add(event);
    const timestamp = Date.now();
    const fullContext: HookContext = { ...context, event, timestamp };

    try {
      const toRemove: number[] = [];
      // 收集所有 async hook 的 Promise，统一在尾部处理失败
      // 避免 fire-and-forget 导致错误静默丢失
      const asyncPromises: Promise<unknown>[] = [];

      for (let i = 0; i < hooks.length; i++) {
        const entry = hooks[i]!;
        const { hook, options } = entry;
        try {
          const result = hook(fullContext);

          if (result instanceof Promise) {
            asyncPromises.push(result);
            fullContext.async = true;
          }
        } catch (error) {
          log.error(`钩子执行错误 [${event}]: ${error instanceof Error ? error.message : String(error)}`);
        }

        if (options.once) {
          toRemove.push(i);
        }
      }

      // 异步钩子统一用 allSettled 收敛:
      // - 不会因单个 reject 丢失其他 hook 的失败信息
      // - 不会因某个 promise 拒绝而中断其他并发执行
      if (asyncPromises.length > 0) {
        const settled = await Promise.allSettled(asyncPromises);
        for (const [idx, s] of settled.entries()) {
          if (s.status === "rejected") {
            log.error(
              `异步钩子执行错误 [${event}] (index=${idx}): ${s.reason instanceof Error ? s.reason.message : String(s.reason)}`,
            );
          }
        }
      }

      for (let i = toRemove.length - 1; i >= 0; i--) {
        hooks.splice(toRemove[i]!, 1);
      }
    } finally {
      this.executingEvents.delete(event);
    }
  }

  getHookCount(event?: LifecycleEvent): number {
    if (event) {
      return this.hooks.get(event)?.length ?? 0;
    }
    let total = 0;
    for (const hooks of this.hooks.values()) {
      total += hooks.length;
    }
    return total;
  }

  clear(): void {
    this.hooks.clear();
    log.debug("所有钩子已清除");
  }

  debug(): Record<string, number> {
    const info: Record<string, number> = {};
    for (const [event, hooks] of this.hooks) {
      info[event] = hooks.length;
    }
    return info;
  }
}

export const lifecycleHooks = new LifecycleHookManager();

export function createLifecycleHooks(): LifecycleHookManager {
  return new LifecycleHookManager();
}

export const onBeforeStart = (hook: LifecycleHook, options?: HookOptions) =>
  lifecycleHooks.on("beforeStart", hook, options);
export const onAfterStart = (hook: LifecycleHook, options?: HookOptions) =>
  lifecycleHooks.on("afterStart", hook, options);
export const onBeforeStep = (hook: LifecycleHook, options?: HookOptions) =>
  lifecycleHooks.on("beforeStep", hook, options);
export const onAfterStep = (hook: LifecycleHook, options?: HookOptions) =>
  lifecycleHooks.on("afterStep", hook, options);
export const onToolCall = (hook: LifecycleHook, options?: HookOptions) =>
  lifecycleHooks.on("onToolCall", hook, options);
export const onToolResult = (hook: LifecycleHook, options?: HookOptions) =>
  lifecycleHooks.on("onToolResult", hook, options);
export const onError = (hook: LifecycleHook, options?: HookOptions) => lifecycleHooks.on("onError", hook, options);
export const onComplete = (hook: LifecycleHook, options?: HookOptions) =>
  lifecycleHooks.on("onComplete", hook, options);
export const onCancelled = (hook: LifecycleHook, options?: HookOptions) =>
  lifecycleHooks.on("onCancelled", hook, options);
