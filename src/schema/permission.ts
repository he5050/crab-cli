/**
 * 权限规则 Schema
 *
 * 职责:
 *   - 定义权限动作和规则的验证结构
 *   - 支持 allow/deny/ask 三种权限动作
 *
 * 模块功能:
 *   - 定义权限动作枚举(PermissionAction):allow、deny、ask
 *   - 定义权限规则 Schema(PermissionRule):permission、pattern、action、metadata
 *   - 定义权限规则集 Schema(PermissionRuleset):权限规则数组
 *   - 定义权限决策结果枚举(PermissionDecision):approved、denied、pending
 *
 * 使用场景:
 *   - 验证权限配置文件
 *   - 定义工具调用的权限规则
 *   - 评估权限请求并返回决策结果
 *   - Agent 执行前的权限检查
 *
 * 边界:
 *   1. 仅定义 schema，不涉及规则评估逻辑
 *   2. 权限评估由外部模块实现
 *   3. 使用 Zod 进行运行时类型验证
 *
 * 术语说明:
 *   - PermissionAction: 规则层动作 (allow/deny/ask)，用于权限规则定义和评估
 *   - ApprovalAction:  交互层动作 (once/always/reject)，用于用户审批操作
 *   - PermissionDecision: [已废弃] 决策结果枚举，建议使用 PermissionAction 替代
 *
 * 流程:
 *   1. 定义权限动作枚举(allow/deny/ask)
 *   2. 定义权限规则结构(permission、pattern、action)
 *   3. 定义权限规则集(规则数组)
 *   4. 定义权限决策结果(approved/denied/pending)
 */
import { z } from "zod";

/** 权限动作 */
export const PermissionAction = z.enum(["allow", "deny", "ask"]);
export type PermissionAction = z.infer<typeof PermissionAction>;

/** 权限规则 Schema */
export const PermissionRule = z.object({
  action: PermissionAction,
  /** 用户可读描述（用于配置文件和 UI 展示） */
  description: z.string().optional(),
  /** 程序化元数据（运行时扩展用） */
  metadata: z.record(z.string(), z.unknown()).optional(),
  pattern: z.string().min(1, "匹配模式不能为空"),
  permission: z.string().min(1),
});
export type PermissionRule = z.infer<typeof PermissionRule>;

/** 权限规则集 */
export const PermissionRuleset = z.array(PermissionRule);
export type PermissionRuleset = z.infer<typeof PermissionRuleset>;

/**
 * @deprecated 建议使用 PermissionAction 替代。
 *   - PermissionDecision.denied  <-> PermissionAction.deny
 *   - PermissionDecision.pending <-> PermissionAction.ask
 *   - PermissionDecision.approved <-> PermissionAction.allow
 * 保留此定义仅为向后兼容（外部消费者可能依赖）。
 */
export const PermissionDecision = z.enum(["approved", "denied", "pending"]);
/** @deprecated 建议使用 PermissionAction 替代。 */
export type PermissionDecision = z.infer<typeof PermissionDecision>;

/**
 * 审批动作 — 用户对权限请求的交互决策。
 * 与 PermissionAction(规则层 allow/deny/ask) 的区别:
 *   - ApprovalAction 用于 UI 交互层（用户点击"允许一次"/"始终允许"/"拒绝"）
 *   - PermissionAction 用于规则评估层（规则定义 allow/deny/ask）
 */
export const ApprovalAction = z.enum(["once", "always", "reject"]);
export type ApprovalAction = z.infer<typeof ApprovalAction>;
