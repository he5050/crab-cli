/**
 * 子代理工具审批决策流 — 逐工具审批 + Hook 集成。
 *
 * 职责:
 *   - 逐工具审批子代理的工具调用请求
 *   - 支持 YOLO 透传和已批准列表检查
 *   - 集成 beforeToolCall / afterToolCall Hook
 *   - 处理用户确认和拒绝逻辑
 *   - 支持终止指令生成
 *
 * 模块功能:
 *   - checkAndApproveTools: 逐工具审批 + 决策流
 *   - executeApprovedToolsWithHooks: 执行已批准的工具调用
 *   - ToolCallRequest: 工具调用请求接口
 *   - ConfirmationResult: 用户确认结果类型
 *   - ApprovalResult: 审批结果接口
 *   - ApprovalContext: 审批上下文接口
 *
 * 使用场景:
 *   - 子代理执行工具调用前的权限检查
 *   - 需要用户确认敏感操作
 *   - 批量工具调用的审批管理
 *   - 工具执行前后的 Hook 处理
 *
 * 边界:
 *   1. 仅负责审批决策，不直接执行工具
 *   2. 支持 approve/reject/reject_with_reply/approve_always 四种决策
 *   3. reject 会终止子代理，reject_with_reply 仅拒绝当前工具
 *   4. 需要外部提供 requestToolConfirmation 回调函数
 *   5. Hook 执行失败不影响主流程
 *
 * 流程:
 *   1. 检查 YOLO 透传状态
 *   2. 检查会话已批准列表
 *   3. 请求用户确认(如需要)
 *   4. 根据确认结果决定 approve/reject/reject_with_reply
 *   5. reject → 生成终止指令并停止子代理
 *   6. reject_with_reply → 记录拒绝原因，继续其他工具
 *   7. approve_always → 加入会话批准列表
 *   8. 执行已批准工具时触发 beforeToolCall Hook
 *   9. 工具执行完成后触发 afterToolCall Hook
 */

import { unifiedHooksExecutor } from "@/hooks/unifiedHookExecutor";
import { interpretHookResult } from "@/hooks/hookStrategies";
import { isYoloPassthroughActive, shouldAutoApproveSubAgentTool } from "@/agent/runtime/yolo";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("agent:tool-approval");

const toolApprovalDeps = {
  interpretHookResult,
  isYoloPassthroughActive,
  shouldAutoApproveSubAgentTool,
  unifiedHooksExecutor,
};

export function __setToolApprovalDepsForTesting(overrides: Partial<typeof toolApprovalDeps>): void {
  Object.assign(toolApprovalDeps, overrides);
}

export function __resetToolApprovalDepsForTesting(): void {
  toolApprovalDeps.unifiedHooksExecutor = unifiedHooksExecutor;
  toolApprovalDeps.interpretHookResult = interpretHookResult;
  toolApprovalDeps.shouldAutoApproveSubAgentTool = shouldAutoApproveSubAgentTool;
  toolApprovalDeps.isYoloPassthroughActive = isYoloPassthroughActive;
}

// ─── 类型定义 ──────────────────────────────────────────────

