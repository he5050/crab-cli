/**
 * 工具执行策略评估模块 — 用于在执行前判定工具是否被策略禁用。
 *
 * 职责:
 *   - 判定给定工具是否属于 MCP 工具
 *   - 命中 MCP 工具禁用名单时返回拒绝决策及原因
 *
 * 模块功能:
 *   - evaluateToolExecutionPolicy: 评估工具是否可执行
 *   - ToolExecutionPolicyDecision: 决策结果(allowed + reason + message)
 *   - ToolExecutionPolicyInput: 评估入参(toolName + 可选 tool 定义)
 *   - ToolExecutionPolicyReason: 拒绝原因枚举
 *
 * 使用场景:
 *   - ToolExecutor 在执行前调用，识别 MCP 工具被用户配置禁用的情况
 *
 * 边界:
 *   1. 仅处理 MCP 工具；内置工具永远返回 allowed
 *   2. 内置工具与 MCP 工具的判定依据:permission 前缀 / builtin group
 *   3. 不感知 UI/审批流程；如需用户确认应在更上层处理
 *
 * 流程:
 *   1. 若入参不含 tool 定义，直接放行
 *   2. 判断是否为 MCP 工具:否 → 放行
 *   3. 是 MCP 工具:查 isMcpToolNameDisabled → 命中则拒绝
 *   4. 未命中放行
 */
import type { ToolPermissionInfo } from "../types";
import { getBuiltinGroupName, isMcpToolNameDisabled } from "../registry/toolRegistry";

/** 工具执行策略拒绝原因 */
export type ToolExecutionPolicyReason = "mcp_tool_disabled";

/** 工具执行策略决策结果 */
export interface ToolExecutionPolicyDecision {
  allowed: boolean;
  reason?: ToolExecutionPolicyReason;
  message?: string;
}

/** 工具执行策略评估入参 */
export interface ToolExecutionPolicyInput {
  toolName: string;
  tool?: ToolPermissionInfo;
}

/** 评估工具执行策略，判断工具是否被禁用 @param input 评估入参 @returns 决策结果 */
export function evaluateToolExecutionPolicy(input: ToolExecutionPolicyInput): ToolExecutionPolicyDecision {
  const { toolName, tool } = input;
  if (!tool || !isMcpTool(toolName, tool)) {
    return { allowed: true };
  }

  if (isMcpToolNameDisabled(toolName)) {
    return {
      allowed: false,
      message: `MCP tool "${toolName}" is disabled by settings`,
      reason: "mcp_tool_disabled",
    };
  }

  return { allowed: true };
}

function isMcpTool(toolName: string, tool: ToolPermissionInfo): boolean {
  // 路径 1: permission 前缀标识为 MCP 工具（标准判定）
  if (tool.permission === "mcp" || tool.permission.startsWith("mcp.")) {
    return true;
  }

  // 路径 2: 非内置工具且非内置命名空间 → 视为 MCP 工具
  // 注意：不再要求 isMcpToolNameDisabled 作为 MCP 身份的前置条件，
  // 否则未在禁用列表中的 MCP 工具将绕过禁用检查。
  return getBuiltinGroupName(toolName) === null;
}
