import { AppError, createToolError, createUserError } from "@/core/errors/appError";

/** 搜索工具名称枚举类型 */
export type SearchToolName = "grep" | "glob" | "apply-patch";

/** 搜索工具错误上下文信息 */
export interface SearchToolErrorContext {
  toolName: SearchToolName;
  operation: string;
  path?: string;
  pattern?: string;
  [key: string]: unknown;
}

/** 搜索工具错误结果描述 */
export interface SearchToolFailure {
  error: string;
  errorCode: string;
}

/** 创建搜索工具错误实例 @param error 原始错误 @param context 错误上下文 @param code 错误码 @returns AppError 实例 */
export function createSearchToolError(
  error: unknown,
  context: SearchToolErrorContext,
  code: "TOOL_EXEC_ERROR" | "TOOL_PARAM_ERROR" | "RESOURCE_NOT_FOUND" = "TOOL_EXEC_ERROR",
): AppError {
  if (error instanceof AppError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error ? error : undefined;
  const errorContext = {
    ...context,
    toolName: context.toolName,
  };

  if (code === "RESOURCE_NOT_FOUND") {
    return createUserError("RESOURCE_NOT_FOUND", message, { cause, context: errorContext });
  }
  if (code === "TOOL_PARAM_ERROR") {
    return createToolError("TOOL_PARAM_ERROR", message, { cause, context: errorContext });
  }
  return createToolError("TOOL_EXEC_ERROR", message, { cause, context: errorContext });
}

/** 将 AppError 转换为搜索工具错误结果 @param error 应用错误 @returns 搜索工具失败描述 */
export function toSearchToolFailure(error: AppError): SearchToolFailure {
  return {
    error: error.message,
    errorCode: error.code,
  };
}

/** 将未知错误转换为搜索工具 AppError @param error 原始错误 @param context 错误上下文 @returns AppError 实例 */
export function toSearchToolError(error: unknown, context: SearchToolErrorContext): AppError {
  return createSearchToolError(error, context);
}
