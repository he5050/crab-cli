/**
 * LLM 流处理 — 执行单次 streamText 调用。
 *
 * 职责:
 *   - 封装 streamText 调用和流事件处理
 *   - 管理流式超时控制和取消机制
 *   - 处理文本增量、推理增量和工具调用事件
 *   - 处理 SDK 内部错误并决定是否抛出
 *
 * 模块功能:
 *   - doStreamCall: 执行单次 streamText 调用并返回异步生成器
 *   - _setStreamTextForTesting: 测试用的 streamText 注入覆盖
 *   - _resetStreamTextForTesting: 重置测试覆盖
 *
 * 使用场景:
 *   - LLM 流式对话响应
 *   - 需要实时显示生成内容的场景
 *   - 支持工具调用的流式交互
 *   - 需要超时控制的长时间生成任务
 *
 * 边界:
 *   1. 纯流处理逻辑，不处理降级重试(由调用方处理)
 *   2. 仅处理单次 streamText 调用，不管理多轮对话状态
 *   3. "text part not found" 错误是 SDK 内部跟踪警告，不影响文本流
 *   4. 默认超时时间为 60 秒
 *   5. 支持 Anthropic thinking 和 OpenAI reasoningEffort 配置
 *
 * 流程:
 *   1. 获取验证过的请求方法和 Provider 模型
 *   2. 准备消息(可选添加 system 消息)
 *   3. 设置超时控制和取消监听器
 *   4. 调用 streamText 开始流式生成
 *   5. 遍历 fullStream 处理各类 chunk 事件
 *      - text-delta: 文本增量，调用 options.onChunk 回调
 *      - reasoning-delta: 推理增量，调用 options.onChunk 回调
 *      - tool-call: 工具调用
 *      - error: 错误处理(过滤 SDK 内部警告)
 *   6. 检测空响应并抛出错误(触发降级)
 *   7. 返回完成事件和完整文本
 */
import { type ModelMessage, type Tool, streamText } from "ai";
import { createHash } from "node:crypto";
import { DEFAULT_STREAM_TIMEOUT_MS } from "@/config";
import { createProvider } from "../core/provider";
import type { AppConfigSchema, RequestMethod, SingleProviderConfig, ThinkingConfig } from "@/schema/config";
import { getVerifiedMethod } from "../resilience/fallback";
import { createLogger } from "@/core/logging/logger";

// 延迟导入工具注册表，避免 API 层与工具层硬耦合
async function getToolsFallback(): Promise<Record<string, Tool>> {
  const { getToolsForAiSdk } = await import("@/tool/registry/toolRegistry");
  // AiSdkToolSchema(description + inputSchema) 是 Tool 的子集，
  // streamText 运行时不要求 execute 字段（工具调用由 Handler 层处理）
  return getToolsForAiSdk() as unknown as Record<string, Tool>;
}
import { pickFirstDefined } from "@/core/utilities/pickFirstDefined";
import type { LlmOptions, LlmStreamEvent, LlmTokenUsage } from "../core/llm";
import { buildCacheControl, resolveCachePolicy, shouldCache, type CachePolicy } from "../core/cachePolicy";
import { createInternalError } from "@/core/errors/appError";
import { getGlobalMiddlewarePipeline, wrapStreamWithMiddleware } from "./streamMiddleware";
import { processWithEffectStream, shouldUseEffectMiddleware } from "./streamMiddlewareEffect";
import { resolveStreamRuntime } from "./visionRouter";

const log = createLogger("llm:stream");

/** 构建提示词缓存键，基于会话/请求/全局作用域与系统提示哈希。 */
function buildPromptCacheKey(params: {
  providerId: string;
  modelId: string;
  requestMethod: string;
  sessionId?: string;
  requestId?: string;
  system?: string;
}): string {
  // 优先使用稳定的 sessionId，保持缓存键在多轮请求间复用；
  // 缺失时回退到 requestId，保证单次调用至少能命中。
  // 最后兜底 "global" 用于纯测试/无 session 场景（如单元测试）。
  const scopeId = params.sessionId ?? params.requestId ?? "global";
  const systemHash = params.system
    ? createHash("sha256").update(params.system, "utf8").digest("hex").slice(0, 16)
    : "no-system";
  return ["crab", params.providerId, params.modelId, params.requestMethod, scopeId, systemHash].join(":");
}

/** 安全数值解析，处理 string/number/NaN/Infinity 等边界情况。 */
function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

