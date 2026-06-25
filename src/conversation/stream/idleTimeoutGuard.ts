/**
 * 流式空闲超时守卫(Idle Timeout Guard)— 检测 LLM 流响应中的空闲间隔。
 *
 * 职责:
 *   - 监控流式响应的数据接收间隔
 *   - 超时后执行中断回调
 *   - 支持手动销毁
 *
 * 模块功能:
 *   - createIdleTimeoutGuard(): 创建空闲超时守卫实例
 *
 * 使用场景:
 *   - LLM 流式响应监控
 *   - Provider 挂起检测
 *   - 网络连接健康检查
 *
 * 边界:
 * 1. 创建后立即启动计时器
 * 2. 调用 touch() 重置计时器
 * 3. 调用 destroy() 可提前销毁
 *
 * 流程:
 * 1. 创建守卫，启动计时器
 * 2. 每次收到数据调用 touch() 重置计时器
 * 3. 计时器到期未收到数据，执行 onTimeout 回调
 */

import { createLogger } from "@/core/logging/logger";

const log = createLogger("conversation:stream");

export interface IdleTimeoutGuard {
  /** 收到新数据时调用，重置空闲计时器 */
  touch(): void;
  /** 销毁守卫，清除计时器 */
  destroy(): void;
}

/**
 * 创建流式空闲超时守卫。
 *
 * 工作原理:
 * 1. 创建后立即启动计时器
 * 2. 每次调用 touch() 重置计时器
 * 3. 若计时器到期未收到新数据，执行 onTimeout 回调
 * 4. 调用 destroy() 可提前销毁
 *
 * @param timeoutMs - 空闲超时阈值(毫秒)，默认 60000 (60s)
 * @param onTimeout - 超时回调
 * @returns IdleTimeoutGuard 实例
 */
export function createIdleTimeoutGuard(timeoutMs: number = 60_000, onTimeout: () => void): IdleTimeoutGuard {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  const reset = (): void => {
    if (destroyed) {
      return;
    }
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      if (!destroyed) {
        onTimeout();
      }
    }, timeoutMs);
  };

  reset();

  return {
    destroy() {
      destroyed = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
    touch() {
      if (destroyed) {
        log.debug("IdleTimeoutGuard.touch() 已在 destroy 后调用，忽略");
        return;
      }
      reset();
    },
  };
}
