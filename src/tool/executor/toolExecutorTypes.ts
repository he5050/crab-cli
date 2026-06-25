/**
 * 工具执行器类型定义 — 接口和类型导出。
 */
import type { ToolContext } from "../types";
import type { AppConfigSchema } from "@/schema/config";
import type {
  PermissionAction as SchemaPermissionAction,
  PermissionRule as SchemaPermissionRule,
} from "@/schema/permission";

/** 权限动作 — 与 @/schema/permission.PermissionAction 统一 */
export type PermissionAction = SchemaPermissionAction;

/**
 * 权限规则 — 与 @/schema/permission.PermissionRule 结构兼容（schema 为超集）。
 * 此处保留简化接口供内部匹配逻辑使用。
 */
/** PermissionRule */
export type PermissionRule = Pick<SchemaPermissionRule, "action" | "pattern" | "permission">;

/** 权限检查结果 */
export interface PermissionCheckResult {
  action: PermissionAction;
  matchedRule?: PermissionRule;
}

/** 工具执行结果 */
export interface ToolExecutionResult {
  success: boolean;
  output: unknown;
  error?: string;
  durationMs: number;
  toolName: string;
}

/** 工具执行器选项 */
export interface ToolExecutorOptions {
  /** 获取当前配置 */
  getConfig: () => AppConfigSchema;
  /** 工具执行超时(毫秒)，默认由 DEFAULT_TOOL_EXECUTION_TIMEOUT_MS(60000)兜底 */
  defaultTimeout?: number;
  /** 权限确认回调(用于 TUI 交互) */
  askPermission?: (toolName: string, args: Record<string, unknown>, rule?: PermissionRule) => Promise<boolean>;
  /** 构建工具执行上下文的回调 */
  getToolContext?: () => ToolContext;
}