/** 将各 SDK 响应格式的 token 用量统一归一化为 LlmTokenUsage 结构。 */
function normalizeUsage(raw: unknown): LlmTokenUsage | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const usage = raw as Record<string, unknown>;
  const rawUsage = usage.raw && typeof usage.raw === "object" ? (usage.raw as Record<string, unknown>) : {};
  const inputDetails =
    usage.inputTokenDetails && typeof usage.inputTokenDetails === "object"
      ? (usage.inputTokenDetails as Record<string, unknown>)
      : {};
  const promptDetails =
    rawUsage.prompt_tokens_details && typeof rawUsage.prompt_tokens_details === "object"
      ? (rawUsage.prompt_tokens_details as Record<string, unknown>)
      : {};

  // 字段别名映射表：遍历候选路径，第一个有效值即采用
  const pick = (candidates: (unknown | undefined)[]): number | undefined => {
    for (const c of candidates) {
      const n = asNumber(c);
      if (n !== undefined) return n;
    }
    return undefined;
  };

  const promptTokens = pick([usage.promptTokens, usage.inputTokens, usage.prompt_tokens, rawUsage.prompt_tokens]) ?? 0;
  const completionTokens =
    pick([usage.completionTokens, usage.outputTokens, usage.completion_tokens, rawUsage.completion_tokens]) ?? 0;
  const totalTokens =
    pick([usage.totalTokens, usage.total_tokens, rawUsage.total_tokens]) ?? promptTokens + completionTokens;
  const cacheCreationInputTokens = pick([
    usage.cacheCreationInputTokens,
    usage.cache_creation_input_tokens,
    inputDetails.cacheWriteTokens,
    inputDetails.cacheWrite,
    rawUsage.cache_creation_input_tokens,
  ]);
  const cacheReadInputTokens = pick([
    usage.cacheReadInputTokens,
    usage.cachedInputTokens,
    usage.cached_input_tokens,
    usage.cache_read_input_tokens,
    inputDetails.cacheReadTokens,
    inputDetails.cacheRead,
    promptDetails.cached_tokens,
  ]);
  const cachedTokens = asNumber(usage.cachedTokens) ?? cacheReadInputTokens;

  return {
    completionTokens,
    promptTokens,
    totalTokens,
    ...(cacheCreationInputTokens !== undefined ? { cacheCreationInputTokens } : {}),
    ...(cacheReadInputTokens !== undefined ? { cacheReadInputTokens } : {}),
    ...(cachedTokens !== undefined ? { cachedTokens } : {}),
  };
}

/** 按优先级解析 thinking 配置：模型级 > 请求方法级 > Provider 默认。 */
function resolveThinkingConfig(
  providerCfg: SingleProviderConfig | undefined,
  modelId: string,
  effectiveModel: string,
  requestMethod: RequestMethod,
): ThinkingConfig | undefined {
  if (!providerCfg) {
    return undefined;
  }
  return pickFirstDefined(
    providerCfg.modelThinking?.[effectiveModel],
    providerCfg.modelThinking?.[modelId],
    providerCfg.requestThinking?.[requestMethod],
    providerCfg.thinking,
  );
}

/** 构建 Anthropic 专用 provider 选项（thinking + 缓存控制）。 */
function buildAnthropicOptions(
  thinkingConfig: ThinkingConfig | undefined,
  promptCachingEnabled: boolean,
  cachePolicy?: CachePolicy,
): Record<string, unknown> | undefined {
  const options: Record<string, unknown> = {};
  if (thinkingConfig) {
    options.thinking = thinkingConfig.enabled
      ? { budgetTokens: thinkingConfig.budgetTokens, type: "enabled" as const }
      : { type: "disabled" as const };
  }
  // 缓存控制:优先使用显式传入的 cachePolicy，否则根据 promptCachingEnabled 默认 ephemeral
  const effectiveCacheControl = cachePolicy
    ? buildCacheControl(cachePolicy)
    : promptCachingEnabled
      ? { type: "ephemeral" as const }
      : undefined;
  if (effectiveCacheControl) {
    options.cacheControl = effectiveCacheControl;
  }
  return Object.keys(options).length ? options : undefined;
}

/** 构建 Google/Gemini 专用 provider 选项（thinking 配置）。 */
function buildGoogleOptions(thinkingConfig: ThinkingConfig | undefined): Record<string, unknown> | undefined {
  if (!thinkingConfig) {
    return undefined;
  }
  return {
    thinkingConfig: {
      ...(thinkingConfig.enabled ? {} : { thinkingBudget: 0 }),
      ...(thinkingConfig.enabled && thinkingConfig.budgetTokens !== undefined
        ? { thinkingBudget: thinkingConfig.budgetTokens }
        : {}),
      ...(thinkingConfig.includeThoughts !== undefined ? { includeThoughts: thinkingConfig.includeThoughts } : {}),
      ...(thinkingConfig.thinkingLevel !== undefined ? { thinkingLevel: thinkingConfig.thinkingLevel } : {}),
    },
  };
}

