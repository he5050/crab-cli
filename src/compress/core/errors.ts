/**
 * 压缩错误处理模块 — 集中描述压缩失败原因与上下文。
 *
 * 职责:
 *   - 区分压缩失败原因(消息过少/空结果/异常)
 *   - 为压缩失败提供结构化错误载荷
 *
 * 模块功能:
 *   - CompressionErrorReason: 失败原因枚举
 *   - CompressionErrorContext: 错误上下文
 *   - CompressionFailure: 错误载荷
 */
import type { AppError } from "@/core/errors/appError";
import { createInternalError, createUserError } from "@/core/errors/appError";
import type { CompactStrategyKind } from "../types";

export type CompressionErrorReason = "too_few_messages" | "empty_result" | "exception";

export interface CompressionErrorContext {
  sessionId: string;
  strategy?: CompactStrategyKind;
  messageCount?: number;
  tokensBefore?: number;
  [key: string]: unknown;
}

export interface CompressionFailure {
  error: string;
  errorCode: string;
}

export function createCompressionError(
  reason: CompressionErrorReason,
  message: string,
  context: CompressionErrorContext,
  cause?: unknown,
): AppError {
  const options = {
    cause,
    context: {
      ...context,
      compressionReason: reason,
    },
  };

  if (reason === "too_few_messages") {
    return createUserError("INVALID_INPUT", message, options);
  }
  if (reason === "empty_result") {
    return createInternalError("STATE_INCONSISTENT", message, options);
  }
  return createInternalError("UNKNOWN_ERROR", message, options);
}

export function toCompressionFailure(error: AppError): CompressionFailure {
  return {
    error: error.message,
    errorCode: error.code,
  };
}
