import { AppEvent, type EventBus } from "@/bus";
import { createId } from "@/core/identity";
import { createLogger } from "@/core/logging/logger";
import type { GoalManagerAdapter } from "./goalIntegration";
import { handleGoalPostTurn, injectGoalContinuation, pauseGoalOnAbort } from "./goalIntegration";
import type { ProcessingGuard } from "../guard/processingGuard";
import type { ConversationResult, TokenUsage } from "../types/handler";
import type { LlmLoopResult } from "../types/loop";

const log = createLogger("conversation");

export interface PreparedConversationTurn {
  content: string;
  effectiveContent: string;
}

export interface ConversationTurnLifecycle {
  activeMcpToolChangeReminder?: string;
  turnId: string;
  turnStartTime: number;
}

export interface PrepareConversationTurnOptions {
  content: string;
  sessionId?: string;
  ensureSkillManagerInitialized: () => Promise<void>;
  injectExplicitCapabilities: (effectiveContent: string) => void;
  onUserMessage: (effectiveContent: string, sessionId?: string) => Promise<unknown>;
  appendUserMessage: (effectiveContent: string) => void;
  goalManager: GoalManagerAdapter;
}

export interface FinalizeConversationTurnOptions {
  eventBus: EventBus;
  goalManager: GoalManagerAdapter;
  lifecycle: ConversationTurnLifecycle;
  llmLoopResult: LlmLoopResult;
  sessionId?: string;
  afterLoop: () => Promise<void>;
  saveState: () => void;
}

export interface BusyConversationResult {
  error: string;
  ok: false;
  text: string;
  toolRounds: 0;
}

export function createAbortedConversationResult(): BusyConversationResult {
  return { error: "会话已中止", ok: false, text: "", toolRounds: 0 };
}

export function createBusyConversationResult(): BusyConversationResult {
  return { error: "上一轮对话尚未完成，请等待", ok: false, text: "", toolRounds: 0 };
}

export async function prepareConversationTurn(
  options: PrepareConversationTurnOptions,
): Promise<PreparedConversationTurn> {
  const effectiveContent = injectGoalContinuation(options.goalManager, options.sessionId, options.content);
  await options.ensureSkillManagerInitialized();
  options.injectExplicitCapabilities(effectiveContent);
  await options.onUserMessage(effectiveContent, options.sessionId);
  options.appendUserMessage(effectiveContent);
  return { content: options.content, effectiveContent };
}

export function beginConversationTurn(options: {
  consumeMcpToolChangeReminder: () => string | undefined;
  content: string;
  eventBus: EventBus;
  sessionId?: string;
}): ConversationTurnLifecycle {
  const activeMcpToolChangeReminder = options.consumeMcpToolChangeReminder();
  options.eventBus.publish(AppEvent.ConversationMessageSent, {
    content: options.content,
    role: "user",
    sessionId: options.sessionId,
  });

  const turnId = createId("trn");
  const turnStartTime = Date.now();
  log.info(`开始新对话轮次`, {
    eventType: "conversation.turn.start",
    payload: { inputLength: options.content.length },
    sessionId: options.sessionId,
    turnId,
  });

  return { activeMcpToolChangeReminder, turnId, turnStartTime };
}

export async function finalizeConversationTurn(options: FinalizeConversationTurnOptions): Promise<ConversationResult> {
  await options.afterLoop();

  publishConversationCompleted({
    eventBus: options.eventBus,
    error: options.llmLoopResult.error,
    ok: options.llmLoopResult.ok,
    sessionId: options.sessionId,
    textLength: options.llmLoopResult.text.length,
    toolRounds: options.llmLoopResult.toolRounds,
    turnStartTime: options.lifecycle.turnStartTime,
    usage: options.llmLoopResult.usage,
  });

  options.saveState();

  const goalResult = handleGoalPostTurn(options.goalManager, options.sessionId, options.llmLoopResult.usage, {
    hadToolCalls: options.llmLoopResult.hadToolCalls,
  });

  if (!options.llmLoopResult.ok && options.llmLoopResult.error === "执行被中止") {
    pauseGoalOnAbort(options.goalManager, options.sessionId);
    options.eventBus.publish(AppEvent.ConversationAborted, {
      reason: "用户中止",
      sessionId: options.sessionId,
    });
  }

  return {
    error: options.llmLoopResult.error,
    goalContinuation: goalResult.shouldContinue,
    ok: options.llmLoopResult.ok,
    reasoning: options.llmLoopResult.reasoning,
    text: options.llmLoopResult.text,
    toolRounds: options.llmLoopResult.toolRounds,
    usage: options.llmLoopResult.usage,
  };
}

export function publishConversationCompleted(options: {
  eventBus: EventBus;
  error?: string;
  ok: boolean;
  sessionId?: string;
  textLength: number;
  toolRounds: number;
  turnStartTime: number;
  usage?: TokenUsage;
}): void {
  const turnEndTime = Date.now();
  options.eventBus.publish(AppEvent.ConversationCompleted, {
    durationMs: turnEndTime - options.turnStartTime,
    error: options.error,
    ok: options.ok,
    sessionId: options.sessionId,
    textLength: options.textLength,
    toolRounds: options.toolRounds,
    usage: options.usage,
  });
}

export function cleanupConversationTurn(options: {
  clearActiveMcpToolChangeReminder: () => void;
  currentProcessingGeneration: number;
  processingGeneration: number;
  processingGuard: Pick<ProcessingGuard, "isBusy" | "release">;
}): void {
  options.clearActiveMcpToolChangeReminder();
  if (options.currentProcessingGeneration === options.processingGeneration && options.processingGuard.isBusy()) {
    options.processingGuard.release();
  }
}
