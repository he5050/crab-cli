/**
 * LLM 执行循环 — 可复用的 LLM 消息循环编排逻辑
 *
 * 职责:
 *   - 提供统一的 LLM 流式调用接口
 *   - 管理消息历史和对话状态
 *   - 处理工具调用分类和执行
 *   - 流式事件分发
 *   - 中止信号处理
 *
 * 模块功能:
 *   - 标准化的 LLM 循环执行流程
 *   - 消息历史自动管理
 *   - 工具调用拦截和执行
 *   - 流式事件回调处理
 *   - Token 使用统计
 *
 * 使用场景:
 *   - ConversationHandler 主对话循环
 *   - TeamExecutor 队友执行循环
 *   - 任何需要 LLM 流式调用的场景
 *
 * 边界:
 *   1. 依赖外部提供 ToolExecutor 执行工具
 *   2. 不处理具体的工具调用逻辑，只编排流程
 *   3. 不管理压缩逻辑，由外部决定何时压缩
 *
 * 流程:
 *   1. 初始化循环状态和消息历史
 *   2. 循环调用 LLM 流式 API
 *   3. 处理流式事件(text-delta, tool-call, error)
 *   4. 分类处理工具调用(合成/常规)
 *   5. 执行工具并追加结果
 *   6. 检查中止信号和循环终止条件
 *   7. 返回循环结果
 */
import type { ModelMessage, Tool, ToolResultPart } from "ai";
import type { AppConfigSchema } from "@/schema/config";
import { type LlmTokenUsage, streamLlm } from "@/api";
import { accumulateUsageDecimal } from "@/api/core/cost";
import { llmTokenUsageToTokenUsage } from "@/core/token";
import { estimateMessagesTokens, truncateToolOutputs } from "@/compress/conversation";
import { type DoomLoopState, createDoomLoopState } from "../guard/doomLoop";
import { checkDoomLoop } from "../guard/doomLoopPolicy";
import { createMultiToolResultMessage, createPartsAssistantMessage } from "../message/messageFactories";
import type { TokenUsage } from "../types/handler";
import { normalizeToolCallArgs, toToolResultOutput } from "../message/toolCallHelpers";
import { createId } from "@/core/identity";
import { createLogger } from "@/core/logging/logger";
import { globalBus, type EventBus } from "@/bus";
import { AppEvent } from "@/bus";
import { DEFAULT_MAX_TOOL_ROUNDS } from "@/config";
import { createIdleTimeoutGuard } from "../stream/idleTimeoutGuard";
import { recordChatBusinessTelemetry } from "@monitor";
import { executeLlmLoopWithStream } from "./llmStreamAdapter";
import type {
  LlmLoopCallbacks,
  LlmLoopOptions,
  LlmLoopResult,
  MessageCompressor,
  ToolCallItem,
  ToolExecutor,
} from "../types/loop";
import { trackSnapshot } from "@/session/core/snapshot";

const log = createLogger("llm:loop");

export type {
  LlmLoopCallbacks,
  LlmLoopOptions,
  LlmLoopResult,
  MessageCompressor,
  StreamEvent,
  StreamEventType,
  ToolCallItem,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolExecutor,
} from "../types/loop";

// ─── LLM 执行循环 ────────────────────────────────────────────

/**
 * 执行 LLM 消息循环
 *
 * @param messages 消息历史(会被修改)
 * @param loopOptions 循环选项
 * @param toolExecutor 工具执行器
 * @param callbacks 回调接口
 * @param config 应用配置
 * @param compressor 消息压缩器(可选)
 * @returns 循环结果
 */
