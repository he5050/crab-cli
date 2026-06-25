/**
 * UI 错误日志工具 — 统一转换 Error 并写入 Debug/Warn 通道。
 *
 * 职责:
 *   - 将任意错误对象转换为标准化的 AppError 日志元数据
 *   - 简化 UI 层的错误日志输出
 *
 * 模块功能:
 *   - toUiFailureLogData: 提取 error/errorCode 并合并上下文
 *   - logUiDebugFailure: Debug 级别日志
 *   - logUiWarnFailure: Warn 级别日志
 */
import { toAppError } from "@/core/errors/appError";
import { type LogMetadata, createLogger } from "@/core/logging/logger";

export function toUiFailureLogData(error: unknown, context: Record<string, unknown> = {}): LogMetadata {
  const appError = toAppError(error);
  return {
    ...context,
    error: appError.message,
    errorCode: appError.code,
  };
}

export function logUiDebugFailure(
  service: string,
  message: string,
  error: unknown,
  context: Record<string, unknown> = {},
): void {
  createLogger(service).debug(message, toUiFailureLogData(error, context));
}

export function logUiWarnFailure(
  service: string,
  message: string,
  error: unknown,
  context: Record<string, unknown> = {},
): void {
  createLogger(service).warn(message, toUiFailureLogData(error, context));
}