/** 工具调用请求 */
export interface ToolCallRequest {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

/** 用户确认结果 */
export type ConfirmationResult =
  | "approve"
  | "approve_always"
  | "reject"
  | { type: "reject_with_reply"; reason?: string };

/** 审批结果 */
export interface ApprovalResult {
  /** 已通过审批的工具调用 */
  approvedToolCalls: ToolCallRequest[];
  /** True = 调用方应 continue 主循环(全部已处理，无需 MCP 执行) */
  shouldContinue: boolean;
  /** True = 子代理已被中止 */
  aborted: boolean;
}

/** 审批上下文 */
export interface ApprovalContext {
  /** 会话级已批准工具集合 */
  sessionApprovedTools: Set<string>;
  /** 请求用户确认回调 */
  requestToolConfirmation?: (toolName: string, args: Record<string, unknown>) => Promise<ConfirmationResult>;
  /** 是否自动批准(可自定义判断) */
  isToolAutoApproved?: (toolName: string) => boolean;
  /** 添加到永久批准列表 */
  addToAlwaysApproved?: (toolName: string) => void;
  /** 消息列表(用于追加工具结果) */
  messages: ApprovalChatMessage[];
  /** 终止指令收集器 */
  collectedTerminationInstructions: string[];
  /** AbortSignal */
  abortSignal?: AbortSignal;
  /** 子代理消息发射 */
  emitMessage?: (msg: { type: string; tool_call_id: string; tool_name: string; content: string }) => void;
}

/** 审批流程中的 ChatMessage 最小接口 */
export interface ApprovalChatMessage {
  role: string;
  tool_call_id?: string;
  content: string;
  [key: string]: unknown;
}

// ─── 审批入口 ──────────────────────────────────────────────

/**
 * 逐工具审批 + 决策流。
 *
 * 对每个工具调用:
 *   1. YOLO 透传检查
 *   2. 已批准列表检查
 *   3. 用户确认
 *   4. 根据确认结果决定 approve/reject/reject_with_reply
 *
 * reject → 立即终止子代理
 * reject_with_reply → 记录拒绝原因，继续其他工具
 * approve_always → 加入会话批准列表
 */
export async function checkAndApproveTools(
  ctx: ApprovalContext,
  toolCalls: ToolCallRequest[],
): Promise<ApprovalResult> {
  const approvedToolCalls: ToolCallRequest[] = [];
  const rejectedToolCalls: ToolCallRequest[] = [];
  const rejectionReasons = new Map<string, string>();
  let shouldStopAfterRejection = false;
  let stopRejectedToolName: string | undefined;
  let stopRejectionReason: string | undefined;

  for (const toolCall of toolCalls) {
    const toolName = toolCall.function.name;
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(toolCall.function.arguments);
    } catch (error) {
      // 工具参数非合法 JSON(常见于 LLM 幻觉/截断), 视为空对象处理.
      // 后续执行工具时通常会因参数缺失而失败, 暴露给用户.
      log.warn(`工具参数解析失败: ${toolCall.function.name}`, { error: String(error) });
      args = {};
    }

    // 1. YOLO 透传检查
    let needsConfirmation =
      !toolApprovalDeps.isYoloPassthroughActive() || !toolApprovalDeps.shouldAutoApproveSubAgentTool(toolName);

    // 2. 已批准列表检查
    if (ctx.sessionApprovedTools.has(toolName) || (ctx.isToolAutoApproved && ctx.isToolAutoApproved(toolName))) {
      needsConfirmation = false;
    }

    // 3. 用户确认
    if (needsConfirmation && ctx.requestToolConfirmation) {
      const confirmation = await ctx.requestToolConfirmation(toolName, args);

      if (
        confirmation === "reject" ||
        (typeof confirmation === "object" && confirmation.type === "reject_with_reply")
      ) {
        rejectedToolCalls.push(toolCall);

        if (typeof confirmation === "object" && confirmation.reason) {
          rejectionReasons.set(toolCall.id, confirmation.reason);
        }

        if (confirmation === "reject") {
          shouldStopAfterRejection = true;
          stopRejectedToolName = toolName;
          stopRejectionReason = rejectionReasons.get(toolCall.id);
          break;
        }
        continue;
      }

      if (confirmation === "approve_always") {
        ctx.sessionApprovedTools.add(toolName);
        if (ctx.addToAlwaysApproved) {
          ctx.addToAlwaysApproved(toolName);
        }
      }
    }

    approvedToolCalls.push(toolCall);
  }

  // ─── 处理拒绝 ─────────────────────────────────────────

  if (rejectedToolCalls.length > 0) {
    const handledToolIds = new Set([...approvedToolCalls.map((tc) => tc.id), ...rejectedToolCalls.map((tc) => tc.id)]);

    const cancelledToolCalls = shouldStopAfterRejection ? toolCalls.filter((tc) => !handledToolIds.has(tc.id)) : [];

    // 为每个被拒绝的工具生成结果消息
    for (const toolCall of rejectedToolCalls) {
      const rejectionReason = rejectionReasons.get(toolCall.id);
      const rejectMessage = rejectionReason ? `工具执行被用户拒绝: ${rejectionReason}` : "工具执行被用户拒绝";

      ctx.messages.push({
        content: `Error: ${rejectMessage}`,
        role: "tool",
        tool_call_id: toolCall.id,
      });

      if (ctx.emitMessage) {
        ctx.emitMessage({
          content: `Error: ${rejectMessage}`,
          tool_call_id: toolCall.id,
          tool_name: toolCall.function.name,
          type: "tool_result",
        });
      }
    }

    // Reject 模式:取消所有后续工具(包括已批准的)
    if (shouldStopAfterRejection) {
      const abortedApproved = [...approvedToolCalls];
      const cancelMessage = stopRejectedToolName
        ? `工具执行已取消:用户拒绝了工具 "${stopRejectedToolName}" 并请求子代理停止`
        : "工具执行已取消:用户请求子代理停止";

      for (const toolCall of [...abortedApproved, ...cancelledToolCalls]) {
        ctx.messages.push({
          content: `Error: ${cancelMessage}`,
          role: "tool",
          tool_call_id: toolCall.id,
        });

        if (ctx.emitMessage) {
          ctx.emitMessage({
            content: `Error: ${cancelMessage}`,
            tool_call_id: toolCall.id,
            tool_name: toolCall.function.name,
            type: "tool_result",
          });
        }
      }

      // 生成终止指令
      const stopInstruction = [
        `[System] 用户拒绝了工具 "${stopRejectedToolName || "unknown"}" 并要求停止。`,
        stopRejectionReason ? `[System] 拒绝原因: ${stopRejectionReason}` : undefined,
        "[System] 请勿调用任何更多工具。",
        "[System] 基于已有信息提供最终总结，明确指出因工具被拒绝而缺失的信息，然后结束工作。",
      ]
        .filter(Boolean)
        .join("\n");

      ctx.collectedTerminationInstructions.push(stopInstruction);
      ctx.messages.push({ content: stopInstruction, role: "user" });

      return { aborted: false, approvedToolCalls: [], shouldContinue: true };
    }

    // Reject_with_reply 模式:若无已批准工具，也返回 continue
    if (approvedToolCalls.length === 0) {
      return { aborted: false, approvedToolCalls: [], shouldContinue: true };
    }
  }

