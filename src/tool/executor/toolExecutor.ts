/**
 * 工具执行器模块 — 统一的工具调用入口
 *
 * 职责:
 *   - 权限检查(基于配置的 permission rules)
 *   - 参数验证(Zod schema)
 *   - 执行工具并处理结果
 *   - 超时控制
 *   - 敏感命令检测
 *
 * 模块功能:
 *   - ToolExecutor: 工具执行器类
 *   - execute: 执行指定工具
 *   - checkPermission: 检查工具权限
 *   - searchTools: 模糊搜索工具
 *   - isSensitiveCall: 检测敏感命令
 *   - PermissionAction: 权限动作类型
 *   - PermissionRule: 权限规则接口
 *   - PermissionCheckResult: 权限检查结果接口
 *   - ToolExecutionResult: 工具执行结果接口
 *   - ToolExecutorOptions: 工具执行器选项接口
 *
 * 使用场景:
 *   - AI 调用工具时统一入口
 *   - 权限控制和验证
 *   - 工具执行超时管理
 *   - 敏感命令拦截
 *
 * 边界:
 *   1. 只能执行已注册的工具
 *   2. 权限检查基于配置文件规则
 *   3. 默认超时由 DEFAULT_TOOL_EXECUTION_TIMEOUT_MS 定义(60 秒)
 *   4. 参数必须符合 Zod schema
 *   5. 敏感命令需要用户确认
 *
 * 流程:
 *   1. 创建 ToolExecutor 实例
 *   2. 调用 execute 执行工具
 *   3. 查找工具
 *   4. 检查工具权限
 *   5. 检测敏感命令
 *   6. 验证工具参数
 *   7. 执行工具函数
 *   8. 处理输出截断
 *   9. 返回执行结果
 */
import { getRegisteredTools } from "../registry/toolRegistry";
import type { ToolDefinition, ToolPermissionInfo } from "../types";
export { checkCommandInjection, isSensitiveCall } from "./toolExecutorSafety";
/** re-export */
export type { CommandInjectionCheckResult } from "./toolExecutorSafety";
/** re-export */
export type {
  PermissionAction,
  PermissionCheckResult,
  ToolExecutionResult,
  ToolExecutorOptions,
  PermissionRule,
} from "./toolExecutorTypes";
import type {
  PermissionRule,
  PermissionCheckResult,
  ToolExecutionResult,
  ToolExecutorOptions,
} from "./toolExecutorTypes";
import { executeTool, checkPermission as checkPermissionImpl } from "./toolExecute";

// ── 工具搜索(re-export from toolSearch) ─────────────────────────
export { searchTools } from "./toolSearch";

/**
 * 工具执行器 — 统一调度工具调用
 */
/** ToolExecutor */
export class ToolExecutor {
  private readonly options: ToolExecutorOptions;

  constructor(options: ToolExecutorOptions) {
    this.options = options;
  }

  /**
   * 执行工具
   * 1. 查找工具
   * 2. 权限检查
   * 3. 敏感命令检测
   * 4. 参数验证
   * 5. 执行并返回结果
   */
  async execute(
    toolName: string,
    args: Record<string, unknown>,
    options?: { timeout?: number; signal?: AbortSignal },
  ): Promise<ToolExecutionResult> {
    return executeTool(toolName, args, this.options, options);
  }

  /**
   * 检查工具权限
   */
  checkPermission(tool: ToolPermissionInfo, args: Record<string, unknown>): PermissionCheckResult {
    return checkPermissionImpl(this.options, tool, args);
  }

  /**
   * 查找已注册的工具
   */
  findTool(name: string): ToolDefinition<any> | undefined {
    const tools = getRegisteredTools();
    return tools[name];
  }

  /**
   * 列出所有已注册工具的名称
   */
  listToolNames(): string[] {
    const tools = getRegisteredTools();
    return Object.keys(tools);
  }
}
