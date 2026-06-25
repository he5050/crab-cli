/**
 * 代码库搜索错误模块 — 统一错误入口。
 *
 * 本文件是 codebaseSearch 子系统的错误处理统一入口:
 *   - 上半部分: CodebaseSearch 通用错误（exec/param/remote/unavailable）
 *   - 下半部分: re-export SearchTool 专用错误（grep/glob/apply-patch）
 *
 * ⚠️ SearchToolError 定义在 searchToolErrors.ts 中，通过本文件 re-export，
 * 外部消费者应统一从 "./errors" 导入，不要直接引用 searchToolErrors.ts。
 */
import { AppError, createNetworkError, createToolError } from "@/core/errors/appError";

/** 代码库搜索错误原因枚举 */
export type CodebaseSearchErrorReason = "exec" | "param" | "remote" | "unavailable";

/** 代码库搜索错误上下文信息 */
export interface CodebaseSearchErrorContext {
  operation: string;
  query?: string;
  mode?: string;
  path?: string;
  include?: string;
  [key: string]: unknown;
}

/** 代码库搜索错误结果描述 */
export interface CodebaseSearchFailure {
  error: string;
  errorCode: string;
}

/** 从未知错误中提取消息字符串 @param error 原始错误 @returns 错误消息字符串 */
export function getCodebaseSearchErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 创建代码库搜索错误实例 @param error 原始错误 @param context 错误上下文 @param reason 错误原因 @returns AppError 实例 */
export function createCodebaseSearchError(
  error: unknown,
  context: CodebaseSearchErrorContext,
  reason: CodebaseSearchErrorReason = "exec",
): AppError {
  if (error instanceof AppError) {
    return error;
  }
  const message = getCodebaseSearchErrorMessage(error);
  const cause = error instanceof Error ? error : undefined;
  const errorContext = {
    ...context,
    searchErrorReason: reason,
    toolName: "codebase-search",
  };

  if (reason === "param") {
    return createToolError("TOOL_PARAM_ERROR", message, { cause, context: errorContext });
  }
  if (reason === "remote") {
    return createNetworkError("CONNECTION_FAILED", message, { cause, context: errorContext });
  }
  if (reason === "unavailable") {
    return createToolError("TOOL_UNAVAILABLE", message, { cause, context: errorContext });
  }
  return createToolError("TOOL_EXEC_ERROR", message, { cause, context: errorContext });
}

/** 将 AppError 转换为代码库搜索错误结果 @param error 应用错误 @returns 搜索失败描述 */
export function toCodebaseSearchFailure(error: AppError): CodebaseSearchFailure {
  return {
    error: error.message,
    errorCode: error.code,
  };
}

// ─── Re-export from searchToolErrors (merged from tool/search/) ──
export {
  createSearchToolError,
  toSearchToolFailure,
  type SearchToolErrorContext,
  type SearchToolFailure,
} from "./searchToolErrors";
