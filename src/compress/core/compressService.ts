/**
 * CompressService
 *
 * 职责:
 *   - 提供统一的压缩服务入口
 *   - 封装会话消息加载、压缩执行、结果回写的完整流程
 *   - 支持标准压缩和混合压缩两种模式
 *
 * 模块功能:
 *   - compactSession: 执行标准压缩(AI 摘要)
 *   - hybridCompactSession: 执行混合压缩(AI 摘要 + 工具结果截断)
 *   - CompactResult: 压缩结果接口
 *   - recordsToModelMessages: 将消息记录转为 ModelMessage 数组
 *
 * 使用场景:
 *   - 命令(/compact、/hybrid-compress)调用
 *   - UI 组件直接调用
 *   - 不再依赖 EventBus 中间层
 *
 * 边界:
 *   1. 消息少于 4 条时不执行压缩
 *   2. 使用协调器防止并发压缩
 *   3. 压缩失败时返回错误信息
 *
 * 流程:
 *   1. 加载会话消息
 *   2. 转换为 ModelMessage 数组
 *   3. 执行压缩(AI 摘要或混合)
 *   4. 保存摘要消息到会话
 *   5. 返回压缩结果
 */
import type { AppConfigSchema } from "@/schema/config";
import { createLogger } from "@/core/logging/logger";
import { globalBus } from "@/bus";
import { CompressEvents } from "@/bus/events/compressEvents";
import {
  addTextMessage,
  getSessionMessages,
  messagePartsToChatParts,
  messageRoleToChatRole,
  createCheckpoint,
} from "@/session";
import { compressionCoordinator } from "./compressionCoordinator";
import { estimateMessagesTokens } from "../conversation";
import { goalManager } from "@/mission";
import type { ModelMessage } from "ai";
import { recordCompressionBusinessTelemetry } from "@monitor";
import { createModelMessageFromRecord } from "@/conversation/message/messageFactories";
import { createCompactStrategy, selectCompactStrategyKind } from "../strategies/compactStrategy";
import { createCompressionError, toCompressionFailure } from "./errors";
import type { CompactStrategy, CompactStrategyKind, CompressConfig } from "../types";

const log = createLogger("compress:service");

/**
 * 压缩后注入活跃 Goal 的目标文本，防止续接 prompt 引用脱节。
 */
function injectGoalObjectiveIfNeeded(sessionId: string): void {
  const goal = goalManager.loadGoal(sessionId);
  if (goal && (goal.status === "pursuing" || goal.status === "paused" || goal.status === "budget-limited")) {
    addTextMessage(
      sessionId,
      "system",
      `[Goal 目标提醒] 当前活跃目标: "${goal.objective}" (status=${goal.status}, id=${goal.id})`,
    );
  }
}

export interface CompactResult {
  ok: boolean;
  tokensBefore: number;
  tokensAfter: number;
  messageCount: number;
  preCompressionCheckpointId?: string;
  error?: string;
  errorCode?: string;
}

export interface CompactSessionOptions {
  strategy?: CompactStrategyKind;
  compactStrategy?: CompactStrategy;
  autoSelectStrategy?: boolean;
  tokenBudget?: number;
  preferIncremental?: boolean;
  hasLargeToolResults?: boolean;
  config?: Partial<CompressConfig>;
  keepRecentTurns?: number;
}

/**
 * 将 MessageRecord[] 转为 ModelMessage[] 供压缩器使用。
 */
function recordsToModelMessages(records: ReturnType<typeof getSessionMessages>): ModelMessage[] {
  const messages: ModelMessage[] = [];
  for (const rec of records) {
    const role = messageRoleToChatRole(rec.role);
    const parts = messagePartsToChatParts(rec.parts);
    if (role && parts.length > 0) {
      messages.push(createModelMessageFromRecord(role, parts));
    }
  }
  return messages;
}

/**
 * 执行标准压缩(AI 摘要)。
 *
 * 流程:加载会话消息 → AI 摘要压缩 → 截断超大工具结果 → 保存摘要消息
 *
 * @param sessionId - 会话 ID
 * @param appConfig - 应用配置
 * @returns 压缩结果
 */
