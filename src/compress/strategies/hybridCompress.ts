/**
 * HybridCompress
 *
 * 职责:
 *   - 先尝试 AI 摘要压缩
 *   - 失败回退到工具结果截断
 *   - AI 成功后截断保留区域超大工具结果
 *
 * 模块功能:
 *   - performHybridCompression: 执行混合压缩
 *   - SubAgentCompressionResult: 子代理压缩结果类型
 *   - CompressConfig: 压缩配置类型
 *   - DEFAULT_COMPRESS_CONFIG: 默认压缩配置
 *
 * 使用场景:
 *   - 需要可靠压缩的场景
 *   - AI 压缩可能失败时的备选方案
 *   - 子代理上下文压缩
 *   - 混合策略保证压缩成功率
 *
 * 边界:
 *   1. AI 压缩优先，失败才截断
 *   2. 保留区域工具结果也会截断
 *   3. 会修改传入的消息数组
 *   4. 返回压缩前后的 Token 估算
 *
 * 流程:
 *   1. 尝试 AI 摘要压缩
 *   2. 成功后截断保留区超大工具结果
 *   3. AI 失败时回退到工具结果截断
 *   4. 返回压缩结果和 Token 变化
 */
import type { ModelMessage } from "ai";
import type { AppConfigSchema } from "@/schema/config";
import { createLogger } from "@/core/logging/logger";
import { estimateMessagesTokens } from "../conversation";
import { defaultCompressor, truncateOversizedToolResults } from "../core/compressor";
import type { CompressConfig, SubAgentCompressionResult } from "../types";
import { DEFAULT_COMPRESS_CONFIG } from "../types";

const log = createLogger("compress:hybrid");

/**
 * 执行混合压缩。
 *
 * 1. AI 摘要压缩(主流方法)
 * 2. AI 成功后截断保留区超大工具结果(truncateOversizedToolResults)
 * 3. 失败时回退到工具结果截断
 *
 * @returns 压缩结果
 */
export async function performHybridCompression(
  messages: ModelMessage[],
  appConfig: AppConfigSchema,
  config?: Partial<CompressConfig>,
  keepRounds: number = 3,
): Promise<SubAgentCompressionResult> {
  const effectiveConfig = { ...DEFAULT_COMPRESS_CONFIG, ...config };
  const tokensBefore = estimateMessagesTokens(messages);

  log.info(`开始混合压缩`, {
    eventType: "compress.hybrid.start",
    payload: { keepRounds, messageCount: messages.length, tokensBefore },
  });

  // 1. 尝试 AI 摘要压缩
  try {
    const result = await defaultCompressor.compressWithAI(messages, appConfig);

    if (result) {
      // AI 成功后截断保留区超大工具结果
      truncateOversizedToolResults(messages);

      const tokensAfter = estimateMessagesTokens(messages);
      log.info(`混合压缩: AI 摘要成功(含保留区截断)`, {
        eventType: "compress.hybrid.ai-success",
        payload: { tokensAfter, tokensBefore },
      });

      return {
        afterTokensEstimate: tokensAfter,
        beforeTokens: tokensBefore,
        compressed: true,
        messages,
      };
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.warn(`混合压缩: AI 摘要失败，回退到截断: ${errMsg}`);
  }

  // 2. 回退到工具结果截断
  const truncatedMessages = defaultCompressor.truncateToolResults(messages, keepRounds);

  // 替换原数组
  messages.length = 0;
  messages.push(...truncatedMessages);

  const tokensAfter = estimateMessagesTokens(messages);

  log.info(`混合压缩: 工具截断完成`, {
    eventType: "compress.hybrid.truncate-success",
    payload: { tokensAfter, tokensBefore },
  });

  return {
    afterTokensEstimate: tokensAfter,
    beforeTokens: tokensBefore,
    compressed: true,
    messages,
  };
}
