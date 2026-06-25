/**
 * Team 待机等待模块 — 处理 wait-for-messages 工具调用的阻塞与恢复。
 *
 * 职责:
 *   - 监听队友消息事件并在收到时唤醒等待
 *   - 监听 abort 信号以提前退出等待
 *   - 将等待结果以工具结果形式回填消息流
 *
 * 模块功能:
 *   - handleWaitForMessages: 处理单次等待调用
 *   - waitForMessageOrAbort: 阻塞直到有消息或中断
 *   - StandbyResult: 等待结果枚举
 */
import type { ModelMessage, ToolResultPart } from "ai";
import { AppEvent } from "@/bus";
import { globalBus, type EventBus } from "@/bus";
import type { Teammate } from "../types";
import type { TeamTracker } from "../core/teamTracker";
import type { TeammateExecutionOptions } from "../mate/teamExecutorHelpers";
import { createMultiToolResultMessage } from "@/conversation/message/messageFactories";

export interface WaitForMessagesCall {
  toolCallId: string;
  args: unknown;
}

export type StandbyResult = "continue" | "return";

export interface HandleWaitForMessagesInput {
  waitCall: WaitForMessagesCall;
  mate: Teammate;
  tracker: TeamTracker;
  messages: ModelMessage[];
  abortSignal: AbortSignal;
  onMessage?: TeammateExecutionOptions["onMessage"];
}

function pushWaitToolResult(messages: ModelMessage[], waitCall: WaitForMessagesCall): void {
  const parts: ToolResultPart[] = [
    {
      output: { type: "text", value: "等待中..." },
      toolCallId: waitCall.toolCallId,
      toolName: "wait-for-messages",
      type: "tool-result",
    },
  ];
  messages.push(createMultiToolResultMessage(parts));
}

function waitForMessageOrAbort(
  tracker: TeamTracker,
  teammateId: string,
  abortSignal: AbortSignal,
  eventBus: EventBus = globalBus,
): Promise<void> {
  return new Promise<void>((resolve) => {
    if (abortSignal.aborted) {
      resolve();
      return;
    }

    if (tracker.hasPendingTeammateMessages(teammateId)) {
      resolve();
      return;
    }

    const cleanup = () => {
      unsubMessage();
      abortSignal.removeEventListener("abort", abortHandler);
    };

    const unsubMessage = eventBus.subscribe(AppEvent.TeamMateMessage, (ev) => {
      const isSelfToLeadEcho =
        ev.properties.teammateId === teammateId &&
        typeof ev.properties.message === "string" &&
        ev.properties.message.startsWith("[→lead]");

      if (ev.properties.teammateId === teammateId && !isSelfToLeadEcho) {
        cleanup();
        resolve();
      }
    });

    const abortHandler = () => {
      cleanup();
      resolve();
    };
    abortSignal.addEventListener("abort", abortHandler, { once: true });
  });
}

function getSummary(args: unknown): string {
  if (typeof args !== "object" || args === null) {
    return "工作完成。";
  }
  const { summary } = args as Record<string, string>;
  return summary ?? "工作完成。";
}

export async function handleWaitForMessages(input: HandleWaitForMessagesInput): Promise<StandbyResult> {
  const { waitCall, mate, tracker, messages, abortSignal } = input;
  const summary = getSummary(waitCall.args);

  tracker.setStandby(mate.id);
  tracker.sendMessageToLead(mate.id, `[Standby] ${mate.name} 已完成当前工作。摘要: ${summary}`);

  input.onMessage?.({
    content: summary,
    teammateId: mate.id,
    teammateName: mate.name,
    type: "standby",
  });

  pushWaitToolResult(messages, waitCall);

  tracker.dequeueTeammateMessages(mate.id);

  await waitForMessageOrAbort(tracker, mate.id, abortSignal);
  if (!tracker.get(mate.id)) {
    return "return";
  }
  tracker.clearStandby(mate.id);

  if (abortSignal.aborted) {
    if (tracker.get(mate.id)) {
      tracker.updateStatus(mate.id, "failed", { error: "执行被中止" });
    }
    return "return";
  }

  return "continue";
}
