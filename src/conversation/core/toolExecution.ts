/**
 * 工具执行管线 — 单工具执行、批量编排、结果处理。
 *
 * 从 conversationHandler.ts 提取的工具执行相关逻辑。
 * 通过 HandlerContext 接口解耦对 ConversationHandler class 的直接依赖。
 */
import type { ModelMessage, ToolCallPart, ToolResultPart } from "ai";
import type { AppConfigSchema } from "@/schema/config";
import { getRegisteredTools } from "@/tool/registry/toolRegistry";
import { toolNameMatches } from "@/tool/registry/toolNameMatcher";
import { isSensitiveCall } from "@/tool/executor/toolExecutorSafety";
import type { ToolExecutor } from "@/tool/executor/toolExecutor";
import { truncateToolOutput } from "@/tool/result/truncate";
import type { PermissionManager } from "@/permission";
import type { ToolContext } from "@/tool/types";
import { globalBus, type EventBus } from "@/bus";
import { AppEvent } from "@/bus";
import { hookExecutor } from "@/hooks/hookExecutor";
import { executeToolCallRound } from "./toolCallLoop";
import { createLogger } from "@/core/logging/logger";
import { toToolResultOutput } from "../message/toolCallHelpers";
import type { ToolInterceptor, ToolInterceptorContext } from "../types/handler";
import { createMultiToolResultMessage, createPartsAssistantMessage } from "../message/messageFactories";

const log = createLogger("conversation:tool-exec");

// ─── 处理器上下文接口 ────────────────────────────────────────

/** 工具执行所需的最小上下文(从 ConversationHandler 提取) */
export interface HandlerContext {
  messages: ModelMessage[];
  sessionId?: string;
  config: AppConfigSchema;
  toolInterceptor?: ToolInterceptor;
  toolInterceptorContext?: ToolInterceptorContext;
  allowedTools?: string[];
  abortSignal?: AbortSignal;
  providerId?: string;
  modelId?: string;
  temperature?: number;
  topP?: number;
  streamFn: typeof import("@api").streamLlm;
  additionalToolSchemas?: Record<string, { description: string; inputSchema: unknown }>;
  getToolContext?: () => ToolContext;
  permissionManager: PermissionManager;
  toolExecutor: ToolExecutor;
  /** EventBus 实例(可选，默认使用全局单例) */
  eventBus?: EventBus;
}

// ─── 消息追加 ──────────────────────────────────────────────────

/** 追加 assistant 消息到对话历史。 */
export function appendAssistantMessage(
  messages: ModelMessage[],
  text: string,
  toolCalls: { toolName: string; toolCallId: string; args: unknown }[],
): void {
  const assistantParts: ({ type: "text"; text: string } | ToolCallPart)[] = [];
  if (text) {
    assistantParts.push({ text, type: "text" });
  }
  assistantParts.push(
    ...toolCalls.map((tc) => ({
      input: tc.args as Record<string, unknown>,
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
      type: "tool-call" as const,
    })),
  );
  messages.push(createPartsAssistantMessage(assistantParts));
}

/** 追加工具结果消息到对话历史。 */
export function appendToolResults(
  messages: ModelMessage[],
  toolResults: { toolCallId: string; toolName: string; output: unknown; isError: boolean }[],
): void {
  const toolParts: ToolResultPart[] = toolResults.map((tr) => ({
    output: toToolResultOutput(tr.output, tr.isError),
    toolCallId: tr.toolCallId,
    toolName: tr.toolName,
    type: "tool-result" as const,
  }));
  messages.push(createMultiToolResultMessage(toolParts));
}

// ─── 工具结果发布 ──────────────────────────────────────────────

/** 发布工具执行结果事件到 EventBus。 */
export function publishToolResult(
  properties: {
    sessionId?: string;
    tool: string;
    result: unknown;
    callId: string;
    success: boolean;
    truncated?: boolean;
    outputPath?: string;
  },
  eventBus: EventBus = globalBus,
): void {
  eventBus.publish(AppEvent.ToolResult, properties, { throttle: false });
}

/** 截断超长的工具执行结果。 */
export function truncateToolResult(
  toolName: string,
  result: unknown,
): { result: unknown; truncated: boolean; outputPath?: string } | undefined {
  if (typeof result === "string") {
    const truncated = truncateToolOutput(result);
    if (truncated.truncated) {
      log.info(`工具输出已截断: ${toolName}`, { outputPath: truncated.outputPath });
      return { outputPath: truncated.outputPath, result: truncated.content, truncated: true };
    }
  } else if (result && typeof result === "object" && "output" in result && typeof result.output === "string") {
    const obj = result as Record<string, unknown>;
    const truncated = truncateToolOutput(obj.output as string);
    if (truncated.truncated) {
      log.info(`工具输出已截断: ${toolName}`, { outputPath: truncated.outputPath });
      obj.output = truncated.content;
      return { outputPath: truncated.outputPath, result, truncated: true };
    }
  }
  return undefined;
}

