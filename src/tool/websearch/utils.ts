/**
 * 搜索工具通用函数 — 常量、格式化、重试、截断。
 *
 * 职责:
 *   - 搜索相关常量(最大结果数、超时、重试配置)
 *   - 结果格式化输出
 *   - 截断占位(实际截断由 executor 层处理)
 *   - 指数退避重试包装器
 */

import { createLogger } from "@/core/logging/logger";

const log = createLogger("tool:websearch");

/** 默认最大结果数 */
export const DEFAULT_MAX_RESULTS = 10;

/** 默认请求超时(15 秒) */
export const REQUEST_TIMEOUT = 15_000;

/** 重试配置:最大重试次数 */
export const RETRY_MAX_ATTEMPTS = 3;

/** 重试配置:退避基数(毫秒) */
export const RETRY_BASE_DELAY = 1000;

/** 格式化搜索结果为可读文本 */
export function formatResults(results: { title: string; url: string; snippet?: string }[]): string {
  if (results.length === 0) {
    return "无搜索结果。";
  }

  return results.map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet ?? ""}`).join("\n\n");
}

/**
 * 截断占位 — 截断统一由 executor truncateByTokenLimit 处理，此处直接返回原文。
 */
/** truncateIfNeeded 的实现 */
export function truncateIfNeeded(content: string): string {
  return content;
}

/**
 * 带指数退避的重试包装器。
 * @param fn - 要执行的函数
 * @param engineName - 引擎名称(用于日志)
 * @returns 函数执行结果
 */
export async function withRetry<T>(fn: () => Promise<T | null>, engineName: string): Promise<T | null> {
  for (let attempt = 1; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
    try {
      const result = await fn();
      if (result !== null) {
        return result;
      }

      // 返回 null 表示该引擎不可用(如未配置 API Key)，不需要重试
      return null;
    } catch (error) {
      const isLastAttempt = attempt === RETRY_MAX_ATTEMPTS;
      const msg = error instanceof Error ? error.message : String(error);

      if (isLastAttempt) {
        log.warn(`${engineName} 搜索最终失败: ${msg}`);
        return null;
      }

      // 计算退避延迟:1s, 2s, 4s
      const delay = RETRY_BASE_DELAY * 2 ** (attempt - 1);
      log.debug(`${engineName} 搜索失败，${delay}ms 后重试 (${attempt}/${RETRY_MAX_ATTEMPTS}): ${msg}`);
      await sleep(delay);
    }
  }
  return null;
}

/** 异步等待指定毫秒 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
