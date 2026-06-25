/**
 * 循环与剪贴板事件 — Loop 执行 + 复制操作。
 *
 * 职责:Loop 管理器与剪贴板交互事件契约。
 */
import { defineEvent } from "../core";

export const LoopEvents = {
  /** Loop 执行完成 */
  LoopExecuted: defineEvent<{
    loopId: string;
    taskId?: string;
    status: "success" | "skipped" | "error";
    error?: string;
    runCount: number;
  }>("loop.executed"),

  /** 复制上一条 AI 回复 */
  CopyLastMessage: defineEvent<Record<string, never>>("clipboard.copy.last"),
} as const;
