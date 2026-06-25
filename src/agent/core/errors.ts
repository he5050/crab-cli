/**
 * Agent 错误模型 — 统一封装 Agent 层的错误信息与日志负载。
 */
import { AppError, createAgentError, createSystemError, createUserError } from "@/core/errors/appError";

/** Agent 错误原因分类 */
export type AgentErrorReason = "execution" | "fs_read" | "invalid_input" | "resource_missing";

/** Agent 错误上下文信息 */
export interface AgentErrorContext {
  /** 当前执行的操作名称 */
  operation: string;
  /** 关联的 Agent 名称 */
  agent?: string;
  /** 项目根路径 */
  rootPath?: string;
  /** 相关文件路径 */
  filePath?: string;
  /** 其他扩展字段 */
  [key: string]: unknown;
}

export function getAgentErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createAgentRuntimeError(
  error: unknown,
  context: AgentErrorContext,
  reason: AgentErrorReason = "execution",
): AppError {
  if (error instanceof AppError) {
    return error;
  }
  const message = getAgentErrorMessage(error);
  const cause = error instanceof Error ? error : undefined;
  const errorContext = {
    ...context,
    agentErrorReason: reason,
  };

  if (reason === "resource_missing") {
    return createUserError("RESOURCE_NOT_FOUND", message, { cause, context: errorContext });
  }
  if (reason === "invalid_input") {
    return createUserError("INVALID_INPUT", message, { cause, context: errorContext });
  }
  if (reason === "fs_read") {
    return createSystemError("FS_READ_ERROR", message, { cause, context: errorContext });
  }
  return createAgentError("AGENT_EXEC_ERROR", message, { cause, context: errorContext });
}

export function toAgentLogPayload(error: AppError): { error: string; errorCode: string } {
  return {
    error: error.message,
    errorCode: error.code,
  };
}
