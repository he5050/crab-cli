/**
 * 研究与流式旁路事件 — 深度研究进度 + BTW 流式 + TODO 同步。
 *
 * 职责:研究类功能(深度研究、BTW)的事件契约。
 */
import { defineEvent } from "../core";

export const ResearchEvents = {
  /** Btw 流式文本片段 */
  BtwStreamChunk: defineEvent<{
    chunk: string;
    done: boolean;
    fullText?: string;
    error?: string;
  }>("btw.stream.chunk"),

  /** TODO 状态同步 */
  TodoSync: defineEvent<{
    items: unknown[];
  }>("todo.sync"),

  /** 深度研究进度 */
  DeepResearchProgress: defineEvent<{
    topic: string;
    round: number;
    totalRounds: number;
    action: "planning" | "searching" | "fetching" | "analyzing" | "writing" | "done" | "error";
    message: string;
    budget?: { searchesUsed: number; searchesBudget: number; fetchesUsed: number; fetchesBudget: number };
  }>("deep-research.progress"),
} as const;