// ─── executor 截断检测 ──────────────────────────────────────────

/**
 * 检测工具结果是否已被 executor 层 (toolExecutionCore.truncateByTokenLimit) 截断过。
 * executor 层截断后会附加 [TRUNCATED]、[... Output truncated: 或 "完整输出已保存到:" 标记。
 * 如果已被截断，conversation 层应跳过 truncateToolResult 避免双重截断。
 */
function isAlreadyTruncatedByExecutor(result: unknown): boolean {
  if (typeof result === "string") {
    return (
      result.includes("[TRUNCATED]") ||
      result.includes("[... Output truncated:") ||
      result.includes("完整输出已保存到:")
    );
  }
  return false;
}

// ─── 工具执行 ──────────────────────────────────────────────────

/**
 * 执行单个工具调用。先检查拦截器，再检查权限、doom loop，最后执行。
 */
export async function executeSingleTool(
  ctx: HandlerContext,
  tc: { toolName: string; toolCallId: string; args: unknown },
): Promise<{ toolCallId: string; toolName: string; output: unknown; isError: boolean }> {
  const eventBus = ctx.eventBus ?? globalBus;
  const _pt_ = (p: Parameters<typeof publishToolResult>[0]) => publishToolResult(p, eventBus);

  // ── 工具拦截器检查(优先于正常执行) ──
  if (ctx.toolInterceptor) {
    try {
      const interceptorResult = await ctx.toolInterceptor(
        tc.toolName,
        tc.toolCallId,
        tc.args,
        ctx.toolInterceptorContext ?? {},
      );
      if (interceptorResult.handled) {
        // P1-8 安全加固：即使拦截器已处理，仍检查敏感命令
        // 防止拦截器绕过 hard-deny 规则执行危险操作
        if (isSensitiveCall(tc.toolName, tc.args as Record<string, unknown>)) {
          log.warn(`拦截器处理但命中敏感命令检测: ${tc.toolName}`);
          _pt_({
            callId: tc.toolCallId,
            result: `工具 "${tc.toolName}" 被敏感命令检测拦截（拦截器无法绕过安全策略）`,
            sessionId: ctx.sessionId,
            success: false,
            tool: tc.toolName,
          });
          return {
            isError: true,
            output: `工具 "${tc.toolName}" 被敏感命令检测拦截`,
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
          };
        }
        log.debug(`工具被拦截器处理: ${tc.toolName}`);
        _pt_({
          callId: tc.toolCallId,
          result: interceptorResult.output,
          sessionId: ctx.sessionId,
          success: !interceptorResult.isError,
          tool: tc.toolName,
        });
        return {
          isError: interceptorResult.isError ?? false,
          output: interceptorResult.output,
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
        };
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      log.warn(`工具拦截器异常: ${tc.toolName}: ${errMsg}`);
    }
  }

  const registry = getRegisteredTools();
  const tool = registry[tc.toolName];
  if (!tool) {
    log.warn(`未知工具: ${tc.toolName}`);
    _pt_({
      callId: tc.toolCallId,
      result: { error: `未知工具: ${tc.toolName}` },
      sessionId: ctx.sessionId,
      success: false,
      tool: tc.toolName,
    });
    return {
      isError: true,
      output: { error: `未知工具: ${tc.toolName}` },
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
    };
  }

  // Agent 工具白名单检查
  if (ctx.allowedTools && !ctx.allowedTools.some((allowed) => toolNameMatches(tc.toolName, allowed))) {
    log.warn(`工具不在 Agent 白名单中: ${tc.toolName}`);
    _pt_({
      callId: tc.toolCallId,
      result: { error: `工具 ${tc.toolName} 不在当前 Agent 的可用工具列表中` },
      sessionId: ctx.sessionId,
      success: false,
      tool: tc.toolName,
    });
    return {
      isError: true,
      output: `Error: 工具 ${tc.toolName} 不在当前 Agent 的可用工具列表中`,
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
    };
  }

  // ToolConfirmation Hook
  const confirmHook = await hookExecutor.toolConfirmation(tc.toolName, tc.args, ctx.sessionId);
  if (!confirmHook.allowed) {
    log.warn(`工具调用被 ToolConfirmation Hook 阻止: ${tc.toolName}: ${confirmHook.reason}`);
    _pt_({
      callId: tc.toolCallId,
      result: { error: `ToolConfirmation Hook 阻止: ${confirmHook.reason ?? "未提供原因"}` },
      sessionId: ctx.sessionId,
      success: false,
      tool: tc.toolName,
    });
    return {
      isError: true,
      output: `Error: ToolConfirmation Hook 阻止: ${confirmHook.reason ?? "未提供原因"}`,
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
    };
  }

  // 注意:死循环检测已在 llmLoop.ts:executeToolCallsInternal 中统一执行，
  // 此处不再重复检测，避免双路径使用不同 DoomLoopState 导致行为不一致。

  // 执行工具
  log.debug(`开始执行工具: ${tc.toolName}`);
  try {
    const hookCheck = await hookExecutor.preToolUse(tc.toolName, tc.args, tc.toolCallId);
    if (!hookCheck.allowed) {
      const blockMsg = hookCheck.reason ?? "被 Hook 阻止";
      log.info(`工具调用被 Hook 阻止: ${tc.toolName}: ${blockMsg}`);
      _pt_({
        callId: tc.toolCallId,
        result: { error: `Hook 阻止: ${blockMsg}` },
        sessionId: ctx.sessionId,
        success: false,
        tool: tc.toolName,
      });
      return {
        isError: true,
        output: `Error: Hook 阻止: ${blockMsg}`,
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
      };
    }

    const executionResult = await ctx.toolExecutor.execute(tc.toolName, tc.args as Record<string, unknown>, {
      signal: ctx.abortSignal,
    });
    let result = executionResult.output;
    if (!executionResult.success) {
      const errorMsg = executionResult.error ?? `工具执行失败: ${tc.toolName}`;
      // 触发 OnError Hook(不阻塞流程)
      try {
        await hookExecutor.onError(errorMsg, {
          sessionId: ctx.sessionId,
          toolArgs: tc.args,
          toolName: tc.toolName,
          toolResult: result,
        });
      } catch (hookErr) {
        log.debug(`OnError Hook 执行异常: ${hookErr instanceof Error ? hookErr.message : String(hookErr)}`);
      }
      await hookExecutor.postToolUse(tc.toolName, result, true, tc.toolCallId);
      _pt_({
        callId: tc.toolCallId,
        result: { error: errorMsg },
        sessionId: ctx.sessionId,
        success: false,
        tool: tc.toolName,
      });
      return { isError: true, output: `Error: ${errorMsg}`, toolCallId: tc.toolCallId, toolName: tc.toolName };
    }

    const postHook = await hookExecutor.postToolUse(tc.toolName, result, false, tc.toolCallId);
    if (postHook.replaced !== undefined) {
      result = postHook.replaced;
    }

    // P2-3: 避免 executor 层 truncateByTokenLimit 已截断的输出被再次截断
    const alreadyTruncated = isAlreadyTruncatedByExecutor(result);
    const truncated = alreadyTruncated ? undefined : truncateToolResult(tc.toolName, result);
    if (truncated) {
      ({ result } = truncated);
    }

    _pt_({
      callId: tc.toolCallId,
      outputPath: truncated?.outputPath,
      result,
      sessionId: ctx.sessionId,
      success: true,
      tool: tc.toolName,
      truncated: truncated?.truncated ?? false,
    });

    return {
      isError: false,
      output: result,
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error(`工具执行失败: ${tc.toolName}: ${errorMsg}`);
    _pt_({
      callId: tc.toolCallId,
      result: { error: errorMsg },
      sessionId: ctx.sessionId,
      success: false,
      tool: tc.toolName,
    });
    return { isError: true, output: `Error: ${errorMsg}`, toolCallId: tc.toolCallId, toolName: tc.toolName };
  }
}

/**
 * 批量执行工具调用列表，收集结果。
 */
export async function executeToolCalls(
  ctx: HandlerContext,
  toolCalls: { toolName: string; toolCallId: string; args: unknown }[],
): Promise<{ toolCallId: string; toolName: string; output: unknown; isError: boolean }[]> {
  const eventBus = ctx.eventBus ?? globalBus;
  const _pt_ = (p: Parameters<typeof publishToolResult>[0]) => publishToolResult(p, eventBus);
  const { results } = await executeToolCallRound({
    abortSignal: ctx.abortSignal,
    executor: {
      execute: async (request) => {
        const result = await executeSingleTool(ctx, request);
        return result;
      },
    },
    onToolComplete: (result) => {
      if (result.output === "工具执行被用户中止") {
        _pt_({
          callId: result.toolCallId,
          result: { error: "工具执行被用户中止" },
          success: false,
          tool: result.toolName,
        });
      }
    },
    toolCalls: toolCalls.map((tc) => ({
      args: tc.args,
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
    })),
  });

  return results.map((result) => ({
    isError: result.isError,
    output: result.output,
    toolCallId: result.toolCallId,
    toolName: result.toolName,
  }));
}

// ─── 工具列表构建 ──────────────────────────────────────────────

// getToolsForLlm 已统一使用 conversationSessionState 版本，此处不再重复定义。
// getStreamTimeout 已由 ConversationHandler 私有方法实现，此处不再重复定义。
