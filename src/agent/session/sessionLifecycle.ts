/**
 * AgentSession 生命周期管理: 状态更新、子代理注销、销毁清理。
 *
 * 职责:
 *   - updateSessionStatus: 内部状态机更新
 *   - destroySession: 释放 handler + tracker + 子代理任务列表
 *
 * 边界:
 *   1. 本文件只做"清理/状态变更", 不执行任何业务逻辑
 *   2. 状态变更需通过 updateSessionStatus 走, 避免外部直接修改
 */
import { type AgentStatus, setAgentStatus } from "@/agent/core/manager";
import type { ConversationHandler } from "@/conversation";
import { subAgentTracker } from "@/agent/subagent/tracker";
import { createLogger } from "@/core/logging/logger";
import { createAgentError } from "@/core/errors/appError";
import type { SubagentTask } from "./types";

const log = createLogger("agent:session-lifecycle");

/** 合法状态转移矩阵 */
const VALID_TRANSITIONS: Record<AgentStatus, AgentStatus[]> = {
  completed: ["idle", "thinking"],
  error: ["idle", "thinking"],
  idle: ["thinking", "error"],
  running: ["completed", "error", "idle"],
  thinking: ["running", "error", "idle"],
};

/**
 * 更新 AgentSession 内部状态机.
 * 同状态短路返回, 不广播事件(状态对外可见由 manager.setAgentStatus 负责).
 * 拒绝非法状态转移.
 */
export function updateSessionStatus(
  current: AgentStatus,
  next: AgentStatus,
  agentName: string,
  reason?: string,
): AgentStatus {
  if (current === next) {
    return current;
  }
  const allowed = VALID_TRANSITIONS[current];
  if (!allowed.includes(next)) {
    throw createAgentError("AGENT_EXEC_ERROR", `非法状态转移: ${current} → ${next}${reason ? ` (${reason})` : ""}`, {
      context: { agentName, from: current, to: next },
    });
  }
  log.debug(`AgentSession ${agentName} 状态: ${current} → ${next}${reason ? ` (${reason})` : ""}`);
  return next;
}

/**
 * 销毁 AgentSession, 清理所有外部副作用.
 * 步骤:
 *   1. 销毁 ConversationHandler(取消进行中的请求, 释放会话状态)
 *   2. 清空子代理任务列表
 *   3. 注销所有 spawned children(tracker 维护)
 *   4. 注销自身 instance(若是子代理)
 */
export function destroySession(
  ctx: {
    agentName: string;
    handler: ConversationHandler;
    instanceId?: string;
    spawnedChildInstanceIds: Set<string>;
  },
  cleanup: {
    subagentTasks: SubagentTask[];
    updateStatus: (status: AgentStatus, reason?: string) => void;
  },
): void {
  ctx.handler.destroy();
  cleanup.updateStatus("idle", "Session 销毁");

  // 级联销毁运行中的子代理 session
  for (const task of cleanup.subagentTasks) {
    if (task.status === "running" && task.session) {
      try {
        task.session.destroy();
      } catch (err) {
        log.warn(`销毁子代理 session 失败: ${task.agentName}`, { error: String(err) });
      }
    }
  }
  cleanup.subagentTasks.length = 0;

  for (const childId of ctx.spawnedChildInstanceIds) {
    subAgentTracker.unregister(childId);
  }
  ctx.spawnedChildInstanceIds.clear();

  if (ctx.instanceId) {
    subAgentTracker.unregister(ctx.instanceId);
  }

  setAgentStatus(ctx.agentName, "idle", "Session 销毁");
  log.debug(`AgentSession 已销毁: ${ctx.agentName}`);
}
