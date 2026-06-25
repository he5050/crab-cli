/**
 * Promise 工具函数集。
 *
 * 职责:
 *   - 提供通用的 Promise 增强功能
 *   - 支持超时控制
 *   - 支持 AbortSignal 取消
 *
 * 模块功能:
 *   - withTimeout: 带超时的 Promise 包装
 *   - withTimeoutAndSignal: 带超时和 AbortSignal 的 Promise 包装
 *
 * 使用场景:
 *   - 需要超时控制的异步操作
 *   - 支持取消的异步任务
 *   - 防止 Promise 永久挂起
 *
 * 边界:
 *   1. 纯工具函数，不依赖业务逻辑
 *   2. 超时使用 setTimeout 实现
 *   3. 取消依赖 AbortSignal API
 *
 * 流程:
 *   1. 接收原始 Promise 和超时配置
 *   2. 创建超时定时器
 *   3. 监听 AbortSignal(如提供)
 *   4. Promise 完成时清理定时器和 listener
 *   5. 超时或取消时拒绝 Promise
 */

/**
 * 带超时的 Promise 包装。
 *
 * @param promise - 原始 Promise
 * @param ms - 超时时间(毫秒)
 * @param message - 超时错误信息
 * @returns 包装后的 Promise
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * 带超时和 AbortSignal 的 Promise 包装。
 *
 * @param promise - 原始 Promise
 * @param ms - 超时时间(毫秒)
 * @param signal - 可选的 AbortSignal
 * @param message - 超时错误信息
 * @returns 包装后的 Promise
 */
export function withTimeoutAndSignal<T>(
  promise: Promise<T>,
  ms: number,
  signal?: AbortSignal,
  message?: string,
): Promise<T> {
  // 先检查信号是否已中止(避免竞态:先设 timer 再检查 signal)
  if (signal?.aborted) {
    return Promise.reject(new Error("Operation was aborted"));
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(message ?? `Operation timed out after ${ms}ms`));
    }, ms);

    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Operation was aborted"));
    };

    const cleanup = () => {
      clearTimeout(timer);
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    };

    signal?.addEventListener("abort", onAbort, { once: true });

    promise.then(
      (v) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(v);
      },
      (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );
  });
}
