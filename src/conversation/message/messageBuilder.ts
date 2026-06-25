/**
 * 消息构建器 — 内部消息格式与 AI SDK ModelMessage 的转换。
 *
 * 职责:
 *   - ConversationMessage[] → ModelMessage[] 转换
 *   - tool_calls 与 tool 结果配对
 *   - 清理孤立 tool_calls
 *   - 截断超大工具输出
 *
 * 模块功能:
 *   - toModelMessages(): 转换消息格式
 *   - buildParts(): 构建 Parts 结构
 *   - cleanOrphanedToolCallsFromModel(): 清理孤立 tool_calls
 *
 * 使用场景:
 *   - ConversationHandler 内部消息处理
 *   - 对话历史的格式转换
 *
 * 边界:
 * 1. 无状态工具类，所有方法都是纯函数
 * 2. 使用 ModelMessage[](AI SDK 格式)作为内部格式
 * 3. tool 输出截断到 DEFAULT_TOOL_OUTPUT_MAX_CHARS
 *
 * 流程:
 * 1. 收集所有 tool 结果的 callId
 * 2. 按 role 分类转换消息
 * 3. assistant 消息:过滤孤立 tool_calls
 * 4. tool 消息:截断超大输出
 */

import type { AssistantContent, ModelMessage } from "ai";
import type { ConversationMessage } from "@/conversation/types";
import { createLogger } from "@/core/logging/logger";
import { isToolCallPart, isToolResultPart } from "./messagePartGuards";
import {
  buildAssistantParts,
  createPartsAssistantMessage,
  createTextAssistantMessage,
  createToolResultMessage,
} from "./messageFactories";

const log = createLogger("conversation:message-builder");

/** 工具输出最大字符数(防止超大输出塞爆上下文) */
const DEFAULT_TOOL_OUTPUT_MAX_CHARS = 8000;

/** 消息构建选项 */
export interface MessageBuilderOptions {
  /** 是否剥离媒体内容(图片/文件) */
  stripMedia?: boolean;
  /** 工具输出最大字符数 */
  toolOutputMaxChars?: number;
}

/**
 * 将 ConversationMessage[] 转换为 AI SDK ModelMessage[]。
 *
 * 处理逻辑:
 *   1. 按 role 分类转换
 *   2. assistant 消息:提取 text + tool_calls
 *   3. tool 消息:匹配 toolCallId
 *   4. 清理孤立 tool_calls(无对应 tool 结果的调用)
 *   5. 截断超大工具输出
 *
 */
export function toModelMessages(messages: ConversationMessage[], options?: MessageBuilderOptions): ModelMessage[] {
  const maxChars = options?.toolOutputMaxChars ?? DEFAULT_TOOL_OUTPUT_MAX_CHARS;
  const result: ModelMessage[] = [];

  // 收集所有 tool 结果的 callId
  const toolResultIds = new Set<string>();
  for (const msg of messages) {
    if (msg.role === "tool" && msg.toolCallId) {
      toolResultIds.add(msg.toolCallId);
    }
  }

  for (const msg of messages) {
    switch (msg.role) {
      case "user": {
        // 如果 stripMedia=true，过滤掉 image/file parts
        if (options?.stripMedia && msg.parts) {
          const filteredParts = msg.parts.filter((p) => p.type !== "image" && p.type !== "file");
          const textContent = filteredParts
            .filter((p) => p.type === "text")
            .map((p) => (p as { type: "text"; text: string }).text)
            .join("\n");
          result.push({
            content: textContent || msg.content,
            role: "user",
          });
        } else {
          result.push({
            content: msg.content,
            role: "user",
          });
        }
        break;
      }

      case "system": {
        result.push({
          content: msg.content,
          role: "system",
        });
        break;
      }

      case "assistant": {
        // 过滤掉无对应 tool 结果的孤立 tool_calls
        const validToolCalls = (msg.toolCalls ?? []).filter((tc) => toolResultIds.has(tc.id));

        // 如果有 tool_calls，需要以 assistant 消息携带 tool-invocation 格式
        if (validToolCalls.length > 0) {
          const content: AssistantContent = buildAssistantParts(
            msg.content || undefined,
            validToolCalls.map((tc) => ({
              args: tc.arguments,
              toolCallId: tc.id,
              toolName: tc.name,
            })),
          );
          result.push(createPartsAssistantMessage(content));
        } else {
          // 纯文本 assistant 消息
          result.push(createTextAssistantMessage(msg.content));
        }
        break;
      }

      case "tool": {
        // 查找工具输出内容
        let output = msg.content;

        // 从 parts 中提取工具输出
        if (msg.parts) {
          const toolPart = msg.parts.find((p) => p.type === "tool");
          if (toolPart && toolPart.type === "tool") {
            output = typeof toolPart.output === "string" ? toolPart.output : JSON.stringify(toolPart.output);
          }
        }

        // 截断超大输出
        if (output.length > maxChars) {
          const headLen = Math.floor(maxChars * 0.6);
          const tailLen = Math.floor(maxChars * 0.3);
          output = `${output.slice(0, headLen)}\n...[截断，原始长度 ${output.length} 字符]...\n${output.slice(-tailLen)}`;
        }

        // Tool 消息:使用 AI SDK ToolModelMessage 格式
        // Content 必须是 ToolResultPart[] 数组，toolCallId 在 part 内部
        if (!msg.toolCallId) {
          log.warn("tool 消息缺少 toolCallId，跳过");
          break;
        }

        const toolName = msg.parts?.find((part) => part.type === "tool")?.tool ?? "unknown";
        result.push(createToolResultMessage(msg.toolCallId, toolName, { type: "text", value: output }));
        break;
      }
    }
  }

  return result;
}

