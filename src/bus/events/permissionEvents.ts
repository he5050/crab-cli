/**
 * 权限相关事件定义。
 *
 * 职责:
 *   - 集中定义权限请求/响应/状态变更事件
 *   - 提供类型安全的事件载荷
 *
 * 事件清单:
 *   - PermissionAsked: 权限请求发起
 *   - PermissionResolved: 权限响应(用户决策)
 *   - PermissionStatus: 只读状态同步(用于协作/远程观察)
 *
 * 使用场景:
 *   - 权限 UI 监听 PermissionAsked 展示审批弹窗
 *   - 审计/日志模块记录所有权限决策
 *   - 协作场景下只读同步权限状态
 */
import { defineEvent } from "../core";

export const PermissionEvents = {
  /** 权限请求 */
  PermissionAsked: defineEvent<{
    id: string;
    sessionId?: string;
    permission: string;
    tool: string;
    patterns?: string[];
    description?: string;
    riskLevel?: "low" | "medium" | "high";
  }>("permission.asked"),

  /** 权限响应 */
  PermissionResolved: defineEvent<{
    id: string;
    sessionId?: string;
    allowed: boolean;
    action?: "once" | "always" | "reject";
  }>("permission.resolved"),

  /** 权限只读状态变更(用于协作/远程观察，不代表远程可审批) */
  PermissionStatus: defineEvent<{
    id: string;
    sessionId: string;
    permission: string;
    tool: string;
    status: "resolved";
    allowed: boolean;
    action: "once" | "always" | "reject";
  }>("permission.status"),
} as const;
