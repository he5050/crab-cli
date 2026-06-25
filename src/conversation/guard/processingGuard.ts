/**
 * ProcessingGuard — 对话处理锁与超时守护。
 *
 * 设计目标:替换 ConversationHandler 中自建的 _processing 布尔 + setTimeout 模式。
 * 当前状态:已被 ConversationHandler 组合使用。
 *
 * 解决 P1-3 问题:_processing 锁异常时潜在死锁
 *
 * 职责:
 *   1. 互斥:同一时间只允许一个处理流程
 *   2. 超时:超过 PROCESSING_TIMEOUT_MS 自动释放(5 分钟)
 *   3. 中止感知:abortSignal 触发时立即释放
 *   4. 错误隔离:try-finally 保证异常路径也释放锁
 *
 * 使用场景:
 *   - ConversationHandler.sendMessage 入口处的并发控制
 *   - 任何需要"单实例处理"语义的异步操作
 *
 * 边界:
 *   1. 不感知具体业务逻辑，仅是互斥原语
 *   2. 超时是兜底机制，正常流程应主动调用 release()
 *   3. acquire 失败时立即抛错，不重试
 */

import { InternalError } from "@/core/errors/appError";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("conversation:guard");

export interface ProcessingGuardOptions {
  /** 超时毫秒(默认 5 分钟) */
  timeoutMs?: number;
  /** 锁名称(用于日志) */
  name?: string;
}

export class ProcessingGuard {
  private busy = false;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private abortHandler: (() => void) | null = null;
  /** 绑定的 AbortSignal 引用，用于 unbind 时移除监听器 */
  private boundSignal: AbortSignal | null = null;
  private readonly timeoutMs: number;
  private readonly name: string;

  constructor(options: ProcessingGuardOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
    this.name = options.name ?? "processing";
  }

  /**
   * 尝试获取锁
   * @throws Error 如果锁已被持有
   */
  acquire(abortSignal?: AbortSignal): void {
    if (this.busy) {
      throw new InternalError("INTERNAL-902", `ProcessingGuard "${this.name}" 已被持有，无法 acquire`);
    }
    if (abortSignal?.aborted) {
      throw new InternalError("INTERNAL-902", `ProcessingGuard "${this.name}" 中止信号已触发，无法 acquire`);
    }

    this.busy = true;
    this.startTimeout();
    this.bindAbort(abortSignal);
  }

  /**
   * 释放锁
   */
  release(): void {
    this.clearTimeout();
    this.unbindAbort();
    this.busy = false;
  }

  /**
   * 是否忙碌
   */
  isBusy(): boolean {
    return this.busy;
  }

  /**
   * 强制重置(紧急恢复，慎用)
   */
  forceReset(): void {
    this.release();
  }

  private startTimeout(): void {
    this.timeoutHandle = setTimeout(() => {
      log.warn(`ProcessingGuard "${this.name}" 超时(${this.timeoutMs}ms)，自动释放锁`);
      this.release();
    }, this.timeoutMs);
  }

  private clearTimeout(): void {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
  }

  private bindAbort(signal?: AbortSignal): void {
    if (!signal) {
      return;
    }
    this.boundSignal = signal;
    this.abortHandler = () => this.release();
    if (signal.aborted) {
      this.abortHandler();
    } else {
      signal.addEventListener("abort", this.abortHandler, { once: true });
    }
  }

  private unbindAbort(): void {
    if (this.boundSignal && this.abortHandler) {
      this.boundSignal.removeEventListener("abort", this.abortHandler);
    }
    this.boundSignal = null;
    this.abortHandler = null;
  }
}
