/**
 * 流式读取空闲超时保护
 *
 */

// ─── 常量 ──────────────────────────────────────────────────

/** 默认空闲超时 3 分钟 */
export const STREAM_IDLE_TIMEOUT_MS = 180_000;

// ─── 错误类型 ───────────────────────────────────────────────

/** 流空闲超时错误 — 包含 [RETRIABLE] 标记 */
export class StreamIdleTimeoutError extends Error {
  readonly idleMs: number;

  constructor(message: string, idleMs: number = STREAM_IDLE_TIMEOUT_MS) {
    super(`[RETRIABLE] Stream idle timeout: ${message}`);
    this.name = "StreamIdleTimeoutError";
    this.idleMs = idleMs;
  }
}

// ─── Guard 接口 ──────────────────────────────────────────────────

export interface StreamGuard {
  /** 标记为已放弃（手动中断或超时后） */
  abandon: () => void;
  /** 是否已放弃 */
  isAbandoned: () => boolean;
  /** 获取超时错误（供流读取循环结束后抛出） */
  getTimeoutError: () => Error | null;
  /** 触摸（重置空闲计时器） */
  touch: () => void;
  /** 释放资源 */
  dispose: () => void;
}

// ─── 工厂函数 ──────────────────────────────────────────────────

export interface IdleTimeoutGuardOptions {
  /** 可取消的 reader，用于超时时清理 */
  reader?: { cancel(): Promise<void> };
  /** 超时回调（可选） */
  onTimeout?: () => void;
  /** 空闲超时毫秒数 */
  idleTimeoutMs?: number;
}

export function createIdleTimeoutGuard(options: IdleTimeoutGuardOptions = {}): StreamGuard {
  let isAbandoned = false;
  let lastChunkTime = Date.now();
  let idleTimer: ReturnType<typeof setInterval> | null = null;
  let timeoutError: Error | null = null;
  const idleTimeoutMs = options.idleTimeoutMs ?? STREAM_IDLE_TIMEOUT_MS;

  // 每 5 秒检查一次空闲
  idleTimer = setInterval(() => {
    try {
      if (isAbandoned) return;
      if (Date.now() - lastChunkTime <= idleTimeoutMs) return;

      // 超时！
      isAbandoned = true;

      if (!timeoutError) {
        timeoutError = new StreamIdleTimeoutError(`No data received for ${idleTimeoutMs}ms`, idleTimeoutMs);
      }

      // 尝试取消 reader
      try {
        options.reader?.cancel().catch(() => {});
      } catch {}

      // 调用方自定义超时错误
      if (options.onTimeout) {
        try {
          options.onTimeout();
        } catch (error) {
          timeoutError = error instanceof Error ? error : new Error(String(error));
        }
      }
    } catch (error) {
      isAbandoned = true;
      if (!timeoutError) {
        timeoutError = error instanceof Error ? error : new Error(String(error));
      }
      try {
        options.reader?.cancel().catch(() => {});
      } catch {}
    }
  }, 5_000);

  return {
    abandon: () => {
      isAbandoned = true;
      try {
        options.reader?.cancel().catch(() => {});
      } catch {}
    },
    isAbandoned: () => isAbandoned,
    getTimeoutError: () => timeoutError,
    touch: () => {
      lastChunkTime = Date.now();
    },
    dispose: () => {
      if (idleTimer) {
        clearInterval(idleTimer);
        idleTimer = null;
      }
    },
  };
}
