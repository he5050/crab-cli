/**
 * MCP 错误处理模块 — 统一 MCP 相关异常的分类与构造。
 *
 * 职责:
 *   - 定义 MCP 错误原因枚举(McpErrorReason)
 *   - 将任意异常统一转换为 AppError
 *   - 按 reason 映射到不同错误码(RESOURCE_NOT_FOUND / TOOL_UNAVAILABLE 等)
 *
 * 模块功能:
 *   - createMcpError: 构造 MCP 标准化错误
 *   - getMcpErrorMessage: 从 unknown 提取 message
 *   - toMcpLogPayload: 提取日志用的最小负载
 *   - McpErrorReason: 错误原因枚举
 *   - McpErrorContext: 错误上下文(operation / serverName / transportType / url)
 *
 * 使用场景:
 *   - MCP Manager / Client / Transport 任意抛错时统一包装
 *   - 业务侧消费 AppError 时识别 MCP 子类型
 *
 * 边界:
 *   1. 不感知 UI/国际化文案
 *   2. 若传入已是 AppError，则原样返回不重包装
 *   3. reason 默认 "runtime"(兜底映射到 TOOL_EXEC_ERROR)
 *
 * 流程:
 *   1. 接收 unknown + McpErrorContext + reason
 *   2. 提取 message / cause
 *   3. 按 reason 路由到对应 create*Error 工厂
 *   4. 将 reason 写入 context.mcpErrorReason 返回 AppError
 */
import { AppError, createNetworkError, createToolError, createUserError } from "@/core/errors/appError";

export type McpErrorReason = "not_found" | "unsupported" | "network" | "runtime";

export interface McpErrorContext {
  operation: string;
  serverName?: string;
  transportType?: string;
  url?: string;
  [key: string]: unknown;
}

export function getMcpErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createMcpError(error: unknown, context: McpErrorContext, reason: McpErrorReason = "runtime"): AppError {
  if (error instanceof AppError) {
    return error;
  }
  const message = getMcpErrorMessage(error);
  const cause = error instanceof Error ? error : undefined;
  const errorContext = {
    ...context,
    mcpErrorReason: reason,
  };

  if (reason === "not_found") {
    return createUserError("RESOURCE_NOT_FOUND", message, { cause, context: errorContext });
  }
  if (reason === "unsupported") {
    return createToolError("TOOL_UNAVAILABLE", message, { cause, context: errorContext });
  }
  if (reason === "network") {
    return createNetworkError("CONNECTION_FAILED", message, { cause, context: errorContext });
  }
  return createToolError("TOOL_EXEC_ERROR", message, { cause, context: errorContext });
}

export function toMcpLogPayload(error: AppError): { error: string; errorCode: string } {
  return {
    error: error.message,
    errorCode: error.code,
  };
}
