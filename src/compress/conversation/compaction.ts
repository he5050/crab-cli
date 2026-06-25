/**
 * 上下文压缩(Compaction)— 自动管理对话历史长度。
 *
 * 职责:
 *   - 估算对话历史的 token 数量
 *   - 当 token 超过阈值时自动压缩旧消息
 *   - 用结构化摘要替换被压缩的消息
 *   - 截断大型工具输出以节省 token
 *
 * 模块功能:
 *   - findSplitIndex(): 计算消息分割点
 *   - maybeCompact(): 检查并执行压缩
 *   - truncateToolOutputs(): 截断工具输出
 *
 * 使用场景:
 *   - ConversationHandler.sendMessage 完成后检查是否需要压缩
 *   - 对话历史过长时自动触发压缩
 *
 * 边界:
 * 1. 保留最近的 keepRecentTurns 轮对话完整
 * 2. 压缩前触发 Compress Hook(before)
 * 3. 压缩后触发 Compress Hook(after)
 *
 * 流程:
 * 1. 估算当前历史总 token 数
 * 2. 超过阈值 → 计算分割点，取旧消息
 * 3. 生成结构化摘要替换旧消息
 * 4. 用摘要消息 + ack 消息 + 近期消息组成新历史
 */
import type { ModelMessage } from "ai";
import type { AppConfigSchema } from "@/schema/config";
import {
  DEFAULT_COMPACTION_KEEP_RECENT_TURNS,
  DEFAULT_COMPACTION_TARGET_RATIO,
  DEFAULT_COMPACTION_TOKEN_THRESHOLD,
  DEFAULT_TOOL_OUTPUT_TRUNCATE_LENGTH,
} from "@/config";
import { createLogger } from "@/core/logging/logger";
import { globalBus, type EventBus } from "@/bus";
import { AppEvent } from "@/bus";
import { CompressEvents } from "@/bus/events/compressEvents";
import { hookExecutor } from "@/hooks/hookExecutor";
import { estimateMessagesTokens } from "@/session/token/tokenCounterRef";
import { getAdaptiveKeepRounds, getTokenPercentage } from "../overflow/overflow";
import { generateSummary } from "../../conversation/lifecycle/summaryGenerator";
import { type CompactionBranchPoint, generateBranchPointId, saveBranchPoint } from "@/tool/rollback/branchPoints";
import { addMessage, deleteSessionMessages, modelMessageToParts } from "@/session";

const log = createLogger("compaction");

/** 每个会话的压缩计数器 */
const compactionCounts = new Map<string, number>();

/** 压缩计数器最大条目数（超出时自动清理最旧条目，防止内存泄漏） */
const MAX_COMPACTION_COUNTS = 1000;

// ─── 配置 ──────────────────────────────────────────────────────

/** 压缩配置 */
export interface CompactionConfig {
  /** Token 阈值，超过此值触发压缩。默认 80_000 */
  tokenThreshold: number;
  /** 压缩后保留的近期消息轮次(user+assistant 对数)。默认 4 */
  keepRecentTurns: number;
  /** 工具输出截断长度(字符)，超过此长度的工具输出在压缩时截断。默认 2000 */
  toolOutputTruncateLength: number;
  /** 压缩后目标 token 占比(相对阈值)，默认 0.3(即压缩到阈值的 30%) */
  targetRatio: number;
}

/** 默认压缩配置 */
export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  keepRecentTurns: DEFAULT_COMPACTION_KEEP_RECENT_TURNS,
  targetRatio: DEFAULT_COMPACTION_TARGET_RATIO,
  tokenThreshold: DEFAULT_COMPACTION_TOKEN_THRESHOLD,
  toolOutputTruncateLength: DEFAULT_TOOL_OUTPUT_TRUNCATE_LENGTH,
};

// ─── 分割点计算 ────────────────────────────────────────────────

/**
 * 计算消息分割点:将 messages 分为「待压缩的旧消息」和「保留的近期消息」。
 *
 * 从末尾向前数 keepRecentTurns 个「用户消息」作为分割线，
 * 保留分割线之后的所有消息(可能包含 assistant + tool + user 混合)。
 *
 * @returns splitIndex — 前 splitIndex 条消息将被压缩
 */
export function findSplitIndex(messages: ModelMessage[], keepRecentTurns: number): number {
  if (messages.length === 0) {
    return 0;
  }

  let userTurnsSeen = 0;

  // 从末尾向前遍历，数到 keepRecentTurns 个 user 消息
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") {
      userTurnsSeen++;
      if (userTurnsSeen >= keepRecentTurns) {
        // 保留从这条 user 消息开始往后的所有消息
        // 但要确保不把 system 消息切掉
        return Math.max(1, i); // 至少跳过可能的 system 消息
      }
    }
  }

  // 不够 keepRecentTurns 轮 → 不压缩
  return 0;
}

