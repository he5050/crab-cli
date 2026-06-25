/**
 * 会话状态追踪 — idle/busy/retry/error 状态管理。
 *
 * 职责:
 *   - 跟踪会话的当前运行状态
 *   - 发布状态变更事件
 *   - 管理会话忙闲状态
 *
 * 模块功能:
 *   - getSessionStatus:获取会话的当前状态
 *   - setSessionStatus:设置会话状态并发布变更事件
 *   - isSessionBusy:检查会话是否忙碌
 *   - canAcceptInput:检查会话是否可以接受输入
 *   - clearSessionStatus:清除会话状态
 *   - getBusySessions:获取所有忙碌的会话
 *   - resetAllBusy:重置所有忙碌状态
 *
 * 使用场景:
 *   - 跟踪会话运行状态
 *   - 防止并发操作
 *   - 状态变更通知
 *
 * 边界:
 *   1. 纯状态管理，不涉及 UI 或对话逻辑
 *   2. 未记录的会话默认为 idle
 *   3. 状态存储在内存中
 *   4. 公开状态包含 idle/busy/waiting/retry/completed/cancelled/error
 *
 * 流程:
 *   1. 会话开始处理时设置为 busy
 *   2. 处理完成后设置为 idle
 *   3. LLM 降级或可恢复失败重试时设置为 retry
 *   4. 出错时设置为 error
 *   5. 状态变更时发布事件通知
 */
import { globalBus } from "@/bus";
import { AppEvent } from "@/bus";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("session:status");

// ─── 类型定义 ────────────────────────────────────────────────────

/** 会话运行状态
 *
 * 说明:
 *   - idle / busy / waiting / completed / error / cancelled: 由状态机驱动(通过 SessionStateManager)
 *   - retry: 由 sessionStatus 直接管理，用于 LLM 降级重试场景(不经过状态机)
 *   - failed: 保留向后兼容，新代码应使用 "error"
 */
export type SessionStatus = "idle" | "busy" | "retry" | "error" | "waiting" | "completed" | "failed" | "cancelled";

/** 状态变更事件载荷 */
export interface SessionStatusPayload {
  sessionId: string;
  status: SessionStatus;
  previousStatus: SessionStatus;
  reason?: string;
}

// ─── 状态管理 ────────────────────────────────────────────────────

/** 每个会话的当前状态(内存中维护) */
const sessionStatusMap = new Map<string, SessionStatus>();

/**
 * 获取会话的当前状态。
 * 未记录的会话默认为 idle。
 */
export function getSessionStatus(sessionId: string): SessionStatus {
  return sessionStatusMap.get(sessionId) ?? "idle";
}

/**
 * 设置会话状态并发布变更事件。
 *
 * @returns true 如果状态确实发生了变更
 */
export function setSessionStatus(sessionId: string, status: SessionStatus, reason?: string): boolean {
  const previous = getSessionStatus(sessionId);
  if (previous === status) {
    return false;
  }

  sessionStatusMap.set(sessionId, status);

  const payload: SessionStatusPayload = {
    previousStatus: previous,
    reason,
    sessionId,
    status,
  };

  globalBus.publish(AppEvent.SessionStatusChanged, payload);
  log.debug(`会话状态变更: ${sessionId.slice(0, 12)} ${previous} → ${status}${reason ? ` (${reason})` : ""}`);
  return true;
}

/**
 * 统一的运行态状态更新入口。
 * 新代码应优先使用它，而不是在 UI/命令层直接散写 setSessionStatus。
 */
export function syncRuntimeSessionStatus(sessionId: string, status: SessionStatus, reason?: string): boolean {
  return setSessionStatus(sessionId, status, reason);
}

/**
 * 检查会话是否处于工作中状态。
 */
export function isSessionBusy(sessionId: string): boolean {
  const status = getSessionStatus(sessionId);
  return status === "busy" || status === "waiting" || status === "retry";
}

/**
 * 检查会话是否可以接受新的用户输入。
 * 仅 idle 状态可以。
 */
export function canAcceptInput(sessionId: string): boolean {
  return getSessionStatus(sessionId) === "idle";
}

/**
 * 清除指定会话的状态记录。
 * 用于会话删除后的清理。
 */
export function clearSessionStatus(sessionId: string): void {
  sessionStatusMap.delete(sessionId);
}

/**
 * 清除所有会话状态记录。
 * 仅用于测试。
 */
export function _resetAllStatus(): void {
  sessionStatusMap.clear();
}

/**
 * 获取所有处于工作中状态的会话 ID 列表。
 */
export function getBusySessions(): string[] {
  const result: string[] = [];
  for (const [id, status] of sessionStatusMap) {
    if (status === "busy" || status === "waiting" || status === "retry") {
      result.push(id);
    }
  }
  return result;
}

export function resetAllBusy(): number {
  let count = 0;
  for (const [id, status] of sessionStatusMap) {
    if (status === "busy" || status === "retry") {
      setSessionStatus(id, "idle", "崩溃恢复");
      count++;
    }
  }
  if (count > 0) {
    log.info(`崩溃恢复: 重置 ${count} 个 working 会话为 idle`);
  }
  return count;
}
