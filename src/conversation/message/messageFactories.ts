/**
 * 类型安全的消息构建工厂 — 替代散落各处的 `as ModelMessage` 断言。
 *
 * 职责:
 *   - 提供 ModelMessage 各子类型的类型安全构造函数
 *   - 封装 AI SDK 的消息格式细节(特别是 ToolModelMessage 的 ToolResultPart 结构)
 *   - 为 cleanOrphanedToolCallsFromModel 提供不可变的消息重建
 *
 * 边界:
 *   1. 纯函数工具类，无状态
 *   2. 所有函数都返回类型精确的子类型(UserModelMessage / AssistantModelMessage 等)
 *   3. 不处理业务逻辑(如截断、权限检查)，仅做类型安全的对象构造
 *
 * 设计依据(AI SDK v6 类型定义):
 *   - SystemModelMessage: { role: 'system', content: string }
 *   - UserModelMessage:    { role: 'user',   content: string | UserContent }
 *   - AssistantModelMessage: { role: 'assistant', content: string | AssistantContent }
 *   - ToolModelMessage:   { role: 'tool',   content: ToolContent }
 *     其中 ToolContent = Array<ToolResultPart | ToolApprovalResponse>
 *     ToolResultPart = { type: 'tool-result', toolCallId, toolName, output: ToolResultOutput }
 *     ToolResultOutput = { type: 'text', value: string } | { type: 'json', value: JSONValue } | ...
 */

import type {
  AssistantContent,
  AssistantModelMessage,
  ModelMessage,
  SystemModelMessage,
  TextPart,
  ToolCallPart,
  ToolModelMessage,
  ToolResultPart,
  UserContent,
  UserModelMessage,
} from "ai";

// ─── System 消息 ──────────────────────────────────────────────

/** 构建类型安全的 system 消息。 */
export function createSystemMessage(content: string): SystemModelMessage {
  return { content, role: "system" };
}

// ─── User 消息 ────────────────────────────────────────────────

/** 构建类型安全的 user 消息(纯文本)。 */
export function createUserMessage(content: string): UserModelMessage {
  return { content, role: "user" };
}

// ─── Assistant 消息 ────────────────────────────────────────────

/** 构建类型安全的纯文本 assistant 消息。 */
export function createTextAssistantMessage(text: string): AssistantModelMessage {
  return { content: text, role: "assistant" };
}

/** 构建类型安全的多 part assistant 消息(文本 + tool-call 等)。
 *  当 parts 为空数组时回退为纯文本，避免空 content 数组。 */
export function createPartsAssistantMessage(parts: AssistantContent): AssistantModelMessage {
  // TypeScript 对 AssistantContent 联合类型的字面量推断有时需要帮助
  return { content: parts, role: "assistant" };
}

// ─── Tool 消息 ──────────────────────────────────────────────────

/** 构建类型安全的单条 tool-result 消息。 */
export function createToolResultMessage(
  toolCallId: string,
  toolName: string,
  output: ToolResultPart["output"],
): ToolModelMessage {
  return {
    content: [
      {
        output,
        toolCallId,
        toolName,
        type: "tool-result",
      },
    ],
    role: "tool",
  };
}

/** 构建类型安全的多条 tool-result 消息(批量场景)。 */
export function createMultiToolResultMessage(parts: ToolResultPart[]): ToolModelMessage {
  return { content: parts, role: "tool" };
}

/** 构建错误类型的 tool-result 消息(doom loop / 拦截等场景)。 */
export function createToolErrorMessage(toolCallId: string, toolName: string, errorText: string): ToolModelMessage {
  return {
    content: [
      {
        output: { type: "error-text", value: errorText },
        toolCallId,
        toolName,
        type: "tool-result",
      },
    ],
    role: "tool",
  };
}

// ─── Assistant Part 构建 ──────────────────────────────────────

/** 构建文本 part。 */
export function textPart(text: string): TextPart {
  return { text, type: "text" };
}

/** 构建 tool-call part。 */
export function toolCallPart(toolCallId: string, toolName: string, input: unknown): ToolCallPart {
  return {
    input,
    toolCallId,
    toolName,
    type: "tool-call",
  };
}

/** 构建 assistant 消息的 parts 数组(文本 + tool-call)。 */
export function buildAssistantParts(
  text: string | undefined,
  toolCalls: {
    toolCallId: string;
    toolName: string;
    args: unknown;
  }[],
): AssistantContent {
  const parts: (TextPart | ToolCallPart)[] = [];
  if (text) {
    parts.push(textPart(text));
  }
  for (const tc of toolCalls) {
    parts.push(toolCallPart(tc.toolCallId, tc.toolName, tc.args));
  }
  // 单纯文本时返回 string，避免不必要的数组
  if (parts.length === 1 && parts[0]!.type === "text") {
    return (parts[0] as TextPart).text;
  }
  return parts;
}

// ─── 消息重建(不可变替换)────────────────────────────────────

/** 从 ModelMessage 重建过滤后的 assistant 消息。
 *  用于 cleanOrphanedToolCallsFromModel / compressor — 返回新消息而非修改原对象。 */
export function rebuildAssistantContent(
  original: ModelMessage,
  newContent: string | AssistantContent | unknown[],
): ModelMessage {
  return { ...original, content: newContent } as ModelMessage;
}

/** 重建 tool 消息(用于 compress 中截断工具输出后重建)。 */
export function rebuildToolContent(original: ModelMessage, newParts: ToolResultPart[]): ToolModelMessage {
  return { content: newParts, role: "tool" };
}

// ─── 消息克隆(保留 role，替换 content)──────────────────────────

/** 以指定 role 和 string content 创建消息(TypeScript 无法从 role 推断 content 类型)。
 *  用于 btwStream 等需要从已有消息提取文本的场景。 */
export function createMessageWithRole(role: ModelMessage["role"], content: string): ModelMessage {
  return { content, role } as ModelMessage;
}

/** 以指定 role 和任意 content 创建消息。
 *  用于 compressService 等需要从 DB 记录重建 ModelMessage 的场景。
 *  将类型断言集中在此处，避免散落在各处。 */
export function createModelMessageFromRecord(role: ModelMessage["role"], content: unknown): ModelMessage {
  return { content, role } as ModelMessage;
}
