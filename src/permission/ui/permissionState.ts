/**
 * 权限弹窗激活状态 — 跨组件共享的响应式信号
 *
 * 职责:
 *   - 管理权限弹窗的激活状态
 *   - 跨组件共享弹窗可见性状态
 *   - 协调键盘焦点释放，避免快捷键冲突
 *
 * 模块功能:
 *   - permissionActive: 权限弹窗激活状态信号
 *   - currentPermissionRequest: 当前权限请求快照
 *   - setPermissionActive: 设置权限弹窗激活状态
 *   - setCurrentPermissionRequest: 设置当前权限请求快照
 *
 * 使用场景:
 *   - PermissionDialog 组件显示时通知其他组件
 *   - 聊天输入框检测是否需要释放键盘焦点
 *   - 其他组件响应权限弹窗的显示状态
 *
 * 边界:
 * 1. 仅管理激活状态，不处理权限逻辑
 * 2. 基于 Solid.js 信号实现响应式更新
 * 3. 为 true 时其他组件应释放 Y/A/N/Esc 等快捷键焦点
 *
 * 流程:
 * 1. 权限请求触发时 setCurrentPermissionRequest(...) 和 setPermissionActive(true)
 * 2. PermissionDialog 接收状态显示弹窗
 * 3. 其他组件监听状态释放键盘焦点
 * 4. 审批完成后 setPermissionActive(false) 并清理请求快照
 */
import { createSignal } from "solid-js";

export type PermissionRiskLevel = "low" | "medium" | "high";

export interface PermissionRequestSnapshot {
  id: string;
  sessionId?: string;
  permission: string;
  tool: string;
  patterns?: string[];
  description?: string;
  riskLevel: PermissionRiskLevel;
  command: string;
}

export interface PermissionBlockedFeedbackModel {
  message: string;
  toolLine?: string;
  riskLine?: string;
  commandLine?: string;
  descriptionLine?: string;
  shortcutHint: string;
}

const RISK_LABELS: Record<PermissionRiskLevel, string> = {
  high: "高风险",
  low: "低风险",
  medium: "中风险",
};

const [permissionActive, setPermissionActiveSignal] = createSignal(false);
const [currentPermissionRequest, setCurrentPermissionRequestSignal] = createSignal<PermissionRequestSnapshot | null>(
  null,
);

export function buildPermissionRequestSnapshot(input: {
  id: string;
  sessionId?: string;
  permission: string;
  tool: string;
  patterns?: string[];
  description?: string;
  riskLevel?: PermissionRiskLevel;
}): PermissionRequestSnapshot {
  const patterns = input.patterns?.filter((item) => item.trim().length > 0);
  const command = `${input.permission} ${patterns?.join(" ") ?? ""}`.trim();
  return {
    command,
    description: input.description,
    id: input.id,
    patterns,
    permission: input.permission,
    riskLevel: input.riskLevel ?? "medium",
    sessionId: input.sessionId,
    tool: input.tool,
  };
}

export function setPermissionActive(active: boolean): void {
  setPermissionActiveSignal(active);
  if (!active) {
    setCurrentPermissionRequestSignal(null);
  }
}

export function setCurrentPermissionRequest(request: PermissionRequestSnapshot | null): void {
  setCurrentPermissionRequestSignal(request);
}

export function buildPermissionBlockedFeedback(
  request: PermissionRequestSnapshot | null,
): PermissionBlockedFeedbackModel {
  if (!request) {
    return {
      message: "权限请求处理中，请在权限弹窗中确认或拒绝。",
      shortcutHint: "快捷键: Y 允许一次 · A 始终允许 · N/Esc 拒绝",
    };
  }
  return {
    commandLine: request.command ? `命令: ${request.command}` : undefined,
    descriptionLine: request.description ? `说明: ${request.description}` : undefined,
    message: "权限请求处理中，请在权限弹窗中确认或拒绝。",
    riskLine: `风险: ${RISK_LABELS[request.riskLevel]}`,
    shortcutHint: "快捷键: Y 允许一次 · A 始终允许 · N/Esc 拒绝",
    toolLine: `工具: ${request.tool}`,
  };
}

export { permissionActive, currentPermissionRequest };
