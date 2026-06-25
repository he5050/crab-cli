/**
 * LLM Stream 适配器 — AsyncIterable ↔ Effect Stream 双向转换。
 *
 * 职责:
 *   - 将 AsyncIterable<T> 转为 Effect Stream<T>
 *   - 将 Effect Stream<T> 转为 AsyncIterable<T>
 *   - 提供 Effect Stream 模式的 LLM 循环处理工具
 *
 * 使用场景:
 *   - 将现有 streamLlm 的 AsyncGenerator 适配到 Effect Stream 生态
 *   - 使用 Stream.tap / Stream.takeUntil / Stream.runDrain 等高阶操作
 *   - 作为可选路径替代现有 AsyncIterable 流式处理
 *
 * 边界:
 *   1. 仅提供转换工具，不修改现有 streamLlm 实现
 *   2. Effect Stream 路径通过配置项控制，默认不启用
 *   3. 转换过程保持错误传播语义
 *
 * 流程:
 *   1. asyncIterableToStream: 将 for-await 迭代封装为 Effect Stream
 *   2. streamToAsyncIterable: 将 Effect Stream 消费为 AsyncIterable
 *   3. executeLlmLoopWithStream: 使用 Effect Stream 编排 LLM 循环
 */
import { Effect, Stream } from "effect";
import type { ModelMessage, Tool } from "ai";
import type { AppConfigSchema } from "@/schema/config";
import { streamLlm, type LlmStreamEvent } from "@/api";
import { accumulateUsageDecimal } from "@/api/core/cost";
import { createLogger } from "@/core/logging/logger";
import { createId } from "@/core/identity";
import type { TokenUsage } from "@/conversation/types/handler";
import type {
  LlmLoopCallbacks,
  LlmLoopOptions,
  LlmLoopResult,
  MessageCompressor,
  ToolCallItem,
  ToolExecutor,
} from "@/conversation/types/loop";
import { normalizeToolCallArgs } from "@/conversation/message/toolCallHelpers";
import { createIdleTimeoutGuard } from "@/conversation/stream/idleTimeoutGuard";
import { estimateMessagesTokens, truncateToolOutputs } from "@/compress/conversation";
import { DEFAULT_MAX_TOOL_ROUNDS } from "@/config";
import { globalBus, type EventBus } from "@/bus";
import { AppEvent } from "@/bus";
import { type DoomLoopState, createDoomLoopState } from "@/conversation/guard/doomLoop";
import { checkDoomLoop } from "@/conversation/guard/doomLoopPolicy";
import { createMultiToolResultMessage, createPartsAssistantMessage } from "@/conversation/message/messageFactories";
import type { ToolResultPart } from "ai";

const log = createLogger("llm:stream-adapter");

// ─── AsyncIterable ↔ Effect Stream 双向转换 ──────────────────────

/**
 * 将 AsyncIterable<T> 转为 Effect Stream<T>。
 *
 * 使用 Stream.asyncSubscription 创建一个从 AsyncIterable 拉取数据的 Effect Stream。
 * 支持错误传播和中止信号。
 *
 * @param iter 源 AsyncIterable
 * @returns Effect Stream
 */
export function asyncIterableToStream<T>(iter: AsyncIterable<T>): Stream.Stream<T> {
  return Stream.asyncPush<T>((emit) =>
    Effect.async<never, never, void>((resume) => {
      let cancelled = false;
      (async () => {
        try {
          for await (const item of iter) {
            if (cancelled) {
              break;
            }
            emit.single(item);
          }
          emit.end();
        } catch (err) {
          emit.fail(err instanceof Error ? err : new Error(String(err)));
        }
      })();
      resume(
        Effect.sync(() => {
          cancelled = true;
        }),
      );
    }),
  );
}

/**
 * 将 Effect Stream<T> 转为 AsyncIterable<T>。
 *
 * 通过 Effect runtime 消费 Stream，将每个元素 yield 为 AsyncIterable。
 *
 * @param stream 源 Effect Stream
 * @returns AsyncIterable
 */
