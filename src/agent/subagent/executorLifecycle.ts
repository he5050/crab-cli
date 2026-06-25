/**
 * 子代理执行器 - 生命周期管理: Watchdog 集成 + 强制终止.
 *
 * 职责:
 *   - 启动/停止 Watchdog(总超时控制)
 *   - 强制终止时通过 EventBus 广播事件
 *   - 终止原因与状态机
 *
 * 边界:
 *   1. 不直接管理 SubAgentExecutor 内部状态
 *   2. Watchdog 与 abortController 配套使用, 触发后立即 abort
 */
import { createLogger } from "@/core/logging/logger";
import type { Watchdog } from "@/agent/runtime/watchdog";
import { createTimeoutHandler, createWatchdog } from "@/agent/runtime/watchdog";
import { globalBus } from "@/bus/core/eventBus";
import { EVENT_SUBAGENT_FORCED_TERMINATE, EVENT_SUBAGENT_WATCHDOG_TIMEOUT } from "@/config";
import type { SubAgentTask } from "./types";

const log = createLogger("agent:sub-agent-executor-lifecycle");

/**
 * EventBus 发布接口 — 用于依赖注入测试。
 * 避免直接依赖 globalBus 单例。
 */
export interface EventBusPublisher {
  publish<T>(event: { type: string }, payload: T): void;
}

/** 默认使用全局 EventBus */
let _eventBus: EventBusPublisher | null = null;

function getEventBus(): EventBusPublisher {
  return _eventBus ?? globalBus;
}

/**
 * 设置自定义 EventBus（测试用）。
 */
export function __setEventBusForTesting(bus: EventBusPublisher): void {
  _eventBus = bus;
}

/**
 * 重置为全局 EventBus（测试用）。
 */
export function __resetEventBusForTesting(): void {
  _eventBus = null;
}

/**
 * 强制终止状态: 用于在错误处理路径中区分"主动终止"与"普通异常".
 */
export interface TerminationState {
  isForced: boolean;
  reason: string;
}

/**
 * 发送强制终止事件到 UI 层.
 * 调用后, 监听 EVENT_SUBAGENT_FORCED_TERMINATE 的消费者会收到任务快照.
 */
export function sendForcedTerminateEvent(tasks: Map<string, SubAgentTask>, reason: string): TerminationState {
  log.error(`发送强制终止事件: ${reason}`);

  getEventBus().publish(
    { type: EVENT_SUBAGENT_FORCED_TERMINATE },
    {
      executorId: "executor",
      reason,
      tasks: [...tasks.values()].map((t) => ({
        completedAt: t.completedAt,
        id: t.id,
        startedAt: t.startedAt,
        status: t.status,
      })),
      timestamp: Date.now(),
    },
  );

  return { isForced: true, reason };
}

/**
 * 启动总超时 Watchdog.
 * 超时触发: 广播强制终止 + abort 主流程.
 *
 * @returns 启动后的 Watchdog 实例(调用方负责销毁)
 */
export function startTotalTimeoutWatchdog(totalTimeoutMs: number, onTimeout: (reason: string) => void): Watchdog {
  const timeoutHandler = createTimeoutHandler("executor", (_taskId, reason) => {
    onTimeout(reason);
  });
  return createWatchdog({
    onTimeout: timeoutHandler,
    taskId: "executor",
    timeoutMs: totalTimeoutMs,
  });
}

/**
 * 停止并清理 Watchdog.
 * cancel() 也会调用, 以保证"无悬挂 timer".
 */
export function stopWatchdog(watchdog: Watchdog | null): null {
  if (watchdog) {
    try {
      watchdog.stop();
      watchdog.destroy();
    } catch (error) {
      log.warn(`停止 Watchdog 时出错: ${String(error)}`);
    }
  }
  return null;
}

/**
 * 发送 Watchdog 超时事件(用于上层观测总执行时长).
 */
export function publishWatchdogTimeoutEvent(elapsedMs: number, reason: string, _startTime: number): void {
  getEventBus().publish(
    { type: EVENT_SUBAGENT_WATCHDOG_TIMEOUT },
    {
      elapsedMs,
      executorId: "executor",
      reason,
      timestamp: Date.now(),
    },
  );
}
