/**
 * 服务端错误处理模块 — 统一封装 SSE/ACP/Headless 场景下的错误分类与日志载荷。
 *
 * 职责:
 *   - 根据错误场景分类(bad_request/delegate/headless/sse)映射为 AppError
 *   - 提供统一的错误消息提取与日志载荷生成
 *
 * 模块功能:
 *   - getServerErrorMessage(): 从 unknown 提取错误消息
 *   - createServerError(): 将任意错误包装为 AppError 并附加上下文
 *   - toServerLogPayload(): 生成结构化日志载荷
 *   - ServerErrorReason: 错误分类枚举
 *   - ServerErrorContext: 错误上下文类型
 *
 * 使用场景:
 *   - SSE / ACP / Headless 处理器在捕获异常时统一构造 AppError
 *   - 在结构化日志中输出标准化错误码与消息
 *
 * 边界:
 *   1. 不会重复包装已存在的 AppError
 *   2. 错误分类决定最终错误码(INVALID_INPUT / AGENT_EXEC_ERROR / INTERNAL_ERROR / UNKNOWN_ERROR)
 *   3. 日志载荷只包含 message 与 code，不含堆栈
 *
 * 流程:
 *   1. 接收原始错误与上下文
 *   2. 根据 reason 选择对应的错误码与工厂函数
 *   3. 返回带上下文与 cause 的 AppError
 *   4. 调用方使用 toServerLogPayload 输出日志
 */
import { AppError, createAgentError, createInternalError, createUserError } from "@/core/errors/appError";

export type ServerErrorReason = "bad_request" | "delegate" | "headless" | "sse";

export interface ServerErrorContext {
  operation: string;
  sessionId?: string;
  taskId?: string;
  route?: string;
  [key: string]: unknown;
}

export function getServerErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createServerError(
  error: unknown,
  context: ServerErrorContext,
  reason: ServerErrorReason = "sse",
): AppError {
  if (error instanceof AppError) {
    return error;
  }
  const message = getServerErrorMessage(error);
  const cause = error instanceof Error ? error : undefined;
  const errorContext = {
    ...context,
    serverErrorReason: reason,
  };

  if (reason === "bad_request") {
    return createUserError("INVALID_INPUT", message, { cause, context: errorContext });
  }
  if (reason === "headless") {
    return createAgentError("AGENT_EXEC_ERROR", message, { cause, context: errorContext });
  }
  if (reason === "delegate") {
    return createInternalError("INTERNAL_ERROR", message, { cause, context: errorContext });
  }
  return createInternalError("UNKNOWN_ERROR", message, { cause, context: errorContext });
}

export function toServerLogPayload(error: AppError): { error: string; errorCode: string } {
  return {
    error: error.message,
    errorCode: error.code,
  };
}