export async function* streamToAsyncIterable<T>(stream: Stream.Stream<T>): AsyncIterable<T> {
  const runtime = Effect.runtime;
  const queue: T[] = [];
  let done = false;
  let error: Error | null = null;
  let resolveWait: (() => void) | null = null;

  const consumerEffect = Stream.runForEach(stream, (item: T) =>
    Effect.sync(() => {
      queue.push(item);
      resolveWait?.();
      resolveWait = null;
    }),
  );

  const fiber = runtime.unsafeFork(
    consumerEffect.pipe(
      Effect.catchAll((err) =>
        Effect.sync(() => {
          error = err instanceof Error ? err : new Error(String(err));
          done = true;
          resolveWait?.();
          resolveWait = null;
        }),
      ),
    ),
  ) as unknown as { await: () => void };

  // 启动后台消费
  (async () => {
    try {
      await Effect.runPromise(consumerEffect);
    } catch (err) {
      error = err instanceof Error ? err : new Error(String(err));
    } finally {
      done = true;
      resolveWait?.();
      resolveWait = null;
    }
  })();

  while (true) {
    if (queue.length > 0) {
      yield queue.shift()!;
      continue;
    }
    if (done) {
      if (error) {
        throw error;
      }
      break;
    }
    // 等待新数据
    await new Promise<void>((resolve) => {
      resolveWait = resolve;
    });
  }
}

// ─── Effect Stream 模式的 LLM 循环 ──────────────────────────────

/** LLM 循环内部状态 */
interface StreamLoopState {
  responseParts: string[];
  reasoningParts: string[];
  totalUsage: TokenUsage | undefined;
  hadToolCalls: boolean;
  prevRoundText: string;
  doomLoopState: DoomLoopState;
  turnId: string;
}

/**
 * 处理单个 LLM 流事件，更新状态并触发回调。
 */
