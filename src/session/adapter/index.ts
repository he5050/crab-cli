/**
 * 消息格式适配器 — ChatMessage ↔ MessageRecord 互转。
 *
 * 职责:
 *   - 桥接 UI 层 ChatMessage 和数据层 MessageRecord 的格式差异
 *   - 提供消息格式双向转换
 *   - 处理瞬态字段过滤
 *
 * 模块功能:
 *   - chatMessageToParts:将 ChatMessage 转换为 MessagePart[]
 *   - messagePartsToChatParts:将 MessagePart[] 转换为 ChatMessagePart[]
 *   - chatRoleToMessageRole:角色类型转换
 *   - messageRoleToChatRole:角色类型反向转换
 *   - extractPlainText:从消息中提取纯文本
 *
 * 使用场景:
 *   - UI 层与数据层消息格式转换
 *   - 消息持久化前格式处理
 *   - 消息展示前格式处理
 *
 * 边界:
 *   1. 仅做格式转换，不含业务逻辑
 *   2. UI 的 TextPart/ThinkingPart 用 text 字段；数据层用 content 字段
 *   3. UI 的 ToolPart 合并了调用+结果；数据层拆为 ToolUsePart + ToolResultPart
 *   4. UI 瞬态字段(streaming/isError/toolInfo)不持久化
 *
 * 流程:
 *   1. 接收 UI 层或数据层消息
 *   2. 根据方向选择转换函数
 *   3. 处理字段映射和类型转换
 *   4. 过滤瞬态字段
 *   5. 返回转换后的消息
 */
/**
 * 消息格式适配器 — ChatMessage ↔ MessageRecord 互转。
 *
 * 职责:
 *   - 桥接 UI 层 ChatMessage 和数据层 MessageRecord 的格式差异
 *   - 提供消息格式双向转换
 *   - 处理瞬态字段过滤
 *
 * 边界:
 *   1. 仅做格式转换，不含业务逻辑
 *   2. UI 的 TextPart/ThinkingPart 用 text 字段；数据层用 content 字段
 *   3. UI 的 ToolPart 合并了调用+结果；数据层拆为 ToolUsePart + ToolResultPart
 *   4. UI 瞬态字段(streaming/isError/interrupted)不持久化
 */
import type {
  ChatMessage,
  ChatMessagePart,
  ThinkingPart as ChatThinkingPart,
  TextPart as ChatTextPart,
  ToolPart as ChatToolPart,
} from "@/schema/chat";
import type { MessagePart, TextPart, ToolUsePart, ToolResultPart, ThinkingPart, MessageRole } from "../core/message";
import type {
  AssistantModelMessage,
  ModelMessage,
  ToolCallPart,
  ToolModelMessage,
  ToolResultPart as AiToolResultPart,
} from "ai";
import type { MessageRecord } from "../core/message";
import { createId } from "@/core/identity";
import { createLogger } from "@/core/logging/logger";
import { createPartsAssistantMessage, createMultiToolResultMessage } from "@/conversation/message/messageFactories";

const log = createLogger("session:message-adapter");

function hasKeys(value: object): boolean {
  return Object.keys(value).length > 0;
}

function mergeMetadata(
  base?: Record<string, unknown>,
  override?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const merged = { ...base, ...override };
  return hasKeys(merged) ? merged : undefined;
}

function mergeTime(
  base?: ChatThinkingPart["time"] | ChatToolPart["time"],
  override?: ChatThinkingPart["time"] | ChatToolPart["time"],
): ChatToolPart["time"] | undefined {
  const merged = { ...base };
  if (override?.startedAt !== undefined) merged.startedAt = override.startedAt;
  if (override?.endedAt !== undefined) merged.endedAt = override.endedAt;
  if (override?.durationMs !== undefined) merged.durationMs = override.durationMs;
  if (merged.durationMs === undefined && merged.startedAt !== undefined && merged.endedAt !== undefined) {
    merged.durationMs = Math.max(0, merged.endedAt - merged.startedAt);
  }
  return hasKeys(merged) ? merged : undefined;
}

function parseToolInput(content: string, input?: unknown): unknown {
  if (input !== undefined) return input;
  if (!content) return undefined;
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}

function stringifyResult(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return fallback;
  try {
    return JSON.stringify(value);
  } catch (err) {
    log.debug(`工具结果序列化失败: ${err instanceof Error ? err.message : String(err)}`);
    return String(value);
  }
}

type AiToolResultOutput = AiToolResultPart["output"];

