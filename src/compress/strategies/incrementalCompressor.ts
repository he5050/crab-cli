/**
 * 增量压缩器 — 基于 diff 的智能增量压缩。
 *
 * 职责:
 *   - 检测消息序列的变化(增量检测)
 *   - 只对变化部分进行压缩，而非全量重压缩
 *   - 维护压缩历史，避免重复压缩相同内容
 *   - 支持增量快照和回滚
 *
 * 与普通压缩器的区别:
 *   - 普通压缩器:每次都对全量消息进行 AI 摘要压缩
 *   - 增量压缩器:只压缩新增/变化的消息，保留历史压缩结果
 *
 * 使用场景:
 *   - 频繁压缩的长会话
 *   - 减少 AI 压缩成本
 *   - 加快压缩速度
 *
 * 边界:
 *   1. 只适用于追加模式的会话(常见场景)
 *   2. 当变化过大时回退到全量压缩
 *   3. 需要维护压缩历史状态
 */

import type { ModelMessage } from "ai";
import { createLogger } from "@/core/logging/logger";
import type { CompressionEntry, CompressionResult, IncrementalCompressionState } from "../types";

const log = createLogger("compress:incremental");

// ─── 类型定义 ─────────────────────────────────────────────────────

/** 变化检测结果 */
interface ChangeDetection {
  /** 是否有变化 */
  hasChanges: boolean;
  /** 新增消息数 */
  newMessages: ModelMessage[];
  /** 变化的起始索引 */
  changeStartIndex: number;
  /** 变化类型 */
  changeType: "append" | "modify" | "delete" | "none";
}

/** 增量压缩配置 */
export interface IncrementalCompressConfig {
  /** 哈希算法 */
  hashAlgorithm?: "md5" | "sha1" | "simple";
  /** 最大历史条目数 */
  maxHistoryEntries?: number;
  /** 变化阈值(超过此比例认为需要全量重压缩) */
  changeThreshold?: number;
  /** 是否启用智能缓存 */
  enableCache?: boolean;
}

// ─── 简单哈希函数 ─────────────────────────────────────────────────

/**
 * 简单的内容哈希(不依赖 crypto)
 */
function simpleHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash &= hash; // 转为 32 位整数
  }
  return Math.abs(hash).toString(36);
}

/**
 * 计算消息内容的哈希
 */
function hashMessage(msg: ModelMessage): string {
  const content = JSON.stringify({
    content: typeof msg.content === "string" ? msg.content : "[complex]",
    role: msg.role,
  });
  return simpleHash(content);
}

// ─── 增量压缩器 ─────────────────────────────────────────────────

/**
 * 增量压缩器
 */
export class IncrementalCompressor {
  private sessionId: string;
  private state: IncrementalCompressionState;
  private config: Required<IncrementalCompressConfig>;
  private compressor: (messages: ModelMessage[]) => Promise<CompressionResult>;
  /** 消息索引 → 压缩条目的快速查找表，避免 O(n) entries.find() */
  private indexToEntry = new Map<number, CompressionEntry>();

  constructor(
    sessionId: string,
    compressor: (messages: ModelMessage[]) => Promise<CompressionResult>,
    config: IncrementalCompressConfig = {},
  ) {
    this.sessionId = sessionId;
    this.compressor = compressor;
    this.config = {
      changeThreshold: config.changeThreshold ?? 0.3,
      enableCache: config.enableCache ?? true,
      hashAlgorithm: config.hashAlgorithm ?? "simple",
      maxHistoryEntries: config.maxHistoryEntries ?? 1000,
    };
    this.state = {
      compressionCount: 0,
      entries: [],
      lastMessageCount: 0,
      messageIndex: {},
      sessionId,
      totalTokensSaved: 0,
    };
  }

  /**
   * 获取当前状态
   */
  getState(): IncrementalCompressionState {
    return { ...this.state };
  }

  /**
   * 恢复状态
   */
  restoreState(state: IncrementalCompressionState): void {
    this.state = { ...state, messageIndex: state.messageIndex ?? {} };
    // 从 entries 重建索引映射
    this.indexToEntry.clear();
    for (const entry of this.state.entries) {
      this.indexToEntry.set(entry.index, entry);
    }
    log.debug(`恢复增量压缩状态: session=${this.sessionId}, entries=${this.state.entries.length}`);
  }

