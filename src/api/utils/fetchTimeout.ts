/**
 * 带超时的 fetch 工具 — 统一 AbortController + setTimeout + clearTimeout 模式。
 *
 * 消除 embedding.ts、rerank.ts、providerHealth.ts 中重复的超时保护代码。
 *
 * 使用场景:
 *   - Provider API 调用的超时保护
 *   - 健康检查请求
 *   - 任何需要超时控制的 fetch 调用
 */

export interface FetchWithTimeoutOptions extends Omit<RequestInit, "signal"> {
  /** 超时时间（毫秒），默认 30_000 */
  timeoutMs?: number;
  /** 外部中止信号，会与内部超时信号组合（AbortSignal.any） */
  abortSignal?: AbortSignal;
}

/**
 * 带超时保护的 fetch 封装。
 *
 * - 超时时自动 abort 请求
 * - 支持外部 abortSignal 组合（任一信号触发即中止）
 * - 无论成功/失败/超时，都保证 clearTimeout
 *
 * @param url - 请求 URL
 * @param options - fetch 选项（含 timeoutMs 和可选 abortSignal）
 * @returns fetch Response
 */
export async function fetchWithTimeout(url: string, options: FetchWithTimeoutOptions = {}): Promise<Response> {
  const { timeoutMs = 30_000, abortSignal, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // 组合外部信号与内部超时信号
  const signal = abortSignal ? AbortSignal.any([abortSignal, controller.signal]) : controller.signal;

  try {
    return await fetch(url, { ...fetchOptions, signal });
  } finally {
    clearTimeout(timeoutId);
  }
}
