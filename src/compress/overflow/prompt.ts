/**
 * Prompt
 *
 * 职责:
 *   - 提供压缩提示词模板
 *   - 序列化消息数组用于压缩输入
 *
 * 模块功能:
 *   - COMPRESSION_PROMPT: 主压缩提示词(结构化交接文档)
 *   - SUB_AGENT_COMPRESSION_PROMPT: 子代理压缩提示词(精简版)
 *   - serializeMessagesForCompression: 将消息数组序列化为可读文本
 *
 * 使用场景:
 *   - AI 摘要压缩时提供系统提示词
 *   - 主会话上下文压缩
 *   - 子代理/队友上下文压缩
 *   - 消息序列化用于 LLM 输入
 *
 * 边界:
 *   1. 主提示词要求生成完整的技术交接文档
 *   2. 子代理提示词更短、更聚焦于任务状态
 *   3. 序列化时跳过 tool-result 以节省 token
 *
 * 流程:
 *   1. 选择适当的提示词模板
 *   2. 序列化消息数组
 *   3. 构建 LLM 请求
 *   4. 获取摘要结果
 */
import type { ModelMessage } from "ai";
import { truncateString } from "@/core/utilities/sanitize";

// ─── 主压缩提示词 ────────────────────────────────────────────

/**
 * 结构化交接文档提示词 — 用于主会话的上下文压缩。
 *
 * 要求 LLM 生成一份完整的技术交接文档，保留所有关键信息。
 */
export const COMPRESSION_PROMPT = `**TASK: Create a comprehensive handover document from the conversation history above.**

You are creating a technical handover document. Extract and preserve all critical information with rigorous detail and accuracy. This is NOT a task continuation prompt - this is archival documentation.

**OUTPUT FORMAT - Structured Handover Document:**

## Project/Task Overview
- Project or task being worked on
- Objectives and expected outcomes
- Current completion status

## Technical Environment
- Technologies, frameworks, libraries, and tools in use
- **EXACT** file paths (full paths, not relative)
- **EXACT** function names, class names, variable names
- Architecture patterns and design decisions
- Configuration details and environment specifics

## Implementation Details
- Technical decisions made and rationale
- Chosen approaches and implementation methods
- Solutions applied to specific problems
- Code patterns and best practices used
- **EXACT** code snippets where relevant (preserve syntax)

## Work Completed
- Features implemented (with file references)
- Bugs fixed (with root cause analysis)
- Code modifications made (with before/after context)
- Test results and validation outcomes

## Work In Progress
- Incomplete tasks (with specific blocking reasons)
- Known issues and their diagnostic details
- Planned next steps (concrete, actionable)
- Open questions requiring decisions

## Critical Reference Data
- Important IDs, keys, values (sanitize credentials)
- Error messages and stack traces (exact wording)
- User requirements and constraints (explicit details)
- Edge cases and special handling requirements

**QUALITY REQUIREMENTS:**
1. Preserve EXACT technical terms - never paraphrase code/file names
2. Include FULL context - paths, versions, configurations
3. Maintain PRECISION - specific line numbers, exact error messages
4. NO assumptions - only document what was explicitly discussed
5. NO vague summaries - provide actionable, specific details
6. Use markdown code blocks for code snippets with language tags
7. Structure information hierarchically for easy scanning

**EXECUTE NOW - Output the handover document immediately.**`;

// ─── 子代理压缩提示词 ────────────────────────────────────────

/**
 * 精简版压缩提示词 — 用于子代理/队友的上下文压缩。
 * 更短、更聚焦于任务状态。
 */
export const SUB_AGENT_COMPRESSION_PROMPT = `Summarize the conversation above into a concise handover document. Include:

1. **Task**: What was the agent asked to do
2. **Done**: What was completed (with file paths and key changes)
3. **Blocked**: What's still pending and why
4. **Key Data**: Important values, error messages, or decisions

Keep it under 800 tokens. Preserve exact file paths and technical terms.`;

// ─── 消息序列化 ──────────────────────────────────────────────

/**
 * 将消息数组序列化为可读文本(用于压缩输入)。
 *
 * 优化:跳过工具结果(浪费 token)，只保留工具调用事件记录。
 */
export function serializeMessagesForCompression(messages: ModelMessage[], truncateLength: number): string {
  const parts: string[] = [];

  for (const msg of messages) {
    const { content } = msg;

    if (typeof content === "string") {
      const roleLabel = msg.role === "user" ? "[User]" : msg.role === "assistant" ? "[Assistant]" : `[${msg.role}]`;
      parts.push(`${roleLabel}\n${content}`);
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (part == null || typeof part !== "object" || !("type" in part)) {
          continue;
        }

        if (part.type === "text" && "text" in part) {
          const roleLabel = msg.role === "user" ? "[User]" : "[Assistant]";
          parts.push(`${roleLabel}\n${String(part.text)}`);
        } else if (part.type === "tool-call") {
          const toolName = "toolName" in part ? String(part.toolName) : "unknown";
          const args = "input" in part ? JSON.stringify(part.input) : "{}";
          parts.push(`[Tool Call: ${toolName}]\n${truncateString(args, truncateLength)}`);
        }
        // 跳过 tool-result(浪费 token，只保留调用记录)
      }
    }
    parts.push(""); // 分隔
  }

  return parts.join("\n");
}