  return { aborted: false, approvedToolCalls, shouldContinue: false };
}

// ─── Hook 集成的工具执行 ──────────────────────────────────

/**
 * 执行已批准的工具调用，集成 beforeToolCall / afterToolCall Hook。
 *
 * 每个 hook 结果使用 interpretHookResult 解释:
 *   - block → 跳过工具执行，返回 hook 指定的内容
 *   - replace → 替换工具输出
 *   - pass → 正常返回
 */
export async function executeApprovedToolsWithHooks(
  ctx: ApprovalContext,
  approvedToolCalls: ToolCallRequest[],
  executeTool: (toolName: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>,
): Promise<{ aborted: boolean }> {
  const toolResults: ApprovalChatMessage[] = [];

  for (const toolCall of approvedToolCalls) {
    if (ctx.abortSignal?.aborted) {
      return { aborted: true };
    }

    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(toolCall.function.arguments);

      // ── beforeToolCall Hook ────────────────────────────
      try {
        const hookResult = await toolApprovalDeps.unifiedHooksExecutor.executeHooks("PreToolUse", {
          event: "PreToolUse",
          toolArgs: args,
          toolName: toolCall.function.name,
        });
        const interpreted = toolApprovalDeps.interpretHookResult("PreToolUse", hookResult.results, undefined);

        if (interpreted.action === "block") {
          const content = interpreted.replacedContent || "";
          toolResults.push({
            content,
            role: "tool",
            tool_call_id: toolCall.id,
          });
          if (ctx.emitMessage) {
            ctx.emitMessage({
              content,
              tool_call_id: toolCall.id,
              tool_name: toolCall.function.name,
              type: "tool_result",
            });
          }
          continue;
        }
      } catch (hookError) {
        log.warn("子代理 beforeToolCall Hook 执行失败", {
          payload: { error: String(hookError) },
        });
      }

      // ── 执行工具 ───────────────────────────────────────
      const result = await executeTool(toolCall.function.name, args, ctx.abortSignal);
      const resultContent = JSON.stringify(result);

      toolResults.push({
        content: resultContent,
        role: "tool",
        tool_call_id: toolCall.id,
      });

      if (ctx.emitMessage) {
        ctx.emitMessage({
          content: resultContent,
          tool_call_id: toolCall.id,
          tool_name: toolCall.function.name,
          type: "tool_result",
        });
      }

      // ── afterToolCall Hook ─────────────────────────────
      try {
        const afterHookResult = await toolApprovalDeps.unifiedHooksExecutor.executeHooks("PostToolUse", {
          event: "PostToolUse",
          toolArgs: args,
          toolName: toolCall.function.name,
          toolResult: { content: resultContent, role: "tool", tool_call_id: toolCall.id },
        });
        const afterInterpreted = toolApprovalDeps.interpretHookResult(
          "PostToolUse",
          afterHookResult.results,
          resultContent,
        );

        if (afterInterpreted.action === "replace") {
          const lastResult = toolResults[toolResults.length - 1];
          if (lastResult) {
            lastResult.content = afterInterpreted.replacedContent || lastResult.content;
          }
        }
      } catch (hookError) {
        log.warn("子代理 afterToolCall Hook 执行失败", {
          payload: { error: String(hookError) },
        });
      }
    } catch (error: unknown) {
      const errorContent = `Error: ${error instanceof Error ? error.message : "工具执行失败"}`;

      toolResults.push({
        content: errorContent,
        role: "tool",
        tool_call_id: toolCall.id,
      });

      if (ctx.emitMessage) {
        ctx.emitMessage({
          content: errorContent,
          tool_call_id: toolCall.id,
          tool_name: toolCall.function.name,
          type: "tool_result",
        });
      }

      // AfterToolCall Hook(错误路径)
      try {
        await toolApprovalDeps.unifiedHooksExecutor.executeHooks("PostToolUse", {
          event: "PostToolUse",
          isError: true,
          toolArgs: args,
          toolName: toolCall.function.name,
          toolResult: { content: errorContent, role: "tool", tool_call_id: toolCall.id },
        });
      } catch (hookError) {
        log.warn("子代理 afterToolCall Hook(错误路径)执行失败", {
          payload: { error: String(hookError) },
        });
      }
    }
  }

  ctx.messages.push(...toolResults);
  return { aborted: false };
}
