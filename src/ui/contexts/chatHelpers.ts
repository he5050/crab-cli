/**
 * Chat Context 辅助函数 — 运行时覆盖项装配与消息历史加载。
 *
 * 职责:
 *   - 组装 ChatRuntimeOverrides(systemPrompt、maxToolRounds、loadedSkills 等)
 *   - 从持久化层加载会话历史
 *   - 通用元数据合并与时间标准化
 *
 * 模块功能:
 *   - buildChatRuntimeOverrides: 合并 Agent/Role/Skill/Config 生成 systemPrompt
 *   - nextId: 生成消息 ID
 *   - stringifyForStorage: 序列化工具输出
 *   - mergeMetadata: 合并两个元数据对象
 *   - normalizePartTime: 标准化时间字段(自动算 durationMs)
 *   - appendMessage: 不可变追加消息
 *   - loadPersistedChatMessages: 从会话存储恢复历史消息
 */
import { createId } from "@/core/identity";
import type { ChatMessage } from "./chatTypes";
import {
  type MessagePartTime,
  extractPlainText,
  getSessionMessages,
  messagePartsToChatParts,
  messageRoleToChatRole,
} from "@/session";

// buildChatRuntimeOverrides 已迁移至 @/agent/prompt/runtimeOverrides（消除 Headless 对 @/ui 的依赖）
// 此处保留 re-export 以兼容现有消费者
export { buildChatRuntimeOverrides } from "@/agent/prompt/runtimeOverrides";

export function nextId(): string {
  return createId("msg");
}

export function stringifyForStorage(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (
    value &&
    typeof value === "object" &&
    "output" in value &&
    typeof (value as { output?: unknown }).output === "string"
  ) {
    return (value as { output: string }).output;
  }
  if (value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function mergeMetadata(
  base?: Record<string, unknown>,
  override?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const merged = { ...base, ...override };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

export function normalizePartTime(
  time?: MessagePartTime,
  startedAt?: number,
  endedAt?: number,
  durationMs?: number,
): MessagePartTime | undefined {
  const normalized: MessagePartTime = { ...time };
  if (startedAt !== undefined) {
    normalized.startedAt = startedAt;
  }
  if (endedAt !== undefined) {
    normalized.endedAt = endedAt;
  }
  if (durationMs !== undefined) {
    normalized.durationMs = durationMs;
  }
  if (normalized.durationMs === undefined && normalized.startedAt !== undefined && normalized.endedAt !== undefined) {
    normalized.durationMs = Math.max(0, normalized.endedAt - normalized.startedAt);
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function appendMessage(prev: ChatMessage[], msg: ChatMessage): ChatMessage[] {
  const next = [...prev];
  next.push(msg);
  return next;
}

export function loadPersistedChatMessages(sessionId?: string): ChatMessage[] {
  if (!sessionId) {
    return [];
  }
  return getSessionMessages(sessionId).map((msg) => {
    const chatParts = messagePartsToChatParts(msg.parts);
    return {
      content: extractPlainText(msg.parts),
      id: msg.id,
      parts: chatParts.length > 0 ? chatParts : undefined,
      role: messageRoleToChatRole(msg.role),
    };
  });
}
