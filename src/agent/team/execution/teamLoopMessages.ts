/**
 * Team Loop 消息处理模块 — 队友消息追加、拆分与组装。
 *
 * 职责:
 *   - 接收外部队友消息并拼接到 ModelMessage 流
 *   - 拆分合成工具调用与常规工具调用
 *   - 提供 plan approval 阻断消息常量
 *
 * 模块功能:
 *   - appendIncomingTeammateMessages: 追加队友消息
 *   - appendAssistantResponseMessage: 追加助手回复
 *   - splitTeamToolCalls: 拆分合成/常规工具调用
 *   - PLAN_APPROVAL_BLOCK_MESSAGE: plan approval 阻断提示
 */
import type { AssistantModelMessage, ModelMessage, ToolModelMessage, ToolResultPart } from "ai";
import type { Teammate } from "../types";
import type { TeammateMessage } from "../core/teamTracker";
import { SYNTHETIC_TOOL_NAMES, type TeammateExecutionOptions } from "../mate/teamExecutorHelpers";
import { classifyMcpToolRisk } from "@/mcp/tool/riskClassification";
import { getRegisteredTools } from "@/tool/registry/toolRegistry";
import { createMultiToolResultMessage, createPartsAssistantMessage } from "@/conversation/message/messageFactories";

export interface TeamToolCall {
  toolName: string;
  toolCallId: string;
  args: unknown;
}

export interface SplitTeamToolCallsResult {
  syntheticCalls: TeamToolCall[];
  regularCalls: TeamToolCall[];
  waitCall?: TeamToolCall;
  otherSyntheticCalls: TeamToolCall[];
}

const PLAN_APPROVAL_BLOCKED_PERMISSIONS = new Set(["fs.write", "fs.edit", "bash", "git"]);

const PLAN_APPROVAL_COMMAND_TOOL_PATTERN = /^(bash|shell|terminal|exec|execute|command|run)([-_]|$)/i;
const PLAN_APPROVAL_MUTATION_TOOL_PATTERN = /^(write|create|update|modify|delete|remove|edit)([-_]|$)/i;

export const PLAN_APPROVAL_BLOCK_MESSAGE =
  "Error: 需要先通过 plan approval 才能修改文件。请先使用 request_plan_approval。";

export function appendIncomingTeammateMessages(messages: ModelMessage[], incomingMessages: TeammateMessage[]): void {
  for (const msg of incomingMessages) {
    messages.push({
      content: `[来自 ${msg.fromName} 的消息]\n${msg.content}`,
      role: "user",
    });
  }
}

export function appendAssistantResponseMessage(
  messages: ModelMessage[],
  text: string,
  toolCalls: TeamToolCall[],
): void {
  if (!text && toolCalls.length === 0) {
    return;
  }

  const assistantParts: (
    | { type: "text"; text: string }
    | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
  )[] = [];
  if (text) {
    assistantParts.push({ text, type: "text" });
  }
  for (const tc of toolCalls) {
    assistantParts.push({
      input: tc.args,
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
      type: "tool-call",
    });
  }
  messages.push(
    createPartsAssistantMessage(
      assistantParts.length === 1 && assistantParts[0]!.type === "text" ? text : assistantParts,
    ),
  );
}

export function appendMissingWaitForMessagesReminder(messages: ModelMessage[]): void {
  messages.push({
    content:
      "[System] 你的工作似乎已完成，但你没有调用 `wait-for-messages`。你必须调用 `wait-for-messages` 并提供工作摘要，而不是直接结束。这让你保持可用，以便 lead 或其他队友发送后续指令。",
    role: "user",
  });
}

export function splitTeamToolCalls(toolCalls: TeamToolCall[]): SplitTeamToolCallsResult {
  const syntheticCalls = toolCalls.filter((tc) => SYNTHETIC_TOOL_NAMES.has(tc.toolName));
  const regularCalls = toolCalls.filter((tc) => !SYNTHETIC_TOOL_NAMES.has(tc.toolName));
  const waitCall = syntheticCalls.find(
    (tc) => tc.toolName === "wait-for-messages" || tc.toolName === "waitForMessages",
  );
  const otherSyntheticCalls = syntheticCalls.filter(
    (tc) => tc.toolName !== "wait-for-messages" && tc.toolName !== "waitForMessages",
  );

  return {
    otherSyntheticCalls,
    regularCalls,
    syntheticCalls,
    waitCall,
  };
}

export function isPlanApprovalBlockedTool(toolName: string): boolean {
  const registeredTool = getRegisteredTools()[toolName];
  const permission = registeredTool?.permission;
  if (permission) {
    if (PLAN_APPROVAL_BLOCKED_PERMISSIONS.has(permission)) {
      return true;
    }
    if (permission === "mcp.sensitive" || permission.startsWith("mcp.sensitive.")) {
      return true;
    }
    if (permission.startsWith("mcp.")) {
      const mcpToolName = permission.split(".").at(-1) ?? toolName;
      const risk = classifyMcpToolRisk(mcpToolName);
      return risk === "high" || risk === "medium";
    }
  }

  if (PLAN_APPROVAL_COMMAND_TOOL_PATTERN.test(toolName)) {
    return true;
  }
  return PLAN_APPROVAL_MUTATION_TOOL_PATTERN.test(toolName);
}

export function appendPlanApprovalBlockedToolResults(input: {
  messages: ModelMessage[];
  calls: TeamToolCall[];
  mate: Teammate;
  onMessage?: TeammateExecutionOptions["onMessage"];
}): TeamToolCall[] {
  const blockedTools = input.calls.filter((tc) => isPlanApprovalBlockedTool(tc.toolName));

  for (const tc of blockedTools) {
    const parts: ToolResultPart[] = [
      {
        output: { type: "text", value: PLAN_APPROVAL_BLOCK_MESSAGE },
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        type: "tool-result" as const,
      },
    ];
    input.messages.push(createMultiToolResultMessage(parts));
    input.onMessage?.({
      content: PLAN_APPROVAL_BLOCK_MESSAGE,
      teammateId: input.mate.id,
      teammateName: input.mate.name,
      toolName: tc.toolName,
      type: "tool_result",
    });
  }

  return input.calls.filter((tc) => !blockedTools.includes(tc));
}