// @internal Test-only DI override for streamText
let _streamTextOverride: typeof streamText | null = null;

export function _setStreamTextForTesting(fn: typeof streamText | null): void {
  _streamTextOverride = fn;
}

export function _resetStreamTextForTesting(): void {
  _streamTextOverride = null;
}

/**
 * 构建 Provider 特定的选项（thinking/缓存等）。
 */
function buildProviderOptions(
  requestMethod: RequestMethod,
  providerCfg: SingleProviderConfig | undefined,
  modelId: string,
  effectiveModel: string,
  options: { sessionId?: string; system?: string; requestId?: string; cachePolicy?: CachePolicy },
): { thinkingConfig: ThinkingConfig | undefined; providerOptions: Record<string, unknown> } {
  const thinkingConfig = resolveThinkingConfig(providerCfg, modelId, effectiveModel, requestMethod);
  const reasoningEffort = thinkingConfig?.reasoningEffort ?? providerCfg?.reasoningEffort;
  const promptCachingEnabled = providerCfg?.promptCaching?.enabled ?? true;

  // 解析有效缓存策略:优先使用显式传入的 cachePolicy，否则根据 promptCaching 配置推断
  const effectiveCachePolicy: CachePolicy = options.cachePolicy ?? resolveCachePolicy(promptCachingEnabled);

  const promptCacheKey = promptCachingEnabled
    ? buildPromptCacheKey({
        modelId: effectiveModel,
        providerId: providerCfg?.requestMethod ?? requestMethod,
        requestId: options.requestId,
        requestMethod,
        sessionId: options.sessionId,
        system: options.system,
      })
    : undefined;

  const providerOptions: Record<string, unknown> = {};

  if (requestMethod === "claude") {
    const anthropicOptions = buildAnthropicOptions(thinkingConfig, promptCachingEnabled, effectiveCachePolicy);
    if (anthropicOptions) {
      providerOptions.anthropic = anthropicOptions;
    }
  }

  if ((requestMethod === "chat" || requestMethod === "responses") && reasoningEffort) {
    providerOptions.openai = {
      reasoningEffort,
    };
  }

  if (requestMethod === "gemini") {
    const googleOptions = buildGoogleOptions(thinkingConfig);
    if (googleOptions) {
      providerOptions.google = googleOptions;
    }
  }

  if (promptCachingEnabled && promptCacheKey) {
    if (requestMethod === "chat" || requestMethod === "responses") {
      providerOptions.openai = {
        ...(providerOptions.openai as Record<string, unknown> | undefined),
        promptCacheKey,
        promptCacheRetention: "in_memory" as const,
      };
    }
  }

  return { thinkingConfig, providerOptions };
}

/**
 * 执行单次 streamText 调用。
 */
