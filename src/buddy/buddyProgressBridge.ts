/**
 * Buddy 对话进度桥接 — 订阅 EventBus 事件，驱动宠物 AI 反应
 *
 * 订阅已有 EventBus 事件（不修改核心对话代码）：
 *   ChatReasoning          → thinking_started
 *   ConversationStreamToken → answer_started
 *   ToolCall               → tool_calls_ready
 *   ToolResult             → tool_results_ready
 *   ConversationCompleted  → post-turn context reply
 *
 * 独立于核心对话系统，可选启用/销毁。
 */

import type { EventBus } from "@/bus";
import { AppEvent } from "@/bus";
import { getCompanion, isCompanionMuted } from "./companion";
import { companionReaction } from "./events";
import {
  shouldGenerateBuddyInProgressReply,
  generateBuddyInProgressReply,
  generateBuddyContextReply,
  type BuddyMessage,
  type BuddyInProgressStage,
} from "./buddyAi";

// ─── 常量 ──────────────────────────────────────────────────────

/** 两次反应之间最小间隔（ms），避免刷屏 */
const REACTION_COOLDOWN_MS = 4_000;

// ─── 桥接状态 ──────────────────────────────────────────────────

interface BridgeState {
  active: boolean;
  currentStage: BuddyInProgressStage | null;
  lastReactionAt: number;
}

// ─── 工厂函数 ──────────────────────────────────────────────────

export interface BuddyProgressBridge {
  /** 桥接实例销毁（取消所有订阅） */
  destroy: () => void;
}

/**
 * 创建 Buddy 对话进度桥接。
 *
 * @param eventBus - 全局 EventBus
 * @param getMessages - 获取当前对话消息的回调（桥接需要时读取）
 */
export function createBuddyProgressBridge(eventBus: EventBus, getMessages: () => BuddyMessage[]): BuddyProgressBridge {
  const state: BridgeState = {
    active: false,
    currentStage: null,
    lastReactionAt: 0,
  };
  const unsubs: Array<() => void> = [];

  // ─── 内部处理 ────────────────────────────────────────────

  function isActive(): boolean {
    return state.active && Boolean(getCompanion()) && !isCompanionMuted();
  }

  async function handleStage(stage: BuddyInProgressStage): Promise<void> {
    if (!isActive()) return;
    // 同一阶段不重复触发
    if (state.currentStage === stage) return;
    // 冷却时间
    const now = Date.now();
    if (now - state.lastReactionAt < REACTION_COOLDOWN_MS) return;

    state.currentStage = stage;

    const companion = getCompanion()!;
    const context = {
      stage,
      conversationMessages: getMessages(),
    };

    if (shouldGenerateBuddyInProgressReply(companion, context)) {
      state.lastReactionAt = now;
      const reply = await generateBuddyInProgressReply(companion, context);
      if (reply) {
        companionReaction(reply);
      }
    }
  }

  async function handleTurnComplete(): Promise<void> {
    const companion = getCompanion();
    if (!companion || isCompanionMuted()) {
      state.active = false;
      return;
    }

    const messages = getMessages();
    if (messages.length === 0) {
      state.active = false;
      return;
    }

    const now = Date.now();
    if (now - state.lastReactionAt < REACTION_COOLDOWN_MS) {
      state.active = false;
      return;
    }

    state.lastReactionAt = now;
    const reply = await generateBuddyContextReply(companion, messages);
    if (reply) {
      companionReaction(reply);
    }

    state.active = false;
  }

  function handleTurnAbort(): void {
    state.active = false;
    state.currentStage = null;
  }

  // ─── 订阅 EventBus ───────────────────────────────────────

  // 对话开始 → 激活桥接
  unsubs.push(
    eventBus.subscribe(AppEvent.ConversationMessageSent, () => {
      state.active = true;
      state.currentStage = null;
    }),
  );

  // 思考开始
  unsubs.push(
    eventBus.subscribe(AppEvent.ChatReasoning, () => {
      void handleStage("thinking_started");
    }),
  );

  // 文本流开始
  unsubs.push(
    eventBus.subscribe(AppEvent.ConversationStreamToken, () => {
      void handleStage("answer_started");
    }),
  );

  // 工具调用就绪
  unsubs.push(
    eventBus.subscribe(AppEvent.ToolCall, () => {
      void handleStage("tool_calls_ready");
    }),
  );

  // 工具执行结果
  unsubs.push(
    eventBus.subscribe(AppEvent.ToolResult, () => {
      void handleStage("tool_results_ready");
    }),
  );

  // 对话完成 → post-turn 上下文反应 + 停用桥接
  unsubs.push(
    eventBus.subscribe(AppEvent.ConversationCompleted, () => {
      void handleTurnComplete();
    }),
  );

  // 对话中止 → 停用桥接
  unsubs.push(
    eventBus.subscribe(AppEvent.ConversationAborted, () => {
      handleTurnAbort();
    }),
  );

  return {
    destroy: () => {
      state.active = false;
      state.currentStage = null;
      unsubs.forEach((unsub) => unsub());
    },
  };
}
