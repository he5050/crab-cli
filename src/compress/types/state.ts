/**
 * 压缩状态类型定义
 *
 * 定义压缩过程中的状态机和增量压缩状态。
 */

/** 压缩状态 */
export type CompressionStatus =
  | { step: "preparing"; sessionId?: string }
  | { step: "compressing"; progress?: number; sessionId?: string }
  | { step: "completed"; tokensSaved?: number; sessionId?: string }
  | { step: "failed"; message: string; sessionId?: string }
  | {
      step: "retrying";
      message: string;
      retryAttempt: number;
      maxRetries: number;
      sessionId?: string;
    };

/** 压缩条目 — 已压缩消息的记录 */
export interface CompressionEntry {
  /** 消息索引 */
  index: number;
  /** 原始消息内容哈希 */
  contentHash: string;
  /** 压缩后的摘要 */
  summary: string;
  /** 压缩时间 */
  timestamp: number;
  /** 是否有效 */
  valid: boolean;
}

/** 增量压缩状态 */
export interface IncrementalCompressionState {
  /** 会话 ID */
  sessionId: string;
  /** 压缩条目列表（按时间排序） */
  entries: CompressionEntry[];
  /** 上次压缩后的消息总数 */
  lastMessageCount: number;
  /** 消息哈希索引，用于快速查找和非索引追踪 */
  messageIndex: Record<string, CompressionEntry>;
  /** 累计节省的 token 数 */
  totalTokensSaved: number;
  /** 压缩次数 */
  compressionCount: number;
}
