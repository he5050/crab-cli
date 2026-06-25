/**
 * 任务管理事件 — Task 生命周期与 Goal 状态。
 *
 * 职责:任务创建、状态变更、Goal 状态同步。
 * 边界:Task 与 Goal 形状保持轻量,详细结构由订阅方按需断言。
 */
import { defineEvent } from "../core";

export const TaskEvents = {
  /** 任务创建 */
  TaskCreated: defineEvent<{
    id: string;
    prompt?: string;
    status?: string;
  }>("task.created"),

  /** 任务状态变更 */
  TaskStatusChanged: defineEvent<{
    id: string;
    status?: string;
    error?: string;
  }>("task.status.changed"),

  /** Goal 状态变更 */
  GoalStatusChanged: defineEvent<{
    id: string;
    sessionId: string;
    status?: string;
  }>("goal.status.changed"),

  /** 显示任务管理面板 */
  TaskPanelShow: defineEvent<Record<string, never>>("task.panel.show"),
} as const;