export async function executeLlmLoop(
  messages: ModelMessage[],
  loopOptions: LlmLoopOptions,
  toolExecutor: ToolExecutor,
  callbacks: LlmLoopCallbacks,
  config: AppConfigSchema,
  compressor?: MessageCompressor,
): Promise<LlmLoopResult> {
  // P2-A6: 根据 useEffectStream 配置选择执行路径
  if (config.useEffectStream) {
    return executeLlmLoopWithStream(messages, loopOptions, toolExecutor, callbacks, config, compressor);
  }

  const {
    system,
    maxRounds = DEFAULT_MAX_TOOL_ROUNDS,
    abortSignal,
    providerId,
    modelId,
    temperature,
    topP,
    timeout,
    doomLoopThreshold,
    streamFn = streamLlm,
    eventBus = globalBus,
  } = loopOptions;

  // 初始化状态
  const responseParts: string[] = [];
  const reasoningParts: string[] = [];
  let totalUsage: TokenUsage | undefined;
  let hadToolCalls = false;
  let prevRoundText = "";
  const doomLoopState = createDoomLoopState();
  const turnId = createId("trn");

  const accumulateUsage = (usage: LlmTokenUsage) => {
    totalUsage = accumulateUsageDecimal(totalUsage, llmTokenUsageToTokenUsage(usage));
  };

  log.info(`开始 LLM 循环`, {
    eventType: "llm.loop.start",
    payload: { maxRounds, modelId, providerId },
    turnId,
  });

  // OTel: 父 span
  const { getTracer } = await import("@/monitor/telemetry/telemetry");
  const tracer = getTracer();
  const loopSpan = tracer.startSpan("llm.loop", {
    attributes: {
      "llm.max_rounds": maxRounds,
      "llm.model": modelId ?? "",
      "llm.provider": providerId ?? "",
      "llm.turn_id": turnId,
    },
  });

  // 主循环
  let round = 0;
  for (; round < maxRounds; round++) {
    // 检查中止信号
    if (abortSignal?.aborted) {
      log.info(`LLM 循环被中止`, {
        eventType: "llm.loop.aborted",
        payload: { round },
        turnId,
      });
      loopSpan.setAttribute("llm.exit_reason", "aborted");
      loopSpan.end();
      return {
        error: "执行被中止",
        hadToolCalls,
        ok: false,
        text: responseParts.join(""),
        toolRounds: round,
        usage: totalUsage,
      };
    }

    const requestId = createId("req");
    const requestStartedAt = Date.now();
    log.debug(`开始 LLM 请求轮次`, {
      eventType: "llm.loop.request.start",
      payload: { round },
      requestId,
      turnId,
    });

    // P2-A5: LLM 调用前捕获文件快照
    if (loopOptions.sessionId) {
      try {
        trackSnapshot(loopOptions.sessionId, "before", round);
      } catch (snapError) {
        log.debug(`before 快照捕获失败(非致命): ${snapError instanceof Error ? snapError.message : String(snapError)}`);
      }
    }

    // OTel: 子 span(每轮请求)
    const requestSpan = tracer.startSpan("llm.request", {
      attributes: { "llm.request_id": requestId, "llm.round": round, "llm.turn_id": turnId },
    });
    let requestUsage: TokenUsage | undefined;
    let requestSpanEnded = false;
    let requestTelemetryRecorded = false;
    const finishRequest = (status: "success" | "error" | "aborted", exitReason: string, message?: string) => {
      if (!requestTelemetryRecorded) {
        recordChatBusinessTelemetry({
          durationMs: Date.now() - requestStartedAt,
          exitReason,
          model: modelId,
          provider: providerId,
          round,
          status,
          usage: requestUsage,
        });
        requestTelemetryRecorded = true;
      }
      if (!requestSpanEnded) {
        requestSpan.setStatus({ code: status === "success" ? 0 : 2, message });
        requestSpan.end();
        requestSpanEnded = true;
      }
    };

    // 收集工具调用
    const toolCalls: ToolCallItem[] = [];
    let hadError = false;
    let errorMessage = "";

    // 创建组合中止控制器:外部信号 OR 空闲超时均触发中止，防止 Provider 挂起
    const combinedAbort = new AbortController();
    const onAbort = () => combinedAbort.abort();
    if (abortSignal?.aborted) {
      combinedAbort.abort();
    } else if (abortSignal) {
      abortSignal.addEventListener("abort", onAbort, { once: true });
    }

    // 创建空闲超时守卫，防止 LLM 流长时间无响应；超时后中止组合控制器
    const idleGuard = createIdleTimeoutGuard(timeout ?? 120_000, () => {
      log.warn(`LLM 流空闲超时 (${timeout ?? 120_000}ms)，中止流`, {
        eventType: "llm.loop.idle-timeout",
        payload: { round },
        requestId,
        turnId,
      });
      combinedAbort.abort();
    });

    try {
      // 调用 LLM 流式 API（使用组合中止信号）
      const tools = loopOptions.getTools?.() ?? loopOptions.tools;
      const requestSystem = loopOptions.getSystem?.() ?? system;
      for await (const event of streamFn(config, messages, {
        abortSignal: combinedAbort.signal,
        modelId,
        providerId,
        requestId,
        sessionId: loopOptions.sessionId,
        system: requestSystem,
        temperature,
        timeout,
        // 外部工具 schema({ description, inputSchema })在运行时兼容 AI SDK Tool，
        // 此处断言为 Record<string, Tool> 以匹配 streamLlm 接口签名
        tools: tools as Record<string, Tool> | undefined,
        topP,
        turnId,
      })) {
        if (event.type === "text-delta") {
          responseParts.push(event.text);
          callbacks.onTextDelta?.(event.text);
          idleGuard.touch();
        } else if (event.type === "tool-call") {
          const normalizedArgs = normalizeToolCallArgs(event.args);
          toolCalls.push({
            args: normalizedArgs,
            toolCallId: event.toolCallId,
            toolName: event.toolName,
          });
          callbacks.onToolCall?.({
            args: normalizedArgs,
            toolCallId: event.toolCallId,
            toolName: event.toolName,
          });
        } else if (event.type === "reasoning-delta") {
          reasoningParts.push(event.text);
          callbacks.onThinkingDelta?.(event.text);
          idleGuard.touch();
        } else if (event.type === "done") {
          // 处理完成事件和使用量统计
          if (event.usage) {
            requestUsage = {
              inputTokens: event.usage.promptTokens,
              outputTokens: event.usage.completionTokens,
              ...(event.usage.cacheCreationInputTokens !== undefined
                ? { cacheCreationInputTokens: event.usage.cacheCreationInputTokens }
                : {}),
              ...(event.usage.cacheReadInputTokens !== undefined
                ? { cacheReadInputTokens: event.usage.cacheReadInputTokens }
                : {}),
              ...(event.usage.cachedTokens !== undefined ? { cachedTokens: event.usage.cachedTokens } : {}),
            };
            accumulateUsage(event.usage);
            callbacks.onUsage?.(event.usage);
            requestSpan.setAttribute("llm.prompt_tokens", event.usage.promptTokens);
            requestSpan.setAttribute("llm.completion_tokens", event.usage.completionTokens);
            if (event.usage.cacheCreationInputTokens !== undefined) {
              requestSpan.setAttribute("gen_ai.cache.creation_input_tokens", event.usage.cacheCreationInputTokens);
            }
            if (event.usage.cacheReadInputTokens !== undefined) {
              requestSpan.setAttribute("gen_ai.cache.read_input_tokens", event.usage.cacheReadInputTokens);
            }
            if (event.usage.cachedTokens !== undefined) {
              requestSpan.setAttribute("gen_ai.cache.cached_tokens", event.usage.cachedTokens);
            }
          }
          finishRequest("success", "done");
          // Done 事件标志着流结束，跳出循环
          break;
        } else if (event.type === "error") {
          callbacks.onError?.(event.error);
          requestSpan.recordException(event.error);
          finishRequest("error", "stream_error", event.error.message);
          // 错误事件标志着流结束，跳出循环
          hadError = true;
          errorMessage = event.error.message;
          break;
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      log.error(`LLM 调用失败: ${error.message}`, {
        eventType: "llm.loop.request.failed",
        payload: { error: error.message, round },
        requestId,
        turnId,
      });
      requestSpan.recordException(error);
      finishRequest("error", "exception", error.message);
      callbacks.onError?.(error);
      loopSpan.setAttribute("llm.exit_reason", "error");
      loopSpan.setStatus({ code: 2, message: error.message });
      loopSpan.end();
      return {
        error: error.message,
        hadToolCalls,
        ok: false,
        text: responseParts.join(""),
        toolRounds: round,
        usage: totalUsage,
      };
    } finally {
      // 确保流结束时清理: 销毁空闲超时守卫 + 移除 abortSignal 监听器
      idleGuard.destroy();
      abortSignal?.removeEventListener("abort", onAbort);
    }

    // 检查是否有错误事件发生(onError 已在流处理中回调，此处仅做返回)
    if (hadError) {
      loopSpan.setAttribute("llm.exit_reason", "stream_error");
      loopSpan.setStatus({ code: 2, message: errorMessage });
      loopSpan.end();
      return {
        error: errorMessage,
        hadToolCalls,
        ok: false,
        text: responseParts.join(""),
        toolRounds: round,
        usage: totalUsage,
      };
    }

    const currentResponse = responseParts.join("");

    // 没有工具调用 → 默认结束；需要工具调用的运行时可追加提示继续下一轮。
    if (toolCalls.length === 0) {
      if (loopOptions.requireToolCallHint) {
        messages.push({ content: currentResponse, role: "assistant" });
        messages.push({
          content: loopOptions.toolCallHintMessage ?? "[System] 请调用合适的工具继续流程，而不是直接结束。",
          role: "user",
        });
        prevRoundText = currentResponse;
        responseParts.length = 0;
        continue;
      }

      log.info(`LLM 循环完成(无工具调用)`, {
        eventType: "llm.loop.done.no-tools",
        payload: { outputLength: currentResponse.length, round },
        turnId,
      });

      // 追加 assistant 消息
      messages.push({ content: currentResponse, role: "assistant" });

      loopSpan.setAttribute("llm.exit_reason", "complete");
      loopSpan.setAttribute("llm.rounds", round);
      loopSpan.setStatus({ code: 0 });
      loopSpan.end();
      return {
        hadToolCalls,
        ok: true,
        reasoning: reasoningParts.join("") || undefined,
        text: currentResponse,
        toolRounds: round,
        usage: totalUsage,
      };
    }

    hadToolCalls = true;

    // 追加 assistant 消息 + 工具调用
    const assistantParts: (
      | { type: "text"; text: string }
      | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
    )[] = [];
    if (currentResponse) {
      assistantParts.push({ text: currentResponse, type: "text" });
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
        assistantParts.length === 1 && assistantParts[0]!.type === "text" ? currentResponse : assistantParts,
      ),
    );

    // 工具调用分类和执行
    const toolExecutionState = await executeToolCallsInternal(
      toolCalls,
      messages,
      toolExecutor,
      callbacks,
      doomLoopState,
      doomLoopThreshold,
      loopOptions.sessionId,
      abortSignal,
      loopOptions.concurrentToolExecution,
      eventBus,
    );
    if (toolExecutionState.aborted) {
      loopSpan.setAttribute("llm.exit_reason", "tool_execution_aborted");
      loopSpan.setStatus({ code: 2, message: toolExecutionState.error });
      loopSpan.end();
      return {
        error: toolExecutionState.error,
        hadToolCalls,
        ok: false,
        reasoning: reasoningParts.join("") || undefined,
        text: currentResponse,
        toolRounds: round,
        usage: totalUsage,
      };
    }

    // 上下文压缩(如果提供)
    if (compressor && loopOptions.compressionThreshold) {
      const estimatedTokens = estimateMessagesTokens(messages);

      if (estimatedTokens >= loopOptions.compressionThreshold) {
        log.info(`LLM 循环触发上下文压缩: ${estimatedTokens} tokens`, {
          eventType: "llm.loop.compress",
          payload: { round, tokens: estimatedTokens },
          turnId,
        });

        try {
          const result = await compressor.compress(messages, config, modelId ?? "default", loopOptions.sessionId);

          if (result.compressed && result.messages) {
            messages.length = 0;
            messages.push(...result.messages);
            log.info(`LLM 循环上下文已压缩: ${result.beforeTokens} → ${result.afterTokensEstimate} tokens`, {
              eventType: "llm.loop.compressed",
              payload: {
                afterTokens: result.afterTokensEstimate,
                beforeTokens: result.beforeTokens,
                round,
              },
              turnId,
            });
          }
        } catch (error) {
          log.warn(`LLM 循环上下文压缩失败: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // 截断旧工具输出
      truncateToolOutputs(messages, loopOptions.toolOutputTruncateLength ?? 2000);
    }

    // 清空响应缓存，准备下一轮
    prevRoundText = currentResponse;
    responseParts.length = 0;
  }

  // 达到最大轮次
  log.warn(`LLM 循环达到最大轮次 (${maxRounds})`, {
    eventType: "llm.loop.max-rounds",
    payload: { maxRounds },
    turnId,
  });

  const finalResponse = responseParts.length > 0 ? responseParts.join("") : prevRoundText;

  loopSpan.setAttribute("llm.exit_reason", "max_rounds");
  loopSpan.setAttribute("llm.rounds", round);
  loopSpan.setStatus({ code: 2, message: `max rounds reached (${maxRounds})` });
  loopSpan.end();
  return {
    error: `达到最大工具调用轮次 (${maxRounds})，对话可能不完整`,
    hadToolCalls,
    ok: false,
    reasoning: reasoningParts.join("") || undefined,
    text: finalResponse,
    toolRounds: round,
    usage: totalUsage,
  };
}

/**
 * 内部工具调用执行逻辑
 * 支持串行(默认)和可选并发执行模式。
 * 并发模式下对多个无依赖工具使用 Promise.allSettled，
 * 串行模式下保持原有逐个执行语义。
 */
async function executeToolCallsInternal(
  toolCalls: ToolCallItem[],
  messages: ModelMessage[],
  toolExecutor: ToolExecutor,
  callbacks: LlmLoopCallbacks,
  doomLoopState: DoomLoopState,
  doomLoopThreshold: number | undefined,
  sessionId?: string,
  abortSignal?: AbortSignal,
  concurrent?: boolean,
  eventBus: EventBus = globalBus,
): Promise<{ aborted: boolean; error?: string }> {
  // ── 单个工具执行逻辑(串行与并发共用) ──
  const executeSingleTool = async (
    tc: ToolCallItem,
  ): Promise<{ aborted: boolean; error?: string; resultParts?: ToolResultPart[] }> => {
    // 检查中止信号
    if (abortSignal?.aborted) {
      return { aborted: true, error: "工具执行被用户中止" };
    }

    // 死循环检测
    const doomLoop = checkDoomLoop(doomLoopState, tc.toolName, tc.args, { doomLoopThreshold });
    if (doomLoop.doomed) {
      const doomMsg = doomLoop.message!;
      log.warn(doomMsg);
      eventBus.publish(
        AppEvent.ToolResult,
        {
          callId: tc.toolCallId,
          result: { error: doomMsg },
          sessionId,
          success: false,
          tool: tc.toolName,
        },
        { throttle: false },
      );
      const doomResultParts: ToolResultPart[] = [
        {
          output: { type: "error-text", value: doomMsg },
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          type: "tool-result",
        },
      ];
      return { aborted: false, resultParts: doomResultParts };
    }

    // 工具拦截器
    if (callbacks.toolInterceptor) {
      const result = await callbacks.toolInterceptor(tc.toolName, tc.args, tc.toolCallId);
      if (!result.allowed) {
        const blockMsg = `Tool 阻止: ${result.reason ?? "被拦截"}`;
        eventBus.publish(
          AppEvent.ToolResult,
          {
            callId: tc.toolCallId,
            result: { error: blockMsg },
            sessionId,
            success: false,
            tool: tc.toolName,
          },
          { throttle: false },
        );
        const blockResultParts: ToolResultPart[] = [
          {
            output: { type: "error-text", value: blockMsg },
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            type: "tool-result",
          },
        ];
        return { aborted: false, resultParts: blockResultParts };
      }
    }

    // 执行前回调
    if (callbacks.beforeToolExecution) {
      await callbacks.beforeToolExecution(tc.toolName, tc.args, tc.toolCallId);
    }

    // 执行工具
    const execution = await toolExecutor.execute(tc.toolName, tc.args, {
      abortSignal,
      messages,
      sessionId,
      toolCallId: tc.toolCallId,
    });

    // 执行后回调
    if (callbacks.afterToolExecution) {
      await callbacks.afterToolExecution(tc.toolName, execution, tc.toolCallId);
    }

    // P2-A5: 工具执行后捕获文件快照
    if (loopOptions.sessionId) {
      try {
        trackSnapshot(loopOptions.sessionId, "after", round);
      } catch (snapError) {
        log.debug(`after 快照捕获失败(非致命): ${snapError instanceof Error ? snapError.message : String(snapError)}`);
      }
    }

    // 追加工具结果。保持结构化输出为 json，避免对象结果被 stringify 后降级成 text。
    const output = execution.success
      ? toToolResultOutput(execution.output, false)
      : toToolResultOutput(`Error: ${execution.error ?? JSON.stringify(execution.output ?? "")}`, true);
    const resultParts: ToolResultPart[] = [
      {
        output,
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        type: "tool-result",
      },
    ];
    return { aborted: false, resultParts };
  };

  // ── 并发执行模式 ──
  if (concurrent && toolCalls.length > 1) {
    const results = await Promise.allSettled(toolCalls.map((tc) => executeSingleTool(tc)));

    for (let i = 0; i < results.length; i++) {
      const settled = results[i]!;
      const tc = toolCalls[i]!;
      if (settled.status === "fulfilled") {
        const { aborted, error, resultParts } = settled.value;
        if (aborted) {
          // 为当前及后续工具补充 error tool-result
          for (let j = i; j < toolCalls.length; j++) {
            const remaining = toolCalls[j]!;
            const abortResultParts: ToolResultPart[] = [
              {
                output: { type: "error-text", value: "工具执行被用户中止" },
                toolCallId: remaining.toolCallId,
                toolName: remaining.toolName,
                type: "tool-result",
              },
            ];
            messages.push(createMultiToolResultMessage(abortResultParts));
          }
          return { aborted: true, error: error ?? "执行被中止" };
        }
        if (resultParts) {
          messages.push(createMultiToolResultMessage(resultParts));
        }
      } else {
        // Promise rejected — 补充 error tool-result
        const errorText = settled.reason instanceof Error ? settled.reason.message : String(settled.reason);
        const errorResultParts: ToolResultPart[] = [
          {
            output: { type: "error-text", value: `Error: ${errorText}` },
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            type: "tool-result",
          },
        ];
        messages.push(createMultiToolResultMessage(errorResultParts));
      }
    }
    return { aborted: false };
  }

  // ── 串行执行模式(默认，保持兼容性) ──
  for (let i = 0; i < toolCalls.length; i++) {
    const tc = toolCalls[i]!;
    // 检查中止信号
    if (abortSignal?.aborted) {
      // 为当前及剩余未执行的工具调用补充 error tool-result，避免孤立 tool-call
      for (let j = i; j < toolCalls.length; j++) {
        const remaining = toolCalls[j]!;
        const abortResultParts: ToolResultPart[] = [
          {
            output: { type: "error-text", value: "工具执行被用户中止" },
            toolCallId: remaining.toolCallId,
            toolName: remaining.toolName,
            type: "tool-result",
          },
        ];
        messages.push(createMultiToolResultMessage(abortResultParts));
        if (j === i) {
          eventBus.publish(
            AppEvent.ToolResult,
            {
              callId: tc.toolCallId,
              result: { error: "工具执行被用户中止" },
              sessionId,
              success: false,
              tool: tc.toolName,
            },
            { throttle: false },
          );
        }
      }
      return { aborted: true, error: "执行被中止" };
    }

    const result = await executeSingleTool(tc);
    if (result.aborted) {
      // 串行模式下 executeSingleTool 的中止意味着后续工具也需要中止结果
      for (let j = i + 1; j < toolCalls.length; j++) {
        const remaining = toolCalls[j]!;
        const abortResultParts: ToolResultPart[] = [
          {
            output: { type: "error-text", value: "工具执行被用户中止" },
            toolCallId: remaining.toolCallId,
            toolName: remaining.toolName,
            type: "tool-result",
          },
        ];
        messages.push(createMultiToolResultMessage(abortResultParts));
      }
      return result;
    }
    if (result.resultParts) {
      messages.push(createMultiToolResultMessage(result.resultParts));
    }
  }

  return { aborted: false };
}
