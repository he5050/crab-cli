/**
 * IDE 错误处理模块 — 统一 IDE 相关异常的分类与构造。
 *
 * 职责:
 *   - 定义 IDE 错误原因枚举(IdeErrorReason)
 *   - 将任意异常统一转换为 AppError
 *   - 按 reason 映射到不同错误码
 *
 * 模块功能:
 *   - createIdeError: 构造 IDE 标准化错误
 *   - getIdeErrorMessage: 从 unknown 提取 message
 *   - toIdeLogPayload: 提取日志用的最小负载
 *   - IdeErrorReason: 错误原因枚举
 *   - IdeErrorContext: 错误上下文(operation / clientId / requestType)
 *
 * 使用场景:
 *   - wsServer / IDE 连接模块在抛错时统一包装
 *   - 业务侧消费 AppError 时识别 IDE 子类型
 *
 * 边界:
 *   1. 不感知 UI/国际化文案
 *   2. 若传入已是 AppError，则原样返回不重包装
 *   3. reason 默认 "handler"(兜底映射到 INTERNAL_ERROR)
 *
 * 流程:
 *   1. 接收 unknown + IdeErrorContext + reason
 *   2. 提取 message / cause
 *   3. 按 reason 路由到对应 create*Error 工厂
 *   4. 将 reason 写入 context.ideErrorReason 返回 AppError
 */
import { AppError, createInternalError, createUserError } from "@/core/errors/appError";

export type IdeErrorReason = "callback" | "client_missing" | "handler" | "unsupported_request";

export interface IdeErrorContext {
  operation: string;
  clientId?: string;
  requestType?: string;
  [key: string]: unknown;
}

export function getIdeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createIdeError(error: unknown, context: IdeErrorContext, reason: IdeErrorReason = "handler"): AppError {
  if (error instanceof AppError) {
    return error;
  }
  const message = getIdeErrorMessage(error);
  const cause = error instanceof Error ? error : undefined;
  const errorContext = {
    ...context,
    ideErrorReason: reason,
  };

  if (reason === "client_missing") {
    return createUserError("RESOURCE_NOT_FOUND", message, { cause, context: errorContext });
  }
  if (reason === "unsupported_request") {
    return createUserError("INVALID_PARAMETER", message, { cause, context: errorContext });
  }
  return createInternalError("INTERNAL_ERROR", message, { cause, context: errorContext });
}

export function toIdeLogPayload(error: AppError): { error: string; errorCode: string } {
  return {
    error: error.message,
    errorCode: error.code,
  };
}