// ─── 主入口 ────────────────────────────────────────────────────

/** 压缩结果 */
export interface CompactionResult {
  /** 是否执行了压缩 */
  compacted: boolean;
  /** 压缩前的消息数 */
  messagesBefore: number;
  /** 压缩后的消息数 */
  messagesAfter: number;
  /** 压缩前的估算 token 数 */
  tokensBefore: number;
  /** 压缩后的估算 token 数 */
  tokensAfter: number;
  /** 摘要文本 */
  summary: string;
  /** 耗时(毫秒) */
  durationMs: number;
}

/**
 * 检查是否需要压缩并执行。
 *
 * 调用时机:ConversationHandler.sendMessage 完成后。
 * 自动判断 token 是否超阈值，超过则执行压缩。
 *
 * @param messages 当前对话历史(将被就地修改)
 * @param config 应用配置
 * @param compactionConfig 压缩配置
 * @returns 压缩结果(compacted=false 表示未触发)
 */
export async function maybeCompact(
  messages: ModelMessage[],
  config: AppConfigSchema,
  compactionConfig: CompactionConfig,
  sessionId?: string,
  eventBus: EventBus = globalBus,
): Promise<CompactionResult> {
  const startTime = Date.now();
  const tokensBefore = estimateMessagesTokens(messages);
  const preCompressionMessages = cloneModelMessages(messages);

  const result: CompactionResult = {
    compacted: false,
    durationMs: 0,
    messagesAfter: messages.length,
    messagesBefore: messages.length,
    summary: "",
    tokensAfter: tokensBefore,
    tokensBefore,
  };

  // 1. 未超阈值 → 不压缩
  if (tokensBefore < compactionConfig.tokenThreshold) {
    log.debug(`token 数未达阈值，跳过压缩`, {
      eventType: "compaction.skip",
      payload: {
        currentTokens: tokensBefore,
        messageCount: messages.length,
        threshold: compactionConfig.tokenThreshold,
      },
    });
    result.durationMs = Date.now() - startTime;
    return result;
  }

  // 2. 根据模型上下文压力自适应调整保留轮数。
  // TokenThreshold 只决定是否触发压缩；保留轮数应基于真实模型窗口压力。
  const modelId = config.defaultProvider?.model ?? "unknown";
  const percentage = getTokenPercentage(tokensBefore, modelId);
  const keepRecent = getAdaptiveKeepRounds(percentage, compactionConfig.keepRecentTurns);
  const splitIndex = findSplitIndex(messages, keepRecent);

  if (splitIndex === 0) {
    log.debug(`消息数不足以分割，跳过压缩`, {
      eventType: "compaction.skip-too-few",
      payload: {
        keepRecentTurns: compactionConfig.keepRecentTurns,
        messageCount: messages.length,
      },
    });
    result.durationMs = Date.now() - startTime;
    return result;
  }

  // 3. 分割消息
  const oldMessages = messages.slice(0, splitIndex);
  const recentMessages = messages.slice(splitIndex);
  let preCompressionCheckpointId: string | undefined;

  log.info(`触发上下文压缩`, {
    eventType: "compaction.start",
    payload: {
      oldMessageCount: oldMessages.length,
      recentMessageCount: recentMessages.length,
      splitIndex,
      threshold: compactionConfig.tokenThreshold,
      tokensBefore,
    },
  });

  eventBus.publish(CompressEvents.CompressStarted, {
    percentage: getTokenPercentage(tokensBefore, modelId),
    sessionId: sessionId ?? "",
    tokenCount: tokensBefore,
  });

  // Compress Hook (before): 压缩前触发
  await hookExecutor.compress(sessionId ?? "", "before", tokensBefore);

  if (sessionId) {
    try {
      // 注: 使用动态 import 避免模块初始化阶段的静态循环依赖。
      // compressService.ts 中同类操作使用静态 import({ createCheckpoint } from "@/session")，
      // 因为 compressService 不在 conversation 模块内部，不存在循环依赖风险。
      const { createCheckpoint } = await import("@session");
      preCompressionCheckpointId = createCheckpoint(sessionId, "pre-compression").id;
    } catch (error) {
      log.debug(`压缩前 checkpoint 创建跳过: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 4. 通知 UI 压缩开始
  eventBus.publish(AppEvent.Toast, {
    message: "正在压缩对话上下文...",
    variant: "info",
  });

  // 5. 生成摘要（防御性 try-catch: generateSummary 内部已有 fallback，
  //    但 import("@api") 失败或序列化异常时仍可能抛出）
  let summary: string;
  try {
    summary = await generateSummary(config, oldMessages, compactionConfig);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error(`压缩摘要生成失败: ${errMsg}`, {
      durationMs: Date.now() - startTime,
      eventType: "compaction.summary-failed",
      payload: { error: errMsg, tokensBefore },
    });
    eventBus.publish(CompressEvents.CompressFailed, {
      error: errMsg,
      method: "ai-summary",
      sessionId: sessionId ?? "",
    });
    eventBus.publish(AppEvent.Toast, {
      message: `上下文压缩失败: ${errMsg}`,
      variant: "error",
    });
    // 确保 Hook after 被调用，维持 Hook 协议完整性
    await hookExecutor.compress(sessionId ?? "", "after", tokensBefore);
    result.durationMs = Date.now() - startTime;
    return result;
  }

  // 6. 构造压缩后的消息数组
  const summaryMessage: ModelMessage = {
    content: `[系统自动生成的对话摘要 — 以下是之前对话的压缩版]\n\n${summary}`,
    role: "user",
  };

  const ackMessage: ModelMessage = {
    content: "收到，我已了解之前的对话上下文摘要。请继续。",
    role: "assistant",
  };

  // 替换原数组内容
  messages.length = 0;
  messages.push(summaryMessage, ackMessage, ...recentMessages);

  // 注入活跃 Goal 目标（与 compactSession 路径保持一致），
  // 防止压缩后续接对话丢失 Goal 上下文。
  await injectGoalIfNeeded(sessionId, messages);

  const tokensAfter = estimateMessagesTokens(messages);
  const durationMs = Date.now() - startTime;

  result.compacted = true;
  result.messagesAfter = messages.length;
  result.tokensAfter = tokensAfter;
  result.summary = summary;
  result.durationMs = durationMs;

  // 7. 通知 UI 压缩完成
  eventBus.publish(AppEvent.Toast, {
    message: `上下文已压缩: ${tokensBefore} → ${tokensAfter} tokens (${Math.round((1 - tokensAfter / tokensBefore) * 100)}% 压缩率)`,
    variant: "success",
  });

  eventBus.publish(CompressEvents.CompressCompleted, {
    compressionRatio: `${Math.round((1 - tokensAfter / tokensBefore) * 100)}%`,
    method: "ai-summary",
    sessionId: sessionId ?? "",
    tokensAfter,
    tokensBefore,
  });

  log.info(`上下文压缩完成`, {
    durationMs,
    eventType: "compaction.done",
    payload: {
      compressionRatio: `${Math.round((1 - tokensAfter / tokensBefore) * 100)}%`,
      messagesAfter: result.messagesAfter,
      messagesBefore: result.messagesBefore,
      summaryLength: summary.length,
      tokensAfter,
      tokensBefore,
    },
    success: true,
  });

  // Compress Hook (after): 压缩后触发
  await hookExecutor.compress(sessionId ?? "", "after", tokensAfter);

  // 8. 保存分支点(用于跨会话回滚)
  const sid = sessionId ?? "default";
  const compactionIndex = compactionCounts.get(sid) ?? 0;
  compactionCounts.set(sid, compactionIndex + 1);

  // 自动清理：超过上限时移除最早的一半条目，防止内存泄漏
  if (compactionCounts.size > MAX_COMPACTION_COUNTS) {
    const entries = [...compactionCounts.entries()];
    const toRemove = entries.slice(0, Math.floor(MAX_COMPACTION_COUNTS / 2));
    for (const [key] of toRemove) {
      compactionCounts.delete(key);
    }
  }

  const branchPoint: CompactionBranchPoint = {
    afterState: {
      messages: [...messages],
      summary,
    },
    beforeState: {
      compressedMessages: cloneModelMessages(oldMessages),
      messages: preCompressionMessages,
      rollbackEntries: [],
      splitIndex,
    },
    compactionIndex,
    id: generateBranchPointId(sid, compactionIndex),
    metadata: {
      compressionRatio: tokensAfter / tokensBefore,
      originalSessionId: sid,
      preCompressionCheckpointId,
      totalTokensAfter: tokensAfter,
      totalTokensBefore: tokensBefore,
    },
    sessionId: sid,
    timestamp: Date.now(),
  };

  try {
    await saveBranchPoint(branchPoint);
    log.debug(`分支点已保存: ${branchPoint.id}`);
  } catch (error) {
    log.warn(`保存分支点失败: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (sessionId) {
    persistCompactedMessages(sessionId, messages);
  }

  return result;
}

function persistCompactedMessages(sessionId: string, messages: ModelMessage[]): void {
  deleteSessionMessages(sessionId);
  for (const message of messages) {
    addMessage(sessionId, message.role, modelMessageToParts(message));
  }
  log.info(`压缩后上下文已写回会话消息表`, {
    eventType: "compaction.persisted",
    payload: { messageCount: messages.length },
    sessionId,
  });
}

function cloneModelMessages(messages: ModelMessage[]): ModelMessage[] {
  return structuredClone(messages);
}

// ─── 工具输出截断 ──────────────────────────────────────────────

/**
 * 截断消息中大型工具输出。
 * 在每次 sendMessage 之后、压缩检查之前调用。
 * 不修改近期消息，只截断旧的工具结果。
 *
 * 注: 此函数用于压缩前的 head-only 截断预处理。压缩后保留区的
 * head+tail 精简截断见 core/compressor.ts → truncateOversizedToolResults。
 * 两者策略不同：本函数仅保留头部（适合预处理），truncateOversizedToolResults
 * 保留头尾（更适合压缩后保留区）。
 *
 * @param messages 消息数组
 * @param truncateLength 截断长度
 * @param keepRecent 保留最近 N 条消息不截断
 */
export function truncateToolOutputs(messages: ModelMessage[], truncateLength: number, keepRecent: number = 4): void {
  if (truncateLength <= 0) {
    return;
  }

  const startFrom = Math.max(0, messages.length - keepRecent);

  for (let i = 0; i < startFrom; i++) {
    const msg = messages[i]!;
    const { content } = msg;

    if (typeof content === "string") {
      continue;
    }
    if (!Array.isArray(content)) {
      continue;
    }

    let modified = false;
    const newParts = content.map((part) => {
      if (part == null || typeof part !== "object" || !("type" in part)) {
        return part;
      }
      if (part.type !== "tool-result") {
        return part;
      }

      const output = "output" in part ? part.output : undefined;
      if (output == null) {
        return part;
      }

      const outputStr = typeof output === "string" ? output : JSON.stringify(output);

      if (outputStr.length <= truncateLength) {
        return part;
      }

      modified = true;
      const truncated = `${outputStr.slice(0, truncateLength)}\n...[截断，原始长度 ${outputStr.length} 字符]`;

      if (
        output &&
        typeof output === "object" &&
        "type" in output &&
        typeof (output as { type?: unknown }).type === "string"
      ) {
        const typedOutput = output as { type: string; value?: unknown; providerOptions?: unknown };
        if (
          (typedOutput.type === "text" || typedOutput.type === "error-text") &&
          typeof typedOutput.value === "string"
        ) {
          return {
            ...part,
            output: {
              ...typedOutput,
              value: `${typedOutput.value.slice(0, truncateLength)}\n...[截断，原始长度 ${typedOutput.value.length} 字符]`,
            },
          };
        }

        const fallbackType = typedOutput.type === "error-json" ? "error-text" : "text";
        return {
          ...part,
          output: {
            type: fallbackType,
            value: truncated,
            ...(typedOutput.providerOptions ? { providerOptions: typedOutput.providerOptions } : {}),
          },
        };
      }

      return {
        ...part,
        output: truncated,
      };
    });

    if (modified) {
      Object.assign(msg, { content: newParts });
    }
  }
}

// ─── Goal 注入 ─────────────────────────────────────────────

/**
 * 注入活跃 Goal 目标到消息数组（与 compressService 路径保持一致）。
 * 使用动态 import 避免静态依赖 @/mission。
 * 注入失败不阻断压缩流程。
 */
async function injectGoalIfNeeded(sessionId: string | undefined, messages: ModelMessage[]): Promise<void> {
  if (!sessionId) return;
  try {
    const { goalManager } = await import("@/mission");
    const goal = goalManager.loadGoal(sessionId);
    if (goal && (goal.status === "pursuing" || goal.status === "paused" || goal.status === "budget-limited")) {
      messages.push({
        content: `[Goal 目标提醒] 当前活跃目标: "${goal.objective}" (status=${goal.status}, id=${goal.id})`,
        role: "system",
      });
    }
  } catch {
    // Goal 注入失败不影响压缩结果
  }
}

// ─── P3-13: 会话结束清理 API ───────────────────────────────────

/**
 * 清理指定会话的压缩计数器。
 * 应在会话被删除/归档时调用，避免 Map 长期持有已死会话的条目。
 *
 * @returns 是否清除了条目(false 表示会话无记录)
 */
export function clearCompactionCount(sessionId: string): boolean {
  return compactionCounts.delete(sessionId);
}

/**
 * 清理所有会话的压缩计数器。
 * 主要用于测试或应用关闭时全量重置。
 *
 * @returns 被清除的条目数
 */
export function clearAllCompactionCounts(): number {
  const { size } = compactionCounts;
  compactionCounts.clear();
  return size;
}

/**
 * 获取指定会话当前的压缩次数(用于诊断/调试)。
 */
export function getCompactionCount(sessionId: string): number {
  return compactionCounts.get(sessionId) ?? 0;
}

/**
 * 获取所有正在追踪压缩计数的会话 ID 数量(用于监控)。
 */
export function getTrackedCompactionSessionCount(): number {
  return compactionCounts.size;
}
