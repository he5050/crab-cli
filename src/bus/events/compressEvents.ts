/**
 * 压缩事件 — 上下文压缩全生命周期(started/progress/completed/failed/retrying)。
 *
 * 职责:定义压缩协调器对外的事件契约。
 */
import { defineEvent } from "../core";

export const CompressEvents = {
  /** 压缩开始 */
  CompressStarted: defineEvent<{
    sessionId?: string;
    tokenCount: number;
    percentage: number;
  }>("compress.started"),

  /** 压缩进度 */
  CompressProgress: defineEvent<{
    sessionId?: string;
    step: "preparing" | "compressing" | "summarizing" | "replacing";
    progress?: number;
  }>("compress.progress"),

  /** 压缩完成 */
  CompressCompleted: defineEvent<{
    sessionId?: string;
    tokensBefore: number;
    tokensAfter: number;
    compressionRatio: string;
    method: "ai-summary" | "truncate" | "hybrid";
  }>("compress.completed"),

  /** 压缩失败 */
  CompressFailed: defineEvent<{
    sessionId?: string;
    error: string;
    method: string;
  }>("compress.failed"),

  /** 压缩重试 */
  CompressRetrying: defineEvent<{
    sessionId?: string;
    attempt: number;
    maxRetries: number;
    error: string;
  }>("compress.retrying"),
} as const;
