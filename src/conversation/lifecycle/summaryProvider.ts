/**
 * Summary 生成器接口
 *
 * 实现者订阅 AppEvent.SummaryRequested 来生成会话摘要。
 *
 * 模块功能:
 *   - SummaryGenerator: 摘要生成接口
 *   - generateSummary: 生成会话摘要
 */
import type { SummarizeResult } from "@/session/type";

/**
 * Summary generator interface
 * Implementers subscribe to AppEvent.SummaryRequested
 */
export interface SummaryGenerator {
  /**
   * Generate session summary
   * @param sessionId - Session ID
   * @param messages - Message list
   * @returns Summary result
   */
  generateSummary(sessionId: string, messages: unknown[]): Promise<SummarizeResult>;
}
