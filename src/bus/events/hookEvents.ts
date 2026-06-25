/**
 * Hook 执行事件 — 外部 hook 执行的完成回调。
 *
 * 职责:Hook 框架执行结果对外暴露。
 */
import { defineEvent } from "../core";

export const HookEvents = {
  /** Hook 执行完成 */
  HookExecuted: defineEvent<{
    hookId: string;
    hookName: string;
    event: string;
    success: boolean;
    decision: string;
    duration: number;
    error?: string;
  }>("hook.executed"),
} as const;
