/**
 * Agent 事件 — Agent 选择、状态变更、子代理生命周期、恢复检测。
 *
 * 职责:定义 Agent 域的事件契约。
 * 边界:不感知具体的 agent 配置;仅声明事件载荷形状。
 */
import { defineEvent } from "../core";

export const AgentEvents = {
  /** Agent 选择变更 */
  AgentSelected: defineEvent<{
    agentName: string;
    previousAgent?: string;
  }>("agent.selected"),

  /** Agent 状态变更(idle/thinking/running/completed/error) */
  AgentStatusChanged: defineEvent<{
    agentName: string;
    status: "idle" | "thinking" | "running" | "completed" | "error";
    previousStatus: string;
    reason?: string;
  }>("agent.status.changed"),

  /** 子代理启动 */
  SubagentStarted: defineEvent<{
    parentAgent: string;
    subagentName: string;
    taskId: string;
  }>("agent.subagent.started"),

  /** 子代理完成 */
  SubagentCompleted: defineEvent<{
    parentAgent: string;
    subagentName: string;
    taskId: string;
    success: boolean;
    durationMs?: number;
  }>("agent.subagent.completed"),

  /** 显示 Agent 选择器 */
  AgentPickerShow: defineEvent<Record<string, never>>("agent.picker.show"),

  /** Agent 可恢复会话检测 */
  AgentRecoveryDetected: defineEvent<{
    sessions: {
      sessionId: string;
      title: string;
      savedAt: number;
      status: string;
    }[];
  }>("agent.recovery.detected"),
} as const;
