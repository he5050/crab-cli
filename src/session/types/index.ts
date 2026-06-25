/**
 * Session 模块导出的纯数据类型(无运行时依赖)
 *
 * 供 bus/、ui/ 等跨层模块直接引用，
 * 避免 bus/ 反向依赖 session/ 的具体实现。
 *
 * session/message.ts 和 session/tokenUsage.ts 从此文件 re-export。
 */

/** 消息 Part 的时间信息 */
export interface MessagePartTime {
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
}

/** 消息 Part 中的文件引用 */
export interface MessageFileReference {
  path: string;
  kind?: "read" | "write" | "edit" | "delete" | "patch" | "other";
  status?: "pending" | "done" | "error";
  diff?: string;
  language?: string;
  line?: number;
}

/** Token 使用量事件/会话公共类型 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  cachedTokens?: number;
}