function handleStreamEvent(
  event: LlmStreamEvent,
  state: StreamLoopState,
  callbacks: LlmLoopCallbacks,
  toolCalls: ToolCallItem[],
  idleGuard: { touch: () => void },
): { done: boolean; hadError: boolean; errorMessage: string } {
  let done = false;
  let hadError = false;
  let errorMessage = "";

  switch (event.type) {
    case "text-delta": {
      state.responseParts.push(event.text);
      callbacks.onTextDelta?.(event.text);
      idleGuard.touch();
      break;
    }
    case "tool-call": {
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
      break;
    }
    case "reasoning-delta": {
      state.reasoningParts.push(event.text);
      callbacks.onThinkingDelta?.(event.text);
      idleGuard.touch();
      break;
    }
    case "done": {
      if (event.usage) {
        const usage: TokenUsage = {
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
        state.totalUsage = accumulateUsageDecimal(state.totalUsage, usage);
        callbacks.onUsage?.(event.usage);
      }
      done = true;
      break;
    }
    case "error": {
      callbacks.onError?.(event.error);
      hadError = true;
      errorMessage = event.error.message;
      done = true;
      break;
    }
  }

  return { done, hadError, errorMessage };
}

/**
 * 使用 Effect Stream 模式执行 LLM 消息循环。
 *
 * 这是 executeLlmLoop 的 Effect Stream 版本，提供相同的接口但使用
 * Stream.tap / Stream.takeUntil / Stream.runDrain 进行流式编排。
 *
 * 通过配置项 useEffectStream: true 启用，默认不启用。
 *
 * @param messages 消息历史(会被修改)
 * @param loopOptions 循环选项
 * @param toolExecutor 工具执行器
 * @param callbacks 回调接口
 * @param config 应用配置
 * @param compressor 消息压缩器(可选)
 * @returns 循环结果
 */
export async function executeLlmLoopWithStream(
  messages: ModelMessage[],
  loopOptions: LlmLoopOptions,
  toolExecutor: ToolExecutor,
  callbacks: LlmLoopCallbacks,
  config: AppConfigSchema,
  compressor?: MessageCompressor,
): Promise<LlmLoopResult> {
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

  const state: StreamLoopState = {
    doomLoopState: createDoomLoopState(),
    hadToolCalls: false,
    prevRoundText: "",
    reasoningParts: [],
    responseParts: [],
    totalUsage: undefined,
    turnId: loopOptions.turnId ?? createId("trn"),
  };

  log.info(`开始 LLM 循环(Effect Stream 模式)`, {
    eventType: "llm.loop.stream.start",
    payload: { maxRounds, modelId, providerId },
    turnId: state.turnId,
  });

  // 主循环
  let round = 0;
  for (; round < maxRounds; round++) {
    if (abortSignal?.aborted) {
      log.info(`LLM 循环被中止`, {
        eventType: "llm.loop.stream.aborted",
        payload: { round },
        turnId: state.turnId,
      });
      return {
        error: "执行被中止",
        hadToolCalls: state.hadToolCalls,
        ok: false,
        text: state.responseParts.join(""),
        toolRounds: round,
        usage: state.totalUsage,
      };
    }

    const requestId = createId("req");
    const toolCalls: ToolCallItem[] = [];
    let hadError = false;
    let errorMessage = "";

    // 组合中止控制器
    const combinedAbort = new AbortController();
    const onAbort = () => combinedAbort.abort();
    if (abortSignal?.aborted) {
      combinedAbort.abort();
    } else if (abortSignal) {
      abortSignal.addEventListener("abort", onAbort, { once: true });
    }

    // 空闲超时守卫
    const idleGuard = createIdleTimeoutGuard(timeout ?? 120_000, () => {
      log.warn(`LLM 流空闲超时 (${timeout ?? 120_000}ms)，中止流`, {
        eventType: "llm.loop.stream.idle-timeout",
        payload: { round },
        requestId,
        turnId: state.turnId,
      });
      combinedAbort.abort();
    });

    try {
      // 获取工具和系统提示词
      const tools = loopOptions.getTools?.() ?? loopOptions.tools;
      const requestSystem = loopOptions.getSystem?.() ?? system;

      // 创建 AsyncIterable 源
      const asyncIterable = streamFn(config, messages, {
        abortSignal: combinedAbort.signal,
        modelId,
        providerId,
        requestId,
        sessionId: loopOptions.sessionId,
        system: requestSystem,
        temperature,
        timeout,
        tools: tools as Record<string, Tool> | undefined,
        topP,
        turnId: state.turnId,
      });

      // 转换为 Effect Stream
      const effectStream = asyncIterableToStream<LlmStreamEvent>(asyncIterable);

      // 使用 Stream.tap 处理事件，Stream.runDrain 消费流
      const processedStream = Stream.tap(effectStream, (event) =>
        Effect.sync(() => {
          const result = handleStreamEvent(event, state, callbacks, toolCalls, idleGuard);
          if (result.hadError) {
            hadError = true;
            errorMessage = result.errorMessage;
          }
        }),
      );

      // 使用 Stream.runDrain 消费整个流
      await Effect.runPromise(Stream.runDrain(processedStream));
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      log.error(`LLM 调用失败(Stream 模式): ${error.message}`, {
        eventType: "llm.loop.stream.request.failed",
        payload: { error: error.message, round },
        requestId,
        turnId: state.turnId,
      });
      callbacks.onError?.(error);
      return {
        error: error.message,
        hadToolCalls: state.hadToolCalls,
        ok: false,
        text: state.responseParts.join(""),
        toolRounds: round,
        usage: state.totalUsage,
      };
    } finally {
      idleGuard.destroy();
      abortSignal?.removeEventListener("abort", onAbort);
    }

    // 检查错误
    if (hadError) {
      return {
        error: errorMessage,
        hadToolCalls: state.hadToolCalls,
        ok: false,
        text: state.responseParts.join(""),
        toolRounds: round,
        usage: state.totalUsage,
      };
    }

    const currentResponse = state.responseParts.join("");

    // 没有工具调用 → 结束
    if (toolCalls.length === 0) {
      if (loopOptions.requireToolCallHint) {
        messages.push({ content: currentResponse, role: "assistant" });
        messages.push({
          content: loopOptions.toolCallHintMessage ?? "[System] 请调用合适的工具继续流程，而不是直接结束。",
          role: "user",
        });
        state.prevRoundText = currentResponse;
        state.responseParts.length = 0;
        continue;
      }

      log.info(`LLM 循环完成(Stream 模式，无工具调用)`, {
        eventType: "llm.loop.stream.done.no-tools",
        payload: { outputLength: currentResponse.length, round },
        turnId: state.turnId,
      });

      messages.push({ content: currentResponse, role: "assistant" });

      return {
        hadToolCalls: state.hadToolCalls,
        ok: true,
        reasoning: state.reasoningParts.join("") || undefined,
        text: currentResponse,
        toolRounds: round,
        usage: state.totalUsage,
      };
    }

    state.hadToolCalls = true;

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

    // 工具调用执行(复用串行逻辑)
    const toolResult = await executeToolCallsStream(
      toolCalls,
      messages,
      toolExecutor,
      callbacks,
      state.doomLoopState,
      doomLoopThreshold,
      loopOptions.sessionId,
      abortSignal,
      eventBus,
    );
    if (toolResult.aborted) {
      return {
        error: toolResult.error,
        hadToolCalls: state.hadToolCalls,
        ok: false,
        reasoning: state.reasoningParts.join("") || undefined,
        text: currentResponse,
        toolRounds: round,
        usage: state.totalUsage,
      };
    }

    // 上下文压缩
    if (compressor && loopOptions.compressionThreshold) {
      const estimatedTokens = estimateMessagesTokens(messages);
      if (estimatedTokens >= loopOptions.compressionThreshold) {
        log.info(`LLM 循环触发上下文压缩(Stream 模式): ${estimatedTokens} tokens`, {
          eventType: "llm.loop.stream.compress",
          payload: { round, tokens: estimatedTokens },
          turnId: state.turnId,
        });
        try {
          const result = await compressor.compress(messages, config, modelId ?? "default", loopOptions.sessionId);
          if (result.compressed && result.messages) {
            messages.length = 0;
            messages.push(...result.messages);
          }
        } catch (error) {
          log.warn(`LLM 循环上下文压缩失败(Stream 模式): ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      truncateToolOutputs(messages, loopOptions.toolOutputTruncateLength ?? 2000);
    }

    state.prevRoundText = currentResponse;
    state.responseParts.length = 0;
  }

  // 达到最大轮次
  log.warn(`LLM 循环达到最大轮次 (${maxRounds}, Stream 模式)`, {
    eventType: "llm.loop.stream.max-rounds",
    payload: { maxRounds },
    turnId: state.turnId,
  });

  const finalResponse = state.responseParts.length > 0 ? state.responseParts.join("") : state.prevRoundText;
  return {
    error: `达到最大工具调用轮次 (${maxRounds})，对话可能不完整`,
    hadToolCalls: state.hadToolCalls,
    ok: false,
    reasoning: state.reasoningParts.join("") || undefined,
    text: finalResponse,
    toolRounds: round,
    usage: state.totalUsage,
  };
}

/**
 * 工具调用执行(Stream 模式内部使用)。
 * 简化版串行执行，与 executeLlmLoop 中的逻辑保持一致。
 */
async function executeToolCallsStream(
  toolCalls: ToolCallItem[],
  messages: ModelMessage[],
  toolExecutor: ToolExecutor,
  callbacks: LlmLoopCallbacks,
  doomLoopState: DoomLoopState,
  doomLoopThreshold: number | undefined,
  sessionId?: string,
  abortSignal?: AbortSignal,
  eventBus: EventBus = globalBus,
): Promise<{ aborted: boolean; error?: string }> {
  for (let i = 0; i < toolCalls.length; i++) {
    const tc = toolCalls[i]!;

    if (abortSignal?.aborted) {
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
      return { aborted: true, error: "执行被中止" };
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
      messages.push(createMultiToolResultMessage(doomResultParts));
      continue;
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
        messages.push(createMultiToolResultMessage(blockResultParts));
        continue;
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

    // 追加工具结果
    const output = execution.success
      ? execution.output
      : { type: "error-text" as const, value: `Error: ${execution.error ?? JSON.stringify(execution.output ?? "")}` };
    const resultParts: ToolResultPart[] = [
      {
        output: output as ToolResultPart["output"],
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        type: "tool-result",
      },
    ];
    messages.push(createMultiToolResultMessage(resultParts));
  }

  return { aborted: false };
}
