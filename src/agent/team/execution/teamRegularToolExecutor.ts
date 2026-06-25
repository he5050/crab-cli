/**
 * Team 常规工具执行模块 — 在队友上下文中执行真实工具调用。
 *
 * 职责:
 *   - 应用 allowedTools 白名单过滤
 *   - 触发钩子与 worktree 路径重写
 *   - 回填工具结果并通过 onMessage 回调上报
 *
 * 模块功能:
 *   - executeRegularToolCalls: 批量执行常规工具调用
 *   - RegularToolCall: 常规工具调用结构
 */
import type { ModelMessage } from "ai";
import { DEFAULT_CONFIG } from "@/config";
import { createLogger } from "@/core/logging/logger";
import { hookExecutor } from "@/hooks/hookExecutor";
import type { AppConfigSchema } from "@/schema/config";
import type { Teammate } from "../types";
import { ToolExecutor } from "@/tool/executor/toolExecutor";
import { createBaseToolContext } from "@/tool/executor/runtimeExec";
import { rewriteToolArgsForWorktree } from "../merge/teamWorktree";
import type { TeammateExecutionOptions } from "../mate/teamExecutorHelpers";
import { createToolResultMessage } from "@/conversation/message/messageFactories";

const log = createLogger("team:regular-tool-executor");

export interface RegularToolCall {
  toolName: string;
  toolCallId: string;
  args: unknown;
}

export interface ExecuteRegularToolCallsInput {
  calls: RegularToolCall[];
  mate: Teammate;
  messages: ModelMessage[];
  appConfig?: AppConfigSchema;
  autoApprove: boolean;
  abortSignal: AbortSignal;
  onMessage?: TeammateExecutionOptions["onMessage"];
}

function pushToolResultMessage(messages: ModelMessage[], call: RegularToolCall, value: string): void {
  messages.push(createToolResultMessage(call.toolCallId, call.toolName, { type: "text", value }));
}

function emitToolResult(input: ExecuteRegularToolCallsInput, call: RegularToolCall, content: string): void {
  input.onMessage?.({
    content,
    teammateId: input.mate.id,
    teammateName: input.mate.name,
    toolName: call.toolName,
    type: "tool_result",
  });
}

export async function executeRegularToolCalls(input: ExecuteRegularToolCallsInput): Promise<void> {
  const { calls, mate, messages, abortSignal } = input;

  for (const call of calls) {
    let toolArgs =
      typeof call.args === "object" && call.args !== null ? { ...(call.args as Record<string, unknown>) } : {};

    if (mate.allowedTools?.length && !mate.allowedTools.includes(call.toolName)) {
      const errMsg = `Error: 工具 ${call.toolName} 不在队友 ${mate.name} 的 allowedTools 白名单中。`;
      pushToolResultMessage(messages, call, errMsg);
      emitToolResult(input, call, errMsg);
      continue;
    }

    if (mate.worktreePath) {
      const rewriteResult = rewriteToolArgsForWorktree(call.toolName, toolArgs, mate.worktreePath);
      toolArgs = rewriteResult.args;
      if (rewriteResult.error) {
        const errMsg = `Error: ${rewriteResult.error}`;
        pushToolResultMessage(messages, call, errMsg);
        emitToolResult(input, call, errMsg);
        continue;
      }
    }

    const preHookResult = await hookExecutor.preToolUse(call.toolName, toolArgs, call.toolCallId);
    if (!preHookResult.allowed) {
      pushToolResultMessage(messages, call, `Hook 阻止: ${preHookResult.reason ?? "被 Hook 阻止"}`);
      continue;
    }

    const appConfig = input.appConfig ?? DEFAULT_CONFIG;
    const toolConfig = mate.permissions?.length
      ? { ...appConfig, permissions: [...mate.permissions, ...(appConfig.permissions ?? [])] }
      : appConfig;
    const toolExecutor = new ToolExecutor({
      askPermission: async () => input.autoApprove,
      getConfig: () => toolConfig,
      getToolContext: () => createBaseToolContext(mate.sessionId ?? "", abortSignal),
    });
    const execution = await toolExecutor.execute(call.toolName, toolArgs, { signal: abortSignal });
    const output = typeof execution.output === "string" ? execution.output : JSON.stringify(execution.output ?? "");
    const result = {
      error: execution.error,
      output: execution.success ? output : `Error: ${execution.error ?? output}`,
      success: execution.success,
    };

    await hookExecutor.postToolUse(call.toolName, result.output, !result.success, call.toolCallId);
    if (!result.success && result.error) {
      log.warn(`队友 ${mate.id} 工具 ${call.toolName} 执行失败: ${result.error}`);
    }

    pushToolResultMessage(messages, call, result.output);
    emitToolResult(input, call, result.output.slice(0, 500));
  }
}
