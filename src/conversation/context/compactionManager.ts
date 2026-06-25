/**
 * 压缩管理器 — 会话级消息压缩配置与执行。
 *
 * 从 ConversationHandler 提取的独立职责:
 *   - 持有压缩配置(CompactionConfig)
 *   - 封装 autoCompactMessages 调用
 *   - 封装 clearCompactionCount 清理
 *
 * 设计原则:
 *   1. 配置在构造时设定，运行时不变
 *   2. 提供简洁的 compact() / cleanup() 入口
 *
 * 边界:
 *   1. 不管理对话历史(messages) — 由外部传入
 *   2. 不感知 LLM 循环状态
 */
import type { ModelMessage } from "ai";
import type { AppConfigSchema } from "@/schema/config";
import { type CompactionConfig, clearCompactionCount } from "@/compress/conversation";
import { autoCompactMessages } from "@/compress";

export class CompactionManager {
  readonly config: CompactionConfig;

  constructor(config: CompactionConfig) {
    this.config = config;
  }

  /** 执行自动压缩(在每轮对话结束后调用) */
  async compact(messages: ModelMessage[], appConfig: AppConfigSchema, sessionId?: string): Promise<void> {
    await autoCompactMessages({
      compactionConfig: this.config,
      config: appConfig,
      messages,
      sessionId,
    });
  }

  /** 清理压缩计数(在 destroy 时调用) */
  cleanup(sessionId?: string): void {
    if (sessionId) {
      clearCompactionCount(sessionId);
    }
  }
}