function toAiToolResultOutput(output: unknown, isError: boolean): AiToolResultOutput {
  if (isError) {
    const msg = typeof output === "string" ? output : (JSON.stringify(output) ?? String(output));
    return { type: "error-text", value: msg };
  }
  if (typeof output === "string") {
    return { type: "text", value: output };
  }
  return { type: "text", value: JSON.stringify(output) ?? String(output) };
}

function extractModelText(parts: MessagePart[]): string {
  return parts
    .filter((part): part is TextPart => part.type === "text")
    .map((part) => part.content)
    .join("\n");
}

function stringifyModelValue(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return fallback;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function modelOutputToTextAndResult(output: unknown): { content: string; result: unknown; success: boolean } {
  if (
    output &&
    typeof output === "object" &&
    "type" in output &&
    typeof (output as { type?: unknown }).type === "string"
  ) {
    const typed = output as { type: string; value?: unknown };
    const success = !typed.type.startsWith("error");
    if ((typed.type === "text" || typed.type === "error-text") && typeof typed.value === "string") {
      return { content: typed.value, result: typed.value, success };
    }
    return { content: stringifyModelValue(typed.value ?? output), result: typed.value ?? output, success };
  }

  return { content: stringifyModelValue(output), result: output, success: true };
}

/**
 * 将 AI SDK ModelMessage 转换为可持久化的 MessagePart[]。
 *
 * 用于压缩后把内存中的模型上下文同步回会话消息表，保证恢复会话时读取到的是
 * 压缩后的摘要上下文，而不是压缩前的旧消息。
 */
export function modelMessageToParts(message: ModelMessage): MessagePart[] {
  const content = message.content;

  if (typeof content === "string") {
    return [{ type: "text", content }];
  }

  if (!Array.isArray(content)) {
    return [{ type: "text", content: stringifyModelValue(content) }];
  }

  const parts: MessagePart[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object" || !("type" in part)) {
      parts.push({ type: "text", content: stringifyModelValue(part) });
      continue;
    }

    if (part.type === "text") {
      const text =
        typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : stringifyModelValue(part);
      parts.push({ type: "text", content: text });
      continue;
    }

    if (part.type === "tool-call") {
      const toolCall = part as ToolCallPart;
      parts.push({
        type: "tool_use",
        content: stringifyModelValue(toolCall.input, "{}"),
        tool_use_id: toolCall.toolCallId,
        tool_name: toolCall.toolName,
        callId: toolCall.toolCallId,
        input: toolCall.input,
      });
      continue;
    }

    if (part.type === "tool-result") {
      const toolResult = part as AiToolResultPart;
      const output = modelOutputToTextAndResult(toolResult.output);
      parts.push({
        type: "tool_result",
        content: output.content,
        tool_use_id: toolResult.toolCallId,
        callId: toolResult.toolCallId,
        result: output.result,
        success: output.success,
      });
      continue;
    }

    parts.push({ type: "text", content: stringifyModelValue(part) });
  }

  return parts.length > 0 ? parts : [{ type: "text", content: "" }];
}

/**
 * 将持久化 MessageRecord 转换为 AI SDK ModelMessage。
 *
 * 这是恢复会话上下文的共享入口，供 UI/headless/SSE/ACP 复用。
 * UI 展示层使用 messagePartsToChatParts；模型上下文必须使用本函数保留 tool-call/tool-result 结构。
 */
export function messageRecordsToModelMessages(records: MessageRecord[]): ModelMessage[] {
  const toolNamesById = new Map<string, string>();
  const modelMessages: ModelMessage[] = [];

  for (const record of records) {
    if (record.role === "user" || record.role === "system") {
      modelMessages.push({ role: record.role, content: extractModelText(record.parts) });
      continue;
    }

    if (record.role === "assistant") {
      const parts: ({ type: "text"; text: string } | ToolCallPart)[] = [];
      const text = extractModelText(record.parts);
      const toolUses = record.parts.filter((part): part is ToolUsePart => part.type === "tool_use");

      if (toolUses.length === 0) {
        modelMessages.push({ role: "assistant", content: text });
        continue;
      }

      if (text) parts.push({ type: "text", text });

      for (const toolUse of toolUses) {
        toolNamesById.set(toolUse.tool_use_id, toolUse.tool_name);
        parts.push({
          type: "tool-call",
          toolCallId: toolUse.tool_use_id,
          toolName: toolUse.tool_name,
          input: toolUse.input ?? toolUse.content,
        });
      }

      modelMessages.push(parts.length > 0 ? createPartsAssistantMessage(parts) : createPartsAssistantMessage(""));
      continue;
    }

    const toolParts: AiToolResultPart[] = record.parts
      .filter((part): part is ToolResultPart => part.type === "tool_result")
      .map((part) => ({
        type: "tool-result" as const,
        toolCallId: part.tool_use_id,
        toolName: toolNamesById.get(part.tool_use_id) ?? "unknown",
        output: toAiToolResultOutput(part.result ?? part.content, part.success === false),
      }));

    if (toolParts.length > 0) {
      modelMessages.push(createMultiToolResultMessage(toolParts));
    }
  }

  return modelMessages;
}

