/**
 * Goal Ralph Loop 集成 — 续接提示词注入 + Token 累计。
 *
 * 从 conversationHandler.ts 提取的独立逻辑。
 * 依赖 goalManager(外部注入，便于测试)。
 */
import type { TokenUsage } from "../types/handler";

/** Goal 最小接口（避免强依赖 @/mission 的内部类型） */
interface GoalSnapshot {
  id?: string;
  status?: string;
  runCount?: number;
}
import { createLogger } from "@/core/logging/logger";

const log = createLogger("conversation:goal");

export interface GoalManagerAdapter {
  consumePendingContinuation(sessionId: string): string | null;
  accrueTokens(sessionId: string, totalTokens: number): { exceeded: boolean; goal: GoalSnapshot | null };
  loadGoal(sessionId: string): GoalSnapshot | null;
  pauseGoal(sessionId: string): void;
  markPendingContinuation(sessionId: string): void;
}

/**
 * 发送前:检查并注入 Goal 续接提示词。
 */
export function injectGoalContinuation(
  goalManager: GoalManagerAdapter,
  sessionId: string | undefined,
  content: string,
): string {
  if (!sessionId) {
    return content;
  }
  const continuationPrompt = goalManager.consumePendingContinuation(sessionId);
  if (!continuationPrompt) {
    return content;
  }
  log.info(`Goal Ralph Loop: 注入续接提示词`, { sessionId });
  return `${continuationPrompt}\n\n---\n\n${content}`;
}

/**
 * 发送后:累计 Token + 标记续接。
 *
 * @returns shouldContinue — 如果 true，调用方应立即再调用 sendMessage
 */
export function handleGoalPostTurn(
  goalManager: GoalManagerAdapter,
  sessionId: string | undefined,
  usage: TokenUsage | undefined,
  turnState: { hadToolCalls: boolean },
): { shouldContinue: boolean } {
  if (!sessionId || !usage) {
    return { shouldContinue: false };
  }

  const totalTokens = usage.inputTokens + usage.outputTokens;
  const { exceeded, goal } = goalManager.accrueTokens(sessionId, totalTokens);
  if (!goal) {
    return { shouldContinue: false };
  }

  if (exceeded) {
    goalManager.markPendingContinuation(sessionId);
    log.info(`Goal Ralph Loop: 预算耗尽，设置最终续接`, { sessionId });
    return { shouldContinue: true };
  }

  if (goal.status === "pursuing") {
    if (!turnState.hadToolCalls) {
      log.info(`Goal Ralph Loop: 当前回合无工具执行，停止自动续接`, { sessionId });
      return { shouldContinue: false };
    }
    goalManager.markPendingContinuation(sessionId);
    log.info(`Goal Ralph Loop: 标记续接`, { runCount: goal.runCount, sessionId });
    return { shouldContinue: true };
  }

  return { shouldContinue: false };
}

/**
 * 中止时暂停活跃 Goal。
 */
export function pauseGoalOnAbort(goalManager: GoalManagerAdapter, sessionId: string | undefined): void {
  if (!sessionId) {
    return;
  }
  const goal = goalManager.loadGoal(sessionId);
  if (goal && goal.status === "pursuing") {
    goalManager.pauseGoal(sessionId);
    log.info(`Goal ${goal.id} 已因用户中断暂停`);
  }
}