/**
 * 构建 Parts 结构。
 *
 * 将 ConversationMessage 的内容分解为 MessagePart[] 数组。
 */
export function buildParts(message: ConversationMessage): ConversationMessage["parts"] {
  const parts: ConversationMessage["parts"] = [];

  // Thinking
  if (message.thinking) {
    parts.push({ text: message.thinking, type: "thinking" });
  }

  // Reasoning
  if (message.reasoning) {
    parts.push({ text: message.reasoning, type: "thinking" });
  }

  // Text
  if (message.content) {
    parts.push({ text: message.content, type: "text" });
  }

  // Tool calls
  if (message.toolCalls) {
    for (const tc of message.toolCalls) {
      parts.push({
        input: tc.arguments,
        output: undefined,
        state: { output: "", status: "pending", time: {} },
        tool: tc.name,
        toolCallId: tc.id,
        type: "tool",
      });
    }
  }

  return parts.length > 0 ? parts : undefined;
}

/**
 * 从 AI SDK ModelMessage[] 中清理孤立 tool_calls。
 *
 * 孤立定义:assistant 消息包含 tool-call，但后续没有对应的 tool-result 消息。
 * 这可能发生在压缩截断消息时。
 */
export function cleanOrphanedToolCallsFromModel(messages: ModelMessage[]): void {
  const toolResultIds = new Set<string>();

  // 收集所有 tool-result 的 callId
  for (const msg of messages) {
    const { content } = msg;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const part of content) {
      if (isToolResultPart(part)) {
        toolResultIds.add(part.toolCallId);
      }
    }
  }

  // 清理 assistant 消息中无对应 tool-result 的 tool-call
  // 使用索引赋值重建消息对象，避免 (msg as any).content 赋值
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg) {
      continue;
    }
    if (msg.role !== "assistant") {
      continue;
    }
    const { content } = msg;
    if (!Array.isArray(content)) {
      continue;
    }

    const filtered = content.filter((part) => {
      if (isToolCallPart(part)) {
        const hasResult = toolResultIds.has(part.toolCallId);
        if (!hasResult) {
          log.debug(`清理孤立 tool-call: ${part.toolName}`);
        }
        return hasResult;
      }
      return true;
    });

    // 如果有变化，用新对象替换(不可变方式)
    if (filtered.length !== content.length) {
      const nextMessage =
        filtered.length > 0
          ? createPartsAssistantMessage(filtered as AssistantContent)
          : createTextAssistantMessage("");
      messages[i] = { ...msg, ...nextMessage };
    }
  }
}
