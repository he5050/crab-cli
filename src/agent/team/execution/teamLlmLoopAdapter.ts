/**
 * Team LLM 循环适配模块 — 在队友上下文中复用通用 LLM 循环。
 *
 * 职责:
 *   - 拼装队友可用的合成 + 常规工具集合
 *   - 注入 wait-for-messages 提示
 *   - 转发工具执行结果到全局事件总线
 *
 * 模块功能:
 *   - runTeamLlmLoop: 启动单次队友 LLM 循环
 *   - RunTeamLlmLoopInput: 循环输入参数
 */
import type { ModelMessage } from "ai";
import { globalBus, type EventBus } from "@/bus";
import { AppEvent } from "@/bus";
import {
  type ToolExecutor as LoopToolExecutor,
  type ToolExecutionResult,
  executeLlmLoop,
} from "@/conversation/core/llmLoop";
import { SubAgentCompressor } from "@/compress";
import type { AppConfigSchema } from "@/schema/config";
import type { TeamTaskList } from "../core/teamTaskList";
import type { TeamTracker } from "../core/teamTracker";
import type { TeamConfig, Teammate } from "../types";
import { getToolsForAiSdk, getToolsForAiSdkByNames } from "@/tool/registry/toolRegistry";
import { type TeammateExecutionOptions, buildSyntheticTools } from "../mate/teamExecutorHelpers";
import {
  PLAN_APPROVAL_BLOCK_MESSAGE,
  appendIncomingTeammateMessages,
  isPlanApprovalBlockedTool,
} from "../execution/teamLoopMessages";
import { executeRegularToolCalls } from "../execution/teamRegularToolExecutor";
import { executeSyntheticToolCalls } from "../execution/teamSyntheticToolExecutor";
import { handleWaitForMessages } from "../execution/teamStandbyHandler";

const TEAM_TOOL_CALL_HINT =
  "[System] 你的工作似乎已完成，但你没有调用 `wait-for-messages`。你必须调用 `wait-for-messages` 并提供工作摘要，而不是直接结束。这让你保持可用，以便 lead 或其他队友发送后续指令。";

export interface RunTeamLlmLoopInput {
  mate: Teammate;
  initialPrompt: string;
  abortSignal: AbortSignal;
  options: TeammateExecutionOptions;
  appConfig: AppConfigSchema;
  teamConfig: TeamConfig;
  tracker: TeamTracker;
  taskList: TeamTaskList;
  systemPrompt: () => string;
  streamFn: typeof import("@api").streamLlm;
  markTeammateFailedIfTracked: (teammateId: string, error: string) => void;
}

function extractToolResultValue(messages: ModelMessage[], fallback = ""): string {
  const last = messages[messages.length - 1];
  const content = Array.isArray(last?.content) ? last.content : [];
  for (const part of content) {
    if (typeof part !== "object" || part === null || !("output" in part)) {
      continue;
    }
    const { output } = part as { output?: unknown };
    if (typeof output === "string") {
      return output;
    }
    if (typeof output === "object" && output !== null && "value" in output) {
      const { value } = output as { value?: unknown };
      if (typeof value === "string") {
        return value;
      }
      return JSON.stringify(value ?? "");
    }
    return JSON.stringify(output ?? "");
  }
  return fallback;
}

function resultFromToolValue(value: string): ToolExecutionResult {
  const isError = value.startsWith("Error: ");
  return {
    error: isError ? value.slice("Error: ".length) : undefined,
    output: isError ? value.slice("Error: ".length) : value,
    success: !isError,
  };
}

class TeamLoopToolExecutor implements LoopToolExecutor {
  private readonly eventBus: EventBus;

  constructor(
    private readonly input: RunTeamLlmLoopInput,
    eventBus: EventBus = globalBus,
  ) {
    this.eventBus = eventBus;
  }