/**
 * 将 ChatMessage 转换为可存储的 MessagePart[]。
 *
 * 转换规则:
 *   - 有 parts 时按 parts 转换(忽略 content，因为 parts 是结构化的)
 *   - 无 parts 时将 content 包装为 TextPart
 *   - ToolPart → ToolUsePart + ToolResultPart(配对输出)
 *   - 瞬态字段(streaming/isError/toolInfo)不持久化
 */
export function chatMessageToParts(msg: ChatMessage): MessagePart[] {
  const parts: MessagePart[] = [];

  if (msg.parts && msg.parts.length > 0) {
    for (const part of msg.parts) {
      switch (part.type) {
        case "thinking":
          parts.push({
            type: "thinking",
            content: (part as ChatThinkingPart).text,
            metadata: (part as ChatThinkingPart).metadata,
            time: mergeTime((part as ChatThinkingPart).time, {
              startedAt: (part as ChatThinkingPart).startedAt,
              endedAt: (part as ChatThinkingPart).endedAt,
              durationMs: (part as ChatThinkingPart).durationMs,
            }),
          });
          break;

        case "text":
          parts.push({
            type: "text",
            content: (part as ChatTextPart).text,
            metadata: (part as ChatTextPart).metadata,
            time: (part as ChatTextPart).time,
          });
          break;

        case "tool": {
          const tp = part as ChatToolPart;
          const callId = tp.callId ?? createId("call");
          const toolTime = mergeTime(tp.time, {
            startedAt: tp.startedAt,
            endedAt: tp.endedAt,
            durationMs: tp.durationMs,
          });
          // 工具调用部分
          parts.push({
            type: "tool_use",
            content: tp.args ?? (tp.input === undefined ? "{}" : stringifyResult(tp.input, "{}")),
            tool_use_id: callId,
            tool_name: tp.tool,
            callId,
            input: tp.input ?? parseToolInput(tp.args ?? "{}"),
            metadata: tp.metadata,
            files: tp.files,
            diagnostics: tp.diagnostics,
            subSessionId: tp.subSessionId,
            time: toolTime,
          });
          // 工具结果部分(如果已完成)
          if (tp.status === "done" || tp.status === "error") {
            parts.push({
              type: "tool_result",
              content: tp.output ?? "",
              tool_use_id: callId,
              result: tp.output ?? "",
              callId,
              metadata: tp.metadata,
              files: tp.files,
              diagnostics: tp.diagnostics,
              subSessionId: tp.subSessionId,
              time: toolTime,
              success: tp.success,
              truncated: tp.truncated,
              outputPath: tp.outputPath,
            });
          }
          break;
        }
      }
    }
  } else if (msg.content) {
    parts.push({ type: "text", content: msg.content });
  }

  return parts;
}

/**
 * 将 ChatMessage 的 role 映射到 MessageRecord 的 role。
 *
 * ChatMessage 只有 user/assistant/system，
 * MessageRecord 额外支持 tool(但 ChatMessage 的 system 角色消息中
 * 如果包含 ToolPart，保存时应该用 tool role)。
 */
export function chatRoleToMessageRole(msg: ChatMessage): MessageRole {
  // 包含工具调用 parts 的 system 消息映射为 tool 角色
  if (msg.role === "system" && msg.parts?.some((p) => p.type === "tool")) {
    return "tool";
  }
  return msg.role as MessageRole;
}

/**
 * 将 MessagePart[] 转换回 ChatMessage 的 parts。
 *
 * 转换规则:
 *   - TextPart: content → text
 *   - ThinkingPart: content → text
 *   - ToolUsePart + ToolResultPart: 合并为 ToolPart
 *   - 独立的 ToolUsePart(无配对结果): 生成 calling 状态的 ToolPart
 *   - 独立的 ToolResultPart: 生成带输出的 ToolPart
 */
