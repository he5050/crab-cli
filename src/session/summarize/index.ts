/**
 * 会话摘要命令入口 — 将当前对话生成 AI 摘要。
 *
 * 职责:
 *   - 接收当前会话消息
 *   - 调用 summary-generator 生成摘要
 *   - 返回格式化摘要文本
 *
 * 模块功能:
 *   - summarizeSession:为会话消息生成 AI 摘要
 *
 * 使用场景:
 *   - 生成会话摘要
 *   - 长对话压缩
 *   - 会话内容总结
 *
 * 边界:
 *   1. 依赖 summary-generator 生成摘要
 *   2. 支持 structured 和 bullet 两种格式
 *   3. 可配置最大长度
 *   4. 返回摘要文本和统计信息
 *
 * 流程:
 *   1. 接收会话消息和配置
 *   2. 调用 generateSummary 生成摘要
 *   3. 返回格式化摘要结果
 */
import type { ModelMessage } from "ai";
import type { AppConfigSchema } from "@/schema/config";
import { generateSummary } from "@/conversation/lifecycle/summaryGenerator";
import { createLogger } from "@/core/logging/logger";
import type { CompactionConfig } from "@/conversation";

const log = createLogger("session:summarize");

export interface SummarizeOptions {
  format?: "structured" | "bullet";
  maxLength?: number;
}

export interface SummarizeResult {
  summary: string;
  messageCount: number;
  charCount: number;
}

/**
 * 为会话消息生成 AI 摘要。
 */
export async function summarizeSession(
  config: AppConfigSchema,
  messages: ModelMessage[],
  compactionConfig: CompactionConfig,
  _options?: SummarizeOptions,
): Promise<SummarizeResult> {
  log.info(`生成会话摘要: ${messages.length} 条消息`);

  const summary = await generateSummary(config, messages, compactionConfig);

  return {
    charCount: summary.length,
    messageCount: messages.length,
    summary,
  };
}
