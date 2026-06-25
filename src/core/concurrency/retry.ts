/**
 * 重试工具 — 支持指数退避。
 *
 * 职责:
 *   - 为异步操作提供自动重试能力
 *   - 支持指数退避策略
 *   - 支持自定义重试条件
 *
 * 模块功能:
 *   - retry: 带指数退避的重试执行
 *   - RetryOptions: 重试选项接口
 *
 * 使用场景:
 *   - 网络请求失败重试
 *   - API 调用重试
 *   - 不稳定服务调用
 *
 * 边界:
 *   1. 纯重试逻辑，不涉及具体业务
 *   2. 默认最大重试 3 次
 *   3. 支持自定义退避策略
 *
 * 流程:
 *   1. 执行目标函数
 *   2. 失败时检查是否可重试
 *   3. 计算退避延迟
 *   4. 等待后重试
 *   5. 达到最大重试次数后抛出错误
 */

import { createLogger } from "@/core/logging/logger";
import { DEFAULT_MAX_RETRIES, DEFAULT_RETRY_DELAY_MS, MAX_RETRY_DELAY_MS } from "@/config";
const log = createLogger("retry");

export interface RetryOptions {
  /** 最大重试次数，默认 3 */
  maxRetries?: number;
  /** 初始延迟(毫秒)，默认 1000 */
  initialDelay?: number;
  /** 退避倍数，默认 2 */
  backoffMultiplier?: number;
  /** 最大延迟(毫秒)，默认 30000 */
  maxDelay?: number;
  /** 判断是否可重试的错误检查 */
  retryable?: (err: unknown) => boolean;
}

/**
 * 带指数退避的重试执行。
 *
 * @param fn - 要执行的异步函数
 * @param options - 重试选项
 * @returns 函数返回值
 *
 * @example
 * const data = await retry(() => fetch(url), { maxRetries: 3 });
 */
export async function retry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    maxRetries = DEFAULT_MAX_RETRIES,
    initialDelay = DEFAULT_RETRY_DELAY_MS,
    backoffMultiplier = 2,
    maxDelay = MAX_RETRY_DELAY_MS,
    retryable,
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // 最后一次尝试不等待
      if (attempt === maxRetries) {
        break;
      }

      // 检查是否可重试
      if (retryable && !retryable(error)) {
        break;
      }

      // 计算延迟
      const delay = Math.min(initialDelay * backoffMultiplier ** attempt, maxDelay);

      log.debug(
        `重试第 ${attempt + 1}/${maxRetries} 次，等待 ${delay}ms: ${error instanceof Error ? error.message : String(error)}`,
      );
      await Bun.sleep(delay);
    }
  }

  throw lastError ?? new Error("Retry failed with no error captured");
}
