/**
 * 摘要生成器 — 生成对话历史的结构化摘要
 *
 * 职责:
 *   - 将长对话历史序列化为可读文本
 *   - 调用 LLM 生成结构化摘要
 *   - 提供规则后备摘要(LLM 不可用时)
 *
 * 模块功能:
 *   - serializeMessages(): 将消息数组序列化为可读文本
 *   - generateSummary(): 调用 LLM 生成结构化摘要
 *   - generateFallbackSummary(): 基于规则生成简化摘要
 *
 * 使用场景:
 *   - 对话上下文压缩时生成摘要
 *   - LLM 服务不可用时的后备方案
 *
 * 边界:
 * 1. 纯摘要生成，不管理消息状态
 * 2. 大型工具输出会被截断到指定长度
 *
 * 流程:
 * 1. 暂无(这是摘要生成模块，无特定执行流程)
 */
import type { ModelMessage } from "ai";
import type { AppConfigSchema } from "@/schema/config";
import { SUMMARY_GENERATION_TIMEOUT_MS, SUMMARY_MAX_TOKENS } from "@/config";
import { createLogger } from "@/core/logging/logger";
import { sanitizeAndTruncate, truncateString } from "@/core/utilities/sanitize";
import { estimateTokens } from "@/session/token/tokenCounterRef";
import type { CompactionConfig } from "@/compress/conversation";

const log = createLogger("compaction:summary");

const truncateStr = truncateString;

/**
 * 将消息数组序列化为可读文本，用于生成摘要的输入。
 * 大型工具输出会被截断到 config.toolOutputTruncateLength。
 *
 * 注: compress/overflow/prompt.ts 中有功能类似的 `serializeMessagesForCompression`，
 * 差异在于: 本函数保留 tool-result（截断后），适用于结构化摘要生成；
 * `serializeMessagesForCompression` 跳过 tool-result，适用于 Token 效率优先的 AI 压缩。
 * 两者因场景不同有意保持独立。
 */
export function serializeMessages(messages: ModelMessage[], truncateLength: number): string {
  const lines: string[] = [];

  for (const msg of messages) {
    const role = msg.role.toUpperCase();
    const { content } = msg;

    if (typeof content === "string") {
      lines.push(`[${role}]: ${content}`);
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (part == null) {
          continue;
        }
        if (typeof part === "string") {
          lines.push(`[${role}]: ${part}`);
        } else if ("type" in part) {
          if (part.type === "text" && "text" in part) {
            lines.push(`[${role}]: ${part.text}`);
          } else if (part.type === "tool-call") {
            const toolName = "toolName" in part ? part.toolName : "unknown";
            const args = "input" in part ? JSON.stringify(part.input) : "{}";
            lines.push(`[${role}/TOOL-CALL ${toolName}]: ${truncateStr(args, truncateLength)}`);
          } else if (part.type === "tool-result") {
            const toolName = "toolName" in part ? part.toolName : "unknown";
            const output = "output" in part ? part.output : "";
            const outputStr = typeof output === "string" ? output : JSON.stringify(output);
            lines.push(`[${role}/TOOL-RESULT ${toolName}]: ${sanitizeAndTruncate(outputStr, truncateLength)}`);
          }
        }
      }
    }
    lines.push(""); // 空行分隔
  }

  return lines.join("\n");
}

/** 结构化摘要的系统提示词 */
const SUMMARY_SYSTEM_PROMPT = `你是一个对话摘要生成器。你的任务是将一段对话历史压缩为结构化摘要。

请按以下格式输出摘要(使用中文):

## 用户主要需求
[简要描述用户的核心需求和目标]

## 关键技术决策
[列出对话中做出的关键技术决策和选择]

## 重要文件和代码
[列出涉及的文件路径、关键代码片段、函数名等]

## 工具使用记录
[简要记录使用了哪些工具，以及关键结果]

## 已解决的问题
[列出已经解决的问题及其解决方案]

## 未解决的问题
[列出尚未解决或需要继续跟进的问题]

## 当前状态
[描述对话当前进展到哪一步，下一步应该做什么]

要求:
- 保留所有重要的上下文信息，不要遗漏关键技术细节
- 工具结果只需保留关键信息，省略冗余输出
- 确保摘要足够完整，使 LLM 能够无缝继续对话
- 摘要长度控制在 1000-3000字`;

