/**
 * 清理协调事件 — 应用启动/退出时的资源清理协调。
 *
 * 职责:Dependency Inversion 模式下的清理契约。
 */
import { defineEvent } from "../core";

export const CleanupEvents = {
  /** 清理请求 */
  CleanupRequested: defineEvent<{
    phase: "startup" | "exit";
    timestamp: number;
  }>("cleanup.requested"),

  /** 清理完成 */
  CleanupCompleted: defineEvent<{
    provider: string;
    filesRemoved: number;
    phase: "startup" | "exit";
  }>("cleanup.completed"),
} as const;