  /**
   * 检测消息变化
   */
  detectChanges(messages: ModelMessage[]): ChangeDetection {
    const lastCount = this.state.lastMessageCount;

    // 情况1:消息减少(被删除)— 需要全量重压缩
    if (messages.length < lastCount) {
      return {
        changeStartIndex: 0,
        changeType: "delete",
        hasChanges: true,
        newMessages: [],
      };
    }

    // 情况2:消息数量不变 — 检查是否修改
    if (messages.length === lastCount) {
      // 比较：优先使用 indexToEntry O(1) 查找，
      // 若已被清除（压缩后物理索引失效）则保守判定为有变化
      for (let i = 0; i < messages.length; i++) {
        const msgHash = hashMessage(messages[i]!);
        const entry = this.indexToEntry.get(i);
        if (!entry) {
          // indexToEntry 被清除（压缩后），回退到全量比较
          // 使用 messageIndex 哈希表做 O(1) 查找
          const hashEntry = this.state.messageIndex[msgHash];
          if (!hashEntry) {
            // 未见过此哈希 → 有变化
            return {
              changeStartIndex: i,
              changeType: "modify",
              hasChanges: true,
              newMessages: [],
            };
          }
          continue;
        }
        if (entry.contentHash !== msgHash) {
          return {
            changeStartIndex: i,
            changeType: "modify",
            hasChanges: true,
            newMessages: [],
          };
        }
      }
      return { changeStartIndex: -1, changeType: "none", hasChanges: false, newMessages: [] };
    }

    // 情况3:消息增加 — 检查增量部分
    const newCount = messages.length - lastCount;
    if (newCount > 0 && lastCount > 0) {
      // 检查新增部分是否与历史冲突
      for (let i = lastCount; i < messages.length; i++) {
        const entry = this.indexToEntry.get(i);
        if (entry) {
          const msgHash = hashMessage(messages[i]!);
          if (entry.contentHash !== msgHash) {
            return {
              changeStartIndex: lastCount,
              changeType: "modify",
              hasChanges: true,
              newMessages: messages.slice(lastCount),
            };
          }
        }
      }
    }

    // 新增消息
    const newMessages = messages.slice(lastCount);
    return {
      changeStartIndex: lastCount,
      changeType: "append",
      hasChanges: true,
      newMessages,
    };
  }

  /**
   * 执行增量压缩
   */
  async compress(messages: ModelMessage[]): Promise<CompressionResult> {
    const changes = this.detectChanges(messages);

    // 无变化，使用缓存
    if (!changes.hasChanges) {
      log.debug(`增量压缩: 无变化，跳过压缩`);
      return {
        preservedMessages: messages.slice(-4),
        summary: "[使用缓存的压缩结果]",
        usage: { completion_tokens: 0, prompt_tokens: 0, total_tokens: 0 },
      };
    }

    // 删除操作，需要全量重压缩
    if (changes.changeType === "delete") {
      log.info(`增量压缩: 检测到删除操作，执行全量重压缩`);
      return this.doFullCompression(messages);
    }

    // 修改超过阈值，全量重压缩
    const changeRatio = changes.newMessages.length / messages.length;
    if (changeRatio > this.config.changeThreshold) {
      log.info(`增量压缩: 变化比例过大 (${changeRatio.toFixed(2)}>${this.config.changeThreshold})，执行全量重压缩`);
      return this.doFullCompression(messages);
    }

    // 增量压缩:只压缩新增消息
    log.debug(`增量压缩: 新增 ${changes.newMessages.length} 条消息`);
    return this.doIncrementalCompression(messages, changes);
  }

  /**
   * 执行全量压缩
   */
  private async doFullCompression(messages: ModelMessage[]): Promise<CompressionResult> {
    // 清除历史
    this.state.entries = [];
    this.state.lastMessageCount = 0;

    // 调用普通压缩器
    const result = await this.compressor(messages);

    // 更新状态
    this.updateStateAfterCompression(messages, result);

    return result;
  }