export function messagePartsToChatParts(msgParts: MessagePart[]): ChatMessagePart[] {
  const result: ChatMessagePart[] = [];
  const consumed = new Set<number>();

  for (let i = 0; i < msgParts.length; i++) {
    if (consumed.has(i)) continue;
    const part = msgParts[i]!;

    switch (part.type) {
      case "text":
        result.push({
          type: "text",
          text: (part as TextPart).content,
          metadata: (part as TextPart).metadata,
          time: (part as TextPart).time,
        });
        break;

      case "thinking":
        result.push({
          type: "thinking",
          text: (part as ThinkingPart).content,
          metadata: (part as ThinkingPart).metadata,
          time: (part as ThinkingPart).time,
          startedAt: (part as ThinkingPart).time?.startedAt,
          endedAt: (part as ThinkingPart).time?.endedAt,
          durationMs: (part as ThinkingPart).time?.durationMs,
        });
        break;

      case "tool_use": {
        const toolUse = part as ToolUsePart;
        // 向后查找配对的 tool_result
        const resultIdx = msgParts.findIndex(
          (p, j) =>
            j > i &&
            !consumed.has(j) &&
            p.type === "tool_result" &&
            (p as ToolResultPart).tool_use_id === toolUse.tool_use_id,
        );

        if (resultIdx !== -1) {
          const toolResult = msgParts[resultIdx] as ToolResultPart;
          const time = mergeTime(toolUse.time, toolResult.time);
          result.push({
            type: "tool",
            tool: toolUse.tool_name,
            callId: toolUse.callId ?? toolResult.callId ?? toolUse.tool_use_id,
            success: toolResult.success ?? true,
            args: toolUse.content,
            input: parseToolInput(toolUse.content, toolUse.input),
            output: toolResult.content || stringifyResult(toolResult.result),
            metadata: mergeMetadata(toolUse.metadata, toolResult.metadata),
            files: toolResult.files ?? toolUse.files,
            diagnostics: toolResult.diagnostics ?? toolUse.diagnostics,
            subSessionId: toolResult.subSessionId ?? toolUse.subSessionId,
            startedAt: time?.startedAt,
            endedAt: time?.endedAt,
            time,
            durationMs: time?.durationMs,
            truncated: toolResult.truncated,
            outputPath: toolResult.outputPath,
            status: (toolResult.success ?? true) ? "done" : "error",
          });
          consumed.add(resultIdx);
        } else {
          result.push({
            type: "tool",
            tool: toolUse.tool_name,
            callId: toolUse.callId ?? toolUse.tool_use_id,
            success: true,
            args: toolUse.content,
            input: parseToolInput(toolUse.content, toolUse.input),
            metadata: toolUse.metadata,
            files: toolUse.files,
            diagnostics: toolUse.diagnostics,
            subSessionId: toolUse.subSessionId,
            startedAt: toolUse.time?.startedAt,
            endedAt: toolUse.time?.endedAt,
            time: toolUse.time,
            durationMs: toolUse.time?.durationMs,
            status: "calling",
          });
        }
        break;
      }

      case "tool_result": {
        // 独立的 tool_result(无配对 tool_use，前面未被消费)
        const tr = part as ToolResultPart;
        result.push({
          type: "tool",
          tool: "unknown",
          callId: tr.callId ?? tr.tool_use_id,
          success: tr.success ?? true,
          output: tr.content || stringifyResult(tr.result),
          metadata: tr.metadata,
          files: tr.files,
          diagnostics: tr.diagnostics,
          subSessionId: tr.subSessionId,
          startedAt: tr.time?.startedAt,
          endedAt: tr.time?.endedAt,
          time: tr.time,
          durationMs: tr.time?.durationMs,
          truncated: tr.truncated,
          outputPath: tr.outputPath,
          status: (tr.success ?? true) ? "done" : "error",
        });
        break;
      }
    }
  }

  return result;
}

/**
 * 从 MessagePart[] 提取纯文本内容(用于 ChatMessage.content 回填)。
 */
export function extractPlainText(parts: MessagePart[]): string {
  const texts: string[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      texts.push((part as TextPart).content);
    } else if (part.type === "thinking") {
      // Thinking 不纳入 content
    } else if (part.type === "tool_use") {
      texts.push(`⟳ ${(part as ToolUsePart).tool_name}`);
    } else if (part.type === "tool_result") {
      const tr = part as ToolResultPart;
      const output = typeof tr.result === "string" ? tr.result : JSON.stringify(tr.result);
      if (output) texts.push(output.slice(0, 200));
    }
  }
  return texts.join("\n");
}

/**
 * 将 MessageRecord 的 role 映射回 ChatMessage 的 role。
 */
export function messageRoleToChatRole(role: MessageRole): "user" | "assistant" | "system" {
  // Tool 角色在 UI 层映射为 system(工具消息在 UI 中以 system 消息展示)
  if (role === "tool") return "system";
  return role as "user" | "assistant" | "system";
}