export async function* doStreamCall(
  config: AppConfigSchema,
  providerId: string,
  modelId: string,
  messages: ModelMessage[],
  options: LlmOptions,
): AsyncGenerator<LlmStreamEvent> {
  const runtime = resolveStreamRuntime(config, providerId, modelId, messages);
  if (runtime.usingVision) {
    log.debug(
      `检测到图片内容，切换到 Vision 路由: provider=${runtime.providerId}, model=${runtime.modelId}, requestMethod=${runtime.requestMethod}`,
    );
  }

  const getModel = createProvider(runtime.config, runtime.providerId, runtime.modelId);
  const model = getModel(runtime.modelId);
  const tools = options.tools ?? (await getToolsFallback());
  const preparedMessages: ModelMessage[] = options.system
    ? [{ content: options.system, role: "system" }, ...messages]
    : messages;

  // 超时控制:默认 60 秒
  const timeoutMs = options.timeout || DEFAULT_STREAM_TIMEOUT_MS;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let timeoutTriggered = false;
  const controller = new AbortController();
  const abortListener = () => controller.abort(options.abortSignal?.reason);

  if (options.abortSignal) {
    options.abortSignal.addEventListener("abort", abortListener, { once: true });
  }

  timeoutId = setTimeout(() => {
    timeoutTriggered = true;
    log.warn(`流式超时 (${timeoutMs}ms)，主动中止`, {
      eventType: "llm.timeout.triggered",
      modelId,
      providerId,
      requestId: options.requestId,
      timeoutMs,
    });
    controller.abort("timeout");
  }, timeoutMs);
  log.debug(`流式超时设定: ${timeoutMs}ms`, {
    eventType: "llm.timeout.configured",
    requestId: options.requestId,
    timeoutMs,
  });

  const textParts: string[] = [];
  let finalUsage: LlmTokenUsage | undefined;

  try {
    const { providerCfg, requestMethod } = runtime;
    const { thinkingConfig, providerOptions } = buildProviderOptions(
      requestMethod,
      providerCfg,
      modelId,
      runtime.modelId,
      {
        sessionId: options.sessionId,
        system: options.system,
        requestId: options.requestId,
        cachePolicy: options.cachePolicy,
      },
    );

    const streamTextImpl = _streamTextOverride ?? streamText;
    const result = streamTextImpl({
      abortSignal: controller.signal,
      allowSystemInMessages: true,
      maxOutputTokens: options.maxTokens,
      maxRetries: 4,
      messages: preparedMessages,
      model,
      providerOptions: providerOptions as Parameters<typeof streamText>[0]["providerOptions"],
      temperature: options.temperature ?? 0.7,
      tools,
      topP: options.topP,
    });

    let sawToolCall = false;
    let sawReasoning = false;

    async function* rawStream(): AsyncGenerator<LlmStreamEvent> {
      for await (const chunk of result.fullStream) {
        if (chunk.type === "text-delta") {
          const delta = chunk.text;
          if (delta) {
            textParts.push(delta);
            options.onChunk?.({ type: "text", chunk: delta });
            yield { text: delta, type: "text-delta" };
          }
        } else if (chunk.type === "reasoning-delta") {
          const delta = chunk.text;
          if (delta) {
            sawReasoning = true;
            options.onChunk?.({ type: "reasoning", chunk: delta });
            yield { text: delta, type: "reasoning-delta" };
          }
        } else if (chunk.type === "tool-call") {
          sawToolCall = true;
          yield {
            args: chunk.input,
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            type: "tool-call",
          };
        } else if (chunk.type === "error") {
          const errChunk = chunk as Record<string, unknown>;
          const errorText: string =
            typeof errChunk.errorText === "string"
              ? errChunk.errorText
              : typeof errChunk.error === "string"
                ? errChunk.error
                : errChunk.error instanceof Error
                  ? errChunk.error.message
                  : errChunk.error != null && typeof errChunk.error === "object"
                    ? JSON.stringify(errChunk.error)
                    : String(errChunk);

          if (errorText.includes("text part") && errorText.includes("not found")) {
            log.debug(`SDK 内部文本追踪警告(可忽略): ${errorText}`);
            continue;
          }

          log.error(`流式错误: ${errorText}`);
          throw createInternalError("UNKNOWN_ERROR", errorText);
        } else if (chunk.type === "finish") {
          const usage = "usage" in chunk ? (chunk as Record<string, unknown>).usage : undefined;
          finalUsage = normalizeUsage(usage);
          log.debug(`流完成: token用量=${JSON.stringify(usage ?? "N/A")}`);
        }
      }
    }

    const middlewareContext = {
      providerId: runtime.providerId,
      modelId: runtime.modelId,
      sessionId: options.sessionId,
      requestId: options.requestId,
    };

    const pipeline = getGlobalMiddlewarePipeline();

    async function* fullStream(): AsyncGenerator<LlmStreamEvent> {
      const useEffect = shouldUseEffectMiddleware(options as { useEffectMiddleware?: boolean });
      const processedStream = useEffect
        ? processWithEffectStream(rawStream(), pipeline, middlewareContext)
        : wrapStreamWithMiddleware(rawStream(), middlewareContext, pipeline);
      for await (const event of processedStream) {
        yield event;
      }

      if (textParts.join("").trim().length === 0 && !sawToolCall && !sawReasoning) {
        log.warn(`${requestMethod} 模式返回空响应，准备触发降级`, {
          eventType: "llm.empty-response",
          modelId: runtime.modelId,
          providerId: runtime.providerId,
          requestMethod,
        });
        throw createInternalError("UNKNOWN_ERROR", "供应商返回空响应");
      }

      yield { fullText: textParts.join(""), type: "done", usage: finalUsage };
    }

    for await (const event of fullStream()) {
      yield event;
    }
  } catch (error) {
    if (controller.signal.aborted) {
      if (timeoutTriggered) {
        throw createInternalError("UNKNOWN_ERROR", `流式超时 (${timeoutMs}ms)`);
      }
      if (options.abortSignal?.aborted) {
        throw createInternalError("UNKNOWN_ERROR", "流式请求已取消");
      }
    }
    throw error;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    if (options.abortSignal) {
      options.abortSignal.removeEventListener("abort", abortListener);
    }
  }
}
