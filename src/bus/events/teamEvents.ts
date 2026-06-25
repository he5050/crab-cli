/**
 * Team 多代理协作事件 — 队友生命周期与消息流。
 *
 * 职责:定义 Team 模块对外的事件契约。
 */
import { defineEvent } from "../core";

export const TeamEvents = {
  /** Team: 队友已创建 */
  TeamMateSpawned: defineEvent<{
    teammateId: string;
    name: string;
    role: string;
    task: string;
    worktreePath?: string;
  }>("team.mate.spawned"),

  /** Team: 队友状态变更 */
  TeamMateStatusChanged: defineEvent<{
    teammateId: string;
    name: string;
    oldStatus: string;
    newStatus: string;
    result?: string;
    error?: string;
  }>("team.mate.status.changed"),

  /** Team: 队友消息 */
  TeamMateMessage: defineEvent<{
    teammateId: string;
    message: string;
    from: string;
  }>("team.mate.message"),

  /** Team: 显示 Team 面板 */
  TeamPanelShow: defineEvent<Record<string, never>>("team.panel.show"),
} as const;
