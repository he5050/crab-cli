/**
 * 审批动作规范化 — 统一 boolean → ApprovalAction 的转换逻辑
 *
 * 职责:
 *   - 将 boolean 审批结果映射为语义明确的 ApprovalAction 枚举值
 *   - 作为 permission 子模块共享的规范化工具
 *
 * 模块功能:
 *   - normalizeApprovalAction: boolean | ApprovalAction → ApprovalAction
 */

import type { ApprovalAction } from "@/schema/permission";

/**
 * 将布尔值或 ApprovalAction 决策规范化为 ApprovalAction。
 *   - true  → "once"
 *   - false → "reject"
 *   - 其他值原样返回
 */
export function normalizeApprovalAction(decision: ApprovalAction | boolean): ApprovalAction {
  if (decision === true) {
    return "once";
  }
  if (decision === false) {
    return "reject";
  }
  return decision;
}