export async function compactSession(
  sessionId: string,
  appConfig: AppConfigSchema,
  options: CompactSessionOptions = {},
): Promise<CompactResult> {
  return compressionCoordinator.withLock(sessionId, async () => {
    const startedAt = Date.now();
    const requestedKind = options.compactStrategy?.kind ?? options.strategy ?? "standard";
    let strategy = options.compactStrategy ?? createCompactStrategy(requestedKind);
    let mode = telemetryModeForStrategy(strategy.kind);
    const records = getSessionMessages(sessionId);
    if (records.length < 4) {
      const appError = createCompressionError("too_few_messages", "消息太少，无需压缩", {
        messageCount: records.length,
        sessionId,
        strategy: strategy.kind,
      });
      recordCompressionBusinessTelemetry({
        durationMs: Date.now() - startedAt,
        error: appError.message,
        exitReason: "too_few_messages",
        messageCount: records.length,
        mode,
        status: "error",
        tokensAfter: 0,
        tokensBefore: 0,
      });
      return {
        messageCount: records.length,
        ok: false,
        tokensAfter: 0,
        tokensBefore: 0,
        ...toCompressionFailure(appError),
      };
    }

    const modelMessages = recordsToModelMessages(records);
    const tokensBefore = estimateMessagesTokens(modelMessages);
    if (!options.compactStrategy && options.autoSelectStrategy) {
      const selectedKind = selectCompactStrategyKind({
        allowIncremental: true,
        hasLargeToolResults: options.hasLargeToolResults,
        messageCount: modelMessages.length,
        preferIncremental: options.preferIncremental,
        requestedStrategy: options.strategy,
        tokenBudget: options.tokenBudget,
        tokensBefore,
      });
      strategy = createCompactStrategy(selectedKind);
      mode = telemetryModeForStrategy(strategy.kind);
    }
    const preCompressionCheckpointId = createCheckpoint(sessionId, checkpointReasonForStrategy(strategy.kind)).id;

    log.info(`开始压缩会话 ${sessionId}`, {
      messageCount: modelMessages.length,
      strategy: strategy.kind,
      tokensBefore,
    });

    globalBus.publish(CompressEvents.CompressStarted, {
      percentage: 0,
      sessionId,
      tokenCount: tokensBefore,
    });

    try {
      const result = await strategy.compact({
        appConfig,
        config: options.config,
        keepRecentTurns: options.keepRecentTurns,
        messages: modelMessages,
        sessionId,
        tokensBefore,
      });

      if (result.compressed) {
        const tokensAfter = result.tokensAfterEstimate;
        if (result.summary) {
          addTextMessage(sessionId, "system", `[上下文压缩摘要]\n${result.summary}`);
        } else if (result.markerMessage) {
          addTextMessage(sessionId, "system", result.markerMessage);
        }
        injectGoalObjectiveIfNeeded(sessionId);

        log.info(`压缩完成`, { saved: tokensBefore - tokensAfter, strategy: strategy.kind, tokensAfter, tokensBefore });
        globalBus.publish(CompressEvents.CompressCompleted, {
          compressionRatio: `${Math.round((1 - tokensAfter / tokensBefore) * 100)}%`,
          method: strategy.kind === "hybrid" ? "hybrid" : strategy.kind === "incremental" ? "ai-summary" : "ai-summary",
          sessionId,
          tokensAfter,
          tokensBefore,
        });
        recordCompressionBusinessTelemetry({
          durationMs: Date.now() - startedAt,
          exitReason: "success",
          messageCount: modelMessages.length,
          mode,
          status: "success",
          tokensAfter,
          tokensBefore,
        });

        return {
          messageCount: modelMessages.length,
          ok: true,
          preCompressionCheckpointId,
          tokensAfter,
          tokensBefore,
        };
      }

      // compressed=false: 策略判定无需压缩（如消息全在保留范围内），非错误
      recordCompressionBusinessTelemetry({
        durationMs: Date.now() - startedAt,
        exitReason: "no_compression_needed",
        messageCount: modelMessages.length,
        mode,
        status: "success",
        tokensAfter: tokensBefore,
        tokensBefore,
      });
      return {
        messageCount: modelMessages.length,
        ok: true,
        preCompressionCheckpointId,
        tokensAfter: tokensBefore,
        tokensBefore,
      };
    } catch (error) {
      const appError = createCompressionError(
        "exception",
        error instanceof Error ? error.message : String(error),
        { messageCount: modelMessages.length, sessionId, strategy: strategy.kind, tokensBefore },
        error,
      );
      log.error(`压缩失败: ${appError.message}`, { code: appError.code, context: appError.context });
      globalBus.publish(CompressEvents.CompressFailed, {
        error: appError.message,
        method: strategy.kind,
        sessionId,
      });
      recordCompressionBusinessTelemetry({
        durationMs: Date.now() - startedAt,
        error: appError.message,
        exitReason: "exception",
        messageCount: modelMessages.length,
        mode,
        status: "error",
        tokensAfter: tokensBefore,
        tokensBefore,
      });
      return {
        messageCount: modelMessages.length,
        ok: false,
        preCompressionCheckpointId,
        tokensAfter: tokensBefore,
        tokensBefore,
        ...toCompressionFailure(appError),
      };
    }
  });
}

/**
 * 执行混合压缩(AI 摘要 + 工具结果截断)。
 *
 * 流程:加载会话消息 → 混合压缩 → 保存摘要消息
 *
 * @param sessionId - 会话 ID
 * @param appConfig - 应用配置
 * @returns 压缩结果
 */
export async function hybridCompactSession(
  sessionId: string,
  appConfig: AppConfigSchema,
  options: Omit<CompactSessionOptions, "strategy"> = {},
): Promise<CompactResult> {
  return compactSession(sessionId, appConfig, { ...options, strategy: "hybrid" });
}

function telemetryModeForStrategy(kind: CompactStrategyKind): "compact" | "hybrid" | "incremental" {
  if (kind === "hybrid") {
    return "hybrid";
  }
  if (kind === "incremental") {
    return "incremental";
  }
  return "compact";
}

function checkpointReasonForStrategy(kind: CompactStrategyKind): string {
  if (kind === "hybrid") {
    return "pre-hybrid-compression";
  }
  if (kind === "incremental") {
    return "pre-incremental-compression";
  }
  return "pre-compression";
}
