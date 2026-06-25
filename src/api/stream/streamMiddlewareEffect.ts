/**
 * 流中间件 Effect Stream 适配器 — 使用 Effect Stream 管道替代 AsyncGenerator 链。
 *
 * 职责:
 *   - 将 StreamMiddlewarePipeline 转换为 Effect Stream 管道
 *   - 使用 Stream.tap / Stream.map / Stream.filter 实现中间件组合
 *   - 天然背压控制
 *
 * 通过配置项 useEffectMiddleware: true 启用，默认不启用。
 */
import { Effect, Stream } from "effect";
import type { LlmStreamEvent } from "@/api/core/llm";
import { type StreamMiddleware, type StreamMiddlewareContext, StreamMiddlewarePipeline } from "./streamMiddleware";
import { asyncIterableToStream, streamToAsyncIterable } from "@/conversation/core/llmStreamAdapter";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("stream:middleware:effect");

/**
 * 将中间件管道转换为 Effect Stream 管道操作。
 *
 * 每个中间件变为一个 Stream 转换函数：
 *   - tap 型中间件（如 logger）→ Stream.tap
 *   - map 型中间件（如 sensitive-word-filter）→ Stream.map
 *   - filter 型中间件（阻断）→ Stream.filter
 *
 * 由于中间件接口是通用的 handler(event, next, ctx)，
 * 统一用 Stream.flatMap 实现：每个中间件可以 yield 0~N 个事件。
 */
function middlewareToStreamOp(
  middleware: StreamMiddleware,
  context: StreamMiddlewareContext,
): <A extends LlmStreamEvent>(stream: Stream.Stream<A>) => Stream.Stream<A> {
  return (stream) =>
    Stream.flatMap(stream, (event) => {
      const events: LlmStreamEvent[] = [];
      return Stream.asyncPush<LlmStreamEvent>((emit) =>
        Effect.async<never, never, void>((resume) => {
          let cancelled = false;
          (async () => {
            try {
              const next = async function* (): AsyncGenerator<LlmStreamEvent | null> {
                yield event;
              };
              for await (const result of middleware.handler(event, next, context)) {
                if (cancelled) break;
                if (result !== null) {
                  events.push(result);
                  emit.single(result);
                }
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
    });
}

/**
 * 使用 Effect Stream 模式处理中间件管道。
 *
 * @param source 源 AsyncGenerator
 * @param pipeline 中间件管道
 * @param context 中间件上下文
 * @returns 处理后的 AsyncGenerator（保持接口兼容）
 */
export function processWithEffectStream(
  source: AsyncGenerator<LlmStreamEvent>,
  pipeline: StreamMiddlewarePipeline,
  context: StreamMiddlewareContext,
): AsyncGenerator<LlmStreamEvent> {
  const middlewares = pipeline.getMiddlewares();

  if (middlewares.length === 0) {
    return source;
  }

  // 转换为 Effect Stream
  let effectStream = asyncIterableToStream(source);

  // 逐个应用中间件
  for (const mw of middlewares) {
    effectStream = middlewareToStreamOp(mw, context)(effectStream);
  }

  // 转回 AsyncGenerator（保持接口兼容）
  const asyncIter = streamToAsyncIterable(effectStream);
  return (async function* () {
    for await (const event of asyncIter) {
      yield event;
    }
  })();
}

/**
 * 检查是否启用 Effect Stream 中间件模式。
 */
export function shouldUseEffectMiddleware(config?: { useEffectMiddleware?: boolean }): boolean {
  return config?.useEffectMiddleware === true;
}