  /**
   * 执行增量压缩
   */
  private async doIncrementalCompression(
    messages: ModelMessage[],
    changes: ChangeDetection,
  ): Promise<CompressionResult> {
    // 只对新增消息进行压缩
    const { newMessages } = changes;
    if (newMessages.length === 0) {
      return {
        preservedMessages: messages.slice(-4),
        summary: "[无新增消息]",
        usage: { completion_tokens: 0, prompt_tokens: 0, total_tokens: 0 },
      };
    }

    // 构建压缩上下文(保留最近的摘要区域)
    const preservedCount = 4; // 保留最近 4 轮
    const preservedStart = Math.max(0, this.state.lastMessageCount - preservedCount);
    const preservedMessages = messages.slice(preservedStart, this.state.lastMessageCount);

    // 构造要压缩的部分(新增消息 + 保留区域)
    const toCompress = [...preservedMessages, ...newMessages];

    // 调用压缩器
    const result = await this.compressor(toCompress);

    // 更新状态
    this.state.lastMessageCount = messages.length;
    this.state.compressionCount++;

    // 记录新的压缩条目
    // 注: index 字段仅用于日志追踪，不用于物理索引匹配。
    // 压缩后消息数组会被替换（summary + preserved），
    // 物理索引失效。hash 通过 messageIndex 哈希表进行 O(1) 匹配。
    for (let i = 0; i < newMessages.length; i++) {
      const hash = hashMessage(newMessages[i]!);
      const entry: CompressionEntry = {
        contentHash: hash,
        index: this.state.lastMessageCount + i,
        summary: `增量压缩 #${this.state.compressionCount}: ${result.summary.slice(0, 100)}...`,
        timestamp: Date.now(),
        valid: true,
      };
      this.state.entries.push(entry);
      this.state.messageIndex[hash] = entry;
    }

    // 清除物理索引映射，压缩后物理索引不再可靠
    this.indexToEntry.clear();

    // 清理过期条目
    this.cleanupOldEntries();

    log.debug(
      `增量压缩完成: 新增 ${newMessages.length} 条, 累计压缩 ${this.state.compressionCount} 次, ` +
        `累计节省 ${this.state.totalTokensSaved} tokens`,
    );

    return result;
  }

  /**
   * 更新压缩后的状态
   */
  private updateStateAfterCompression(messages: ModelMessage[], result: CompressionResult): void {
    this.state.lastMessageCount = messages.length;
    this.state.compressionCount++;
    this.indexToEntry.clear();

    // 估算节省的 token
    if (result.usage) {
      const beforeTokens = result.usage.total_tokens;
      const afterEstimate = beforeTokens * 0.3; // 假设压缩到 30%
      this.state.totalTokensSaved += Math.max(0, beforeTokens - afterEstimate);
    }

    // 记录压缩条目（使用哈希索引 + 索引映射）
    for (let i = 0; i < messages.length; i++) {
      const hash = hashMessage(messages[i]!);
      const entry: CompressionEntry = {
        contentHash: hash,
        index: i,
        summary: result.summary.slice(0, 100),
        timestamp: Date.now(),
        valid: true,
      };
      this.state.entries.push(entry);
      this.state.messageIndex[hash] = entry;
      this.indexToEntry.set(i, entry);
    }

    this.cleanupOldEntries();
  }

  /**
   * 清理过期的历史条目
   */
  private cleanupOldEntries(): void {
    if (this.state.entries.length <= this.config.maxHistoryEntries) {
      return;
    }

    // 按时间排序，删除最旧的
    this.state.entries.sort((a, b) => a.timestamp - b.timestamp);
    const toRemove = this.state.entries.length - this.config.maxHistoryEntries;
    const removed = this.state.entries.splice(0, toRemove);

    // 同时清理哈希索引和索引映射
    for (const entry of removed) {
      delete this.state.messageIndex[entry.contentHash];
      this.indexToEntry.delete(entry.index);
    }

    log.debug(`清理过期压缩条目: 移除 ${toRemove} 条`);
  }

  /**
   * 获取压缩统计
   */
  getStats(): {
    compressionCount: number;
    totalTokensSaved: number;
    entriesCount: number;
    efficiency: number;
  } {
    const efficiency = this.state.compressionCount > 0 ? this.state.totalTokensSaved / this.state.compressionCount : 0;

    return {
      compressionCount: this.state.compressionCount,
      efficiency: Math.round(efficiency),
      entriesCount: this.state.entries.length,
      totalTokensSaved: Math.round(this.state.totalTokensSaved),
    };
  }
}

// ─── 工厂函数 ────────────────────────────────────────────────────

/**
 * 创建增量压缩器
 */
export function createIncrementalCompressor(
  sessionId: string,
  compressor: (messages: ModelMessage[]) => Promise<CompressionResult>,
  config?: IncrementalCompressConfig,
): IncrementalCompressor {
  return new IncrementalCompressor(sessionId, compressor, config);
}
