import type { ModelMessage } from "ai";
import { DEFAULT_COMPACTION_CONFIG, estimateMessagesTokens, truncateToolOutputs } from "@/conversation";
import { SubAgentCompressor } from "@/compress";
import type { AppConfigSchema } from "@/schema/config";
import { createLogger } from "@/core/logging/logger";
import type { Teammate } from "../types";
import type { TeammateExecutionOptions } from "../mate/teamExecutorHelpers";
import type { TeamToolCall } from "../execution/teamLoopMessages";

const log = createLogger("team:loop-compression");

export interface TeamLoopCompressor {
  compress(
    messages: ModelMessage[],
    appConfig: AppConfigSchema,
    modelId: string,
    instanceId?: string,
  ): Promise<{
    compressed: boolean;
    messages?: ModelMessage[];
    beforeTokens?: number;
    afterTokensEstimate?: number;
  }>;
}

export interface HandleTeamLoopCompressionOptions {
  messages: ModelMessage[];
  appConfig: AppConfigSchema;
  mate: Teammate;
  toolCalls: readonly TeamToolCall[];
  onMessage?: TeammateExecutionOptions["onMessage"];
  compressor?: TeamLoopCompressor;
  estimateTokens?: (messages: ModelMessage[]) => number;
  compressionThreshold?: number;
  toolOutputTruncateLength?: number;
}

export interface TeamLoopCompressionResult {
  estimatedTokens: number;
  compressed: boolean;
  shouldContinue: boolean;
}

/** 队友循环末尾的上下文压缩与工具输出截断。 */
export async function handleTeamLoopCompression({
  messages,
  appConfig,
  mate,
  toolCalls,
  onMessage,
  compressor = defaultTeamLoopCompressor,
  estimateTokens = estimateMessagesTokens,
  compressionThreshold = 80_000,
  toolOutputTruncateLength = DEFAULT_COMPACTION_CONFIG.toolOutputTruncateLength,
}: HandleTeamLoopCompressionOptions): Promise<TeamLoopCompressionResult> {
  const estimatedTokens = estimateTokens(messages);
  let compressed = false;
  let shouldContinue = false;

  if (estimatedTokens >= compressionThreshold) {
    log.info(`队友 ${mate.id} 触发上下文压缩: ${estimatedTokens} tokens`);

    onMessage?.({
      status: "compressing",
      teammateId: mate.id,
      teammateName: mate.name,
      type: "status",
    });

    try {
      const compactionResult = await compressor.compress(messages, appConfig, mate.model ?? "default", mate.sessionId);
      ({ compressed } = compactionResult);

      if (compactionResult.compressed) {
        if (compactionResult.messages) {
          messages.length = 0;
          messages.push(...compactionResult.messages);
        }
        log.info(
          `队友 ${mate.id} 上下文已压缩: ${compactionResult.beforeTokens} → ${compactionResult.afterTokensEstimate} tokens`,
        );

        // 压缩后如果没有工具调用，追加提示让队友继续工作
        if (toolCalls.length === 0) {
          // 清理末尾的 assistant 消息(可能是压缩产生的 ack)
          while (messages.length > 0 && messages[messages.length - 1]!.role === "assistant") {
            messages.pop();
          }
          messages.push({
            content: "[System] 上下文已自动压缩。你的任务尚未完成，请继续工作。",
            role: "user",
          });
          shouldContinue = true;
        }
      }
    } catch (error) {
      log.warn(`队友 ${mate.id} 上下文压缩失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 截断旧工具输出(每轮都做，防止累积过大)
  truncateToolOutputs(messages, toolOutputTruncateLength);

  return { compressed, estimatedTokens, shouldContinue };
}

const defaultTeamLoopCompressor = new SubAgentCompressor();
