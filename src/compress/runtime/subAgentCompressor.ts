/**
 * SubAgentCompressor
 *
 * 职责:
 *   - 根据上下文使用率自适应调整保留轮数
 *   - 95%+ 使用率保留 1 轮
 *   - 85%+ 使用率保留 2 轮
 *   - 80%+ 使用率保留 3 轮
 *   - 使用按轮次切割策略
 *
 * 注: 本模块实现了 "AI 摘要 → 截断回退" 模式，与
 * strategies/hybridCompress.ts → performHybridCompression 结构类似但
 * 存在差异（不同的提示词、轮次切割 vs 链切割、不同的摘要格式），
 * 因此保持独立实现而非复用 hybridCompress。
 *
 * 模块功能:
 *   - SubAgentCompressor: 子代理压缩器类
 *   - compress: 压缩方法
 *   - getAdaptiveKeepRounds: 获取自适应保留轮数
 *   - SubAgentCompressionResult: 子代理压缩结果类型
 *   - CompressConfig: 压缩配置类型
 *   - DEFAULT_COMPRESS_CONFIG: 默认压缩配置
 *
 * 使用场景:
 *   - 子代理上下文压缩
 *   - 队友上下文压缩
 *   - 需要自适应保留策略的场景
 *   - 多轮对话的上下文管理
 *
 * 边界:
 *   1. 按轮次切割而非按工具链切割
 *   2. 使用率越高保留轮数越少
 *   3. 使用协调器防止并发压缩
 *   4. 低于阈值时不压缩
 *
 * 流程:
 *   1. 计算 Token 使用率和百分比
 *   2. 根据使用率确定保留轮数
 *   3. 查找保留区域起始索引
 *   4. 执行 AI 摘要压缩
 *   5. 截断保留区超大工具结果
 *   6. 返回压缩结果
 */
import type { ModelMessage } from "ai";
import type { AppConfigSchema } from "@/schema/config";
import { createLogger } from "@/core/logging/logger";
import { estimateMessagesTokens } from "../conversation";
import { callLlmForSummary, defaultCompressor } from "../core/compressor";
import { cleanOrphanedToolCalls, findRecentRoundsStartIndex, truncateOversizedToolResults } from "../core/compressor";
import { SUB_AGENT_COMPRESSION_PROMPT, serializeMessagesForCompression } from "../overflow/prompt";
import { compressionCoordinator } from "../core/compressionCoordinator";
import { getAdaptiveKeepRounds, getTokenPercentage } from "../overflow/overflow";
import type { CompressConfig, SubAgentCompressionResult } from "../types";
import { DEFAULT_COMPRESS_CONFIG } from "../types";

const log = createLogger("compress:sub-agent");

export class SubAgentCompressor {
  private config: CompressConfig;

  constructor(config?: Partial<CompressConfig>) {
    this.config = { ...DEFAULT_COMPRESS_CONFIG, ...config };
  }

  /**
   * 压缩子代理/队友的上下文。
   *
   * 流程:
   *   1. 按轮次切割:findRecentRoundsStartIndex
   *   2. AI 摘要压缩旧消息
   *   3. 截断保留区超大工具结果(truncateOversizedToolResults)
   *   4. 如果 AI 失败，回退到截断工具结果
   *
   * @returns 压缩结果
   */
  async compress(
    messages: ModelMessage[],
    appConfig: AppConfigSchema,
    modelId: string,
    instanceId?: string,
  ): Promise<SubAgentCompressionResult> {
    const tokensBefore = estimateMessagesTokens(messages);
    const percentage = getTokenPercentage(tokensBefore, modelId);

    if (percentage < this.config.autoCompressThreshold) {
      return {
        afterTokensEstimate: tokensBefore,
        beforeTokens: tokensBefore,
        compressed: false,
        messages,
      };
    }

    log.info(`子代理压缩触发: instance=${instanceId}, usage=${percentage}%`);

    const keepRounds = getAdaptiveKeepRounds(percentage, this.config.keepRecentTurns);

    // 使用协调器防止并发压缩
    return compressionCoordinator.withLock(instanceId ?? "sub-agent", async () => {
      // 按轮次切割(findRecentRoundsStartIndex)
      const preserveStartIndex = findRecentRoundsStartIndex(messages, keepRounds);

      if (preserveStartIndex === 0) {
        log.debug("所有消息都在保留范围内，无需压缩");
        return {
          afterTokensEstimate: tokensBefore,
          beforeTokens: tokensBefore,
          compressed: false,
          messages,
        };
      }

      const messagesToCompress = messages.slice(0, preserveStartIndex);
      const preservedMessages = messages.slice(preserveStartIndex);

      // 清理孤立的 tool_calls
      cleanOrphanedToolCalls(messagesToCompress);

      // 1. 尝试 AI 摘要
      try {
        const serialized = serializeMessagesForCompression(messagesToCompress, this.config.toolOutputTruncateLength);

        const summary = await callLlmForSummary(
          serialized,
          SUB_AGENT_COMPRESSION_PROMPT,
          appConfig,
          "compress:sub-agent",
        );

        if (summary) {
          // AI 成功 → 替换消息
          const newMessages: ModelMessage[] = [
            {
              content: `## Previous Context (Auto-Compressed Summary)\n\n${summary}\n\n---\n\n*The above is a compressed summary of earlier conversation. Continue the task based on this context and the recent tool interactions below.*`,
              role: "user",
            },
            ...preservedMessages,
          ];

          // 截断保留区超大工具结果
          truncateOversizedToolResults(newMessages);

          messages.length = 0;
          messages.push(...newMessages);

          const tokensAfter = estimateMessagesTokens(messages);
          log.info(`子代理 AI 压缩成功: ${tokensBefore} → ${tokensAfter} tokens`);

          return {
            afterTokensEstimate: tokensAfter,
            beforeTokens: tokensBefore,
            compressed: true,
            messages,
          };
        }
      } catch (error) {
        log.warn(`子代理 AI 压缩失败，使用截断结果: ${error instanceof Error ? error.message : String(error)}`);
      }

      // 2. AI 失败 → 回退到截断工具结果
      const truncatedMessages = defaultCompressor.truncateToolResults(messages, keepRounds);

      messages.length = 0;
      messages.push(...truncatedMessages);

      const tokensAfter = estimateMessagesTokens(messages);

      return {
        afterTokensEstimate: tokensAfter,
        beforeTokens: tokensBefore,
        compressed: true,
        messages,
      };
    });
  }
}

/** 全局子代理压缩器实例 */
export const subAgentCompressor = new SubAgentCompressor();