/**
 * 调用 LLM 生成结构化摘要。
 *
 * @returns 摘要文本，如果 LLM 调用失败则返回基于规则的后备摘要
 */
export async function generateSummary(
  config: AppConfigSchema,
  messages: ModelMessage[],
  compactionConfig: CompactionConfig,
): Promise<string> {
  const { completeLlm } = await import("@api");
  const serialized = serializeMessages(messages, compactionConfig.toolOutputTruncateLength);
  const userPrompt = `请将以下对话历史压缩为结构化摘要:\n\n${serialized}`;

  try {
    log.info(`开始生成上下文摘要`, {
      eventType: "compaction.summary.start",
      payload: {
        estimatedInputTokens: estimateTokens(serialized),
        inputChars: serialized.length,
        messageCount: messages.length,
      },
    });

    const { text: summary } = await completeLlm(config, [{ content: userPrompt, role: "user" }], {
      maxTokens: SUMMARY_MAX_TOKENS,
      system: SUMMARY_SYSTEM_PROMPT,
      temperature: 0.3,
      timeout: SUMMARY_GENERATION_TIMEOUT_MS,
    });

    log.info(`摘要生成完成`, {
      eventType: "compaction.summary.done",
      payload: {
        estimatedSummaryTokens: estimateTokens(summary),
        summaryLength: summary.length,
      },
      success: true,
    });

    return summary;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.warn(`LLM 摘要生成失败，使用规则后备摘要: ${errMsg}`, {
      eventType: "compaction.summary.fallback",
      payload: { error: errMsg },
    });

    return generateFallbackSummary(messages, compactionConfig.toolOutputTruncateLength);
  }
}

/**
 * 规则后备摘要:当 LLM 不可用时，基于规则生成简化摘要。
 * 提取每条消息的核心内容，保留关键信息。
 */
function generateFallbackSummary(messages: ModelMessage[], truncateLength: number): string {
  const lines: string[] = ["[自动压缩摘要]\n"];

  let userCount = 0;
  let assistantCount = 0;
  let toolCallCount = 0;
  const keyPoints: string[] = [];

  for (const msg of messages) {
    const { content } = msg;
    if (msg.role === "user") {
      userCount++;
      const text = typeof content === "string" ? content : serializeParts(content, truncateLength);
      if (text) {
        keyPoints.push(`用户: ${truncateStr(text, 80)}`);
      }
    } else if (msg.role === "assistant") {
      assistantCount++;
      if (typeof content === "string" && content) {
        keyPoints.push(`助手: ${truncateStr(content, 80)}`);
      } else if (Array.isArray(content)) {
        for (const part of content) {
          if (part && typeof part === "object" && "type" in part) {
            if (part.type === "tool-call") {
              toolCallCount++;
            }
          }
        }
      }
    }
  }

  lines.push(`统计: ${userCount} 条用户消息, ${assistantCount} 条助手回复, ${toolCallCount} 次工具调用`);

  // 只保留最近 10 条要点，避免膨胀
  const recentPoints = keyPoints.slice(-10);
  if (recentPoints.length > 0) {
    lines.push(`最近对话要点:\n${recentPoints.join("\n")}`);
  }

  return lines.join("\n");
}

function serializeParts(content: unknown[] | unknown, truncateLength: number): string {
  if (!Array.isArray(content)) {
    return String(content ?? "");
  }
  const parts: string[] = [];
  for (const part of content) {
    if (part == null) {
      continue;
    }
    if (typeof part === "string") {
      parts.push(part);
    } else if (typeof part === "object" && "type" in part) {
      if (part.type === "text" && "text" in part) {
        parts.push(String(part.text));
      } else if (part.type === "tool-call") {
        const name = "toolName" in part ? part.toolName : "unknown";
        parts.push(`[调用工具: ${name}]`);
      } else if (part.type === "tool-result") {
        const name = "toolName" in part ? part.toolName : "unknown";
        const output = "output" in part ? part.output : "";
        const str = typeof output === "string" ? output : JSON.stringify(output);
        parts.push(`[工具结果 ${name}]: ${truncateStr(str, truncateLength)}`);
      }
    }
  }
  return parts.join("\n");
}