  async execute(
    toolName: string,
    args: unknown,
    context: { messages: ModelMessage[]; abortSignal?: AbortSignal; toolCallId?: string },
  ): Promise<ToolExecutionResult> {
    const toolCallId = context.toolCallId ?? `${toolName}-call`;
    const call = { args, toolCallId, toolName };
    const scratchMessages: ModelMessage[] = [];

    if (toolName === "wait-for-messages" || toolName === "waitForMessages") {
      const standbyResult = await handleWaitForMessages({
        abortSignal: context.abortSignal ?? this.input.abortSignal,
        mate: this.input.mate,
        messages: scratchMessages,
        onMessage: this.input.options.onMessage,
        tracker: this.input.tracker,
        waitCall: call,
      });
      return resultFromToolValue(extractToolResultValue(scratchMessages, "等待中..."));
    }

    if (
      toolName === "message_teammate" ||
      toolName === "claim_task" ||
      toolName === "complete_task" ||
      toolName === "list_team_tasks" ||
      toolName === "request_plan_approval"
    ) {
      await executeSyntheticToolCalls({
        calls: [call],
        mate: this.input.mate,
        messages: scratchMessages,
        onMessage: this.input.options.onMessage,
        taskList: this.input.taskList,
        tracker: this.input.tracker,
      });
      return resultFromToolValue(extractToolResultValue(scratchMessages));
    }

    if (this.input.options.requirePlanApproval && !this.isPlanApproved() && isPlanApprovalBlockedTool(toolName)) {
      this.input.options.onMessage?.({
        content: PLAN_APPROVAL_BLOCK_MESSAGE,
        teammateId: this.input.mate.id,
        teammateName: this.input.mate.name,
        toolName,
        type: "tool_result",
      });
      return { output: PLAN_APPROVAL_BLOCK_MESSAGE, success: true };
    }

    await executeRegularToolCalls({
      abortSignal: context.abortSignal ?? this.input.abortSignal,
      appConfig: this.input.options.appConfig ?? this.input.appConfig,
      autoApprove: this.input.teamConfig.autoApprove,
      calls: [call],
      mate: this.input.mate,
      messages: scratchMessages,
      onMessage: this.input.options.onMessage,
    });

    return resultFromToolValue(extractToolResultValue(scratchMessages));
  }

  private isPlanApproved(): boolean {
    if (!this.input.options.requirePlanApproval) {
      return true;
    }
    return this.input.tracker.getLatestPlanApprovalStatus(this.input.mate.id) === "approved";
  }
}

export async function runTeamLlmLoop(
  input: RunTeamLlmLoopInput,
  eventBus: EventBus = globalBus,
): Promise<{
  ok: boolean;
  text: string;
  error?: string;
  maxRoundsReached: boolean;
}> {
  const syntheticTools = buildSyntheticTools(input.options.requirePlanApproval ?? false);
  const globalTools = input.mate.allowedTools?.length
    ? getToolsForAiSdkByNames(input.mate.allowedTools)
    : getToolsForAiSdk();
  const tools = { ...globalTools, ...syntheticTools };
  const messages: ModelMessage[] = [{ content: input.initialPrompt, role: "user" }];
  const compressor = new SubAgentCompressor();

  const result = await executeLlmLoop(
    messages,
    {
      abortSignal: input.abortSignal,
      doomLoopThreshold: input.teamConfig.doomLoopThreshold,
      getSystem: () => {
        const incomingMessages = input.tracker.dequeueTeammateMessages(input.mate.id);
        appendIncomingTeammateMessages(messages, incomingMessages);
        input.options.onMessage?.({
          status: "thinking",
          teammateId: input.mate.id,
          teammateName: input.mate.name,
          type: "status",
        });
        return input.systemPrompt();
      },
      maxRounds: 50,
      modelId: input.mate.model,
      requireToolCallHint: true,
      sessionId: input.mate.sessionId,
      streamFn: input.streamFn,
      system: input.systemPrompt(),
      temperature: 0,
      toolCallHintMessage: TEAM_TOOL_CALL_HINT,
      tools,
    },
    new TeamLoopToolExecutor(input),
    {
      onDoomLoop: (_call, message) => {
        eventBus.publish(AppEvent.Toast, {
          message: `⚠ ${input.mate.name}: ${message}，已自动中断`,
          variant: "warning",
        });
        input.markTeammateFailedIfTracked(input.mate.id, message);
        input.options.onMessage?.({
          content: message,
          teammateId: input.mate.id,
          teammateName: input.mate.name,
          type: "error",
        });
        return "abort";
      },
      onError: (error) => {
        input.options.onMessage?.({
          content: error.message,
          teammateId: input.mate.id,
          teammateName: input.mate.name,
          type: "error",
        });
      },
      onTextDelta: (text) => {
        input.options.onMessage?.({
          content: text,
          teammateId: input.mate.id,
          teammateName: input.mate.name,
          type: "content",
        });
      },
      onToolCall: (call) => {
        input.options.onMessage?.({
          teammateId: input.mate.id,
          teammateName: input.mate.name,
          toolArgs: call.args as Record<string, unknown>,
          toolName: call.toolName,
          type: "tool_call",
        });
      },
    },
    input.appConfig,
    {
      compress: async (loopMessages, appConfig, modelId, sessionId) => {
        input.options.onMessage?.({
          status: "compressing",
          teammateId: input.mate.id,
          teammateName: input.mate.name,
          type: "status",
        });
        const result = await compressor.compress(
          loopMessages,
          appConfig,
          input.mate.model ?? modelId,
          input.mate.sessionId ?? sessionId,
        );
        return {
          afterTokensEstimate: result.afterTokensEstimate ?? 0,
          beforeTokens: result.beforeTokens ?? 0,
          compressed: result.compressed,
          messages: result.messages,
        };
      },
    },
  );

  return {
    error: result.error,
    maxRoundsReached: result.error?.includes("达到最大工具调用轮次") ?? false,
    ok: result.ok,
    text: result.text,
  };
}
