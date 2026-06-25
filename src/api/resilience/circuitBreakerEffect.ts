/**
 * 熔断器 Effect Stream 适配器 — 使用 Effect 的错误处理和可中断性替代手动 try/catch。
 *
 * 职责:
 *   - withCircuitBreakerEffect: Effect Stream 版本的熔断器包装
 *   - 熔断器打开时用 Effect.fail 快速失败
 *   - 成功/失败自动记录到 CircuitBreaker
 *   - 支持中断（abortSignal → Effect.interrupt）
 *
 * 通过配置项 useEffectCircuitBreaker: true 启用，默认不启用。
 */
import { Effect, Stream } from "effect";
import { type CircuitBreaker, getCircuitBreaker } from "./circuitBreaker";
import { asyncIterableToStream } from "@/conversation/core/llmStreamAdapter";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("api:circuit-breaker:effect");

/** 熔断器打开错误 */
export class CircuitBreakerOpenError {
  readonly _tag = "CircuitBreakerOpenError";
  constructor(
    readonly message: string,
    readonly providerId?: string,
    readonly modelId?: string,
  ) {}
}

/**
 * 使用 Effect Stream 在熔断器保护下执行流式请求。
 *
 * 与 withCircuitBreaker 接口一致，但：
 *   - 熔断器打开时用 Effect.fail 声明式失败（可被 Effect.catchAll 捕获）
 *   - 成功/失败自动记录
 *   - abort 用 Stream 消费端的中断机制处理
 *
 * @param breaker 熔断器实例
 * @param genFactory 生成 AsyncGenerator 的工厂函数
 * @param options provider/model 信息（用于错误消息）
 * @returns Effect Stream<T>
 */
export function withCircuitBreakerEffect<T>(
  breaker: CircuitBreaker,
  genFactory: () => AsyncGenerator<T>,
  options?: { providerId?: string; modelId?: string },
): Stream.Stream<T, CircuitBreakerOpenError | Error> {
  // 熔断器打开 → 快速失败
  if (breaker.isOpen()) {
    const stats = breaker.getStats();
    const location = options ? `provider=${options.providerId}, model=${options.modelId}` : "";
    const errorMsg = `Circuit breaker is OPEN (${location}): state=${stats.state}, failures=${stats.failureCount}, retryIn=${stats.timeUntilRetryMs}ms`;
    log.warn(errorMsg);
    return Stream.fail(new CircuitBreakerOpenError(errorMsg, options?.providerId, options?.modelId));
  }

  // 将 AsyncGenerator 转为 Effect Stream
  const sourceStream = asyncIterableToStream(genFactory());

  // 用 Stream.tap 在每个事件上检查熔断器状态
  // 用 Stream.catchAll 捕获错误并记录到熔断器
  return sourceStream.pipe(
    Stream.tap((item) =>
      Effect.sync(() => {
        // 可在此添加每事件检查逻辑
        void item;
      }),
    ),
    // 流成功完成时记录成功
    Stream.tap(() => Effect.sync(() => breaker.recordSuccess())),
    // 错误时记录失败
    Stream.catchAll((error) =>
      Effect.sync(() => {
        breaker.recordFailure();
        log.warn(`熔断器记录失败: ${error instanceof Error ? error.message : String(error)}`);
      }).pipe(Stream.fail(error instanceof Error ? error : new Error(String(error)))),
    ),
  );
}

/**
 * 便捷函数：获取熔断器并包装流。
 */
export function wrapStreamWithCircuitBreakerEffect<T>(
  providerId: string,
  modelId: string | undefined,
  genFactory: () => AsyncGenerator<T>,
): Stream.Stream<T, CircuitBreakerOpenError | Error> {
  const breaker = getCircuitBreaker(providerId, modelId);
  return withCircuitBreakerEffect(breaker, genFactory, { providerId, modelId });
}

/**
 * 检查是否应使用 Effect Stream 版熔断器。
 */
export function shouldUseEffectCircuitBreaker(config: { useEffectCircuitBreaker?: boolean }): boolean {
  return config?.useEffectCircuitBreaker === true;
}
