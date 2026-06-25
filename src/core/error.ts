/**
 * 旧版错误兼容层。
 *
 * 新代码应直接从 `@core/errors/appError` 导入。
 * 本模块保留旧的 `@core/error` API 可用，同时将所有运行时错误路由到
 * 规范的 AppError 体系与 errorCodes 注册表。
 *
 * 注意: 本模块维护独立的 globalHandlers（通过 onError 注册），
 * 与 appError.ts 中的 onAppError 是两套独立的错误处理器。
 * throwError() 会同时触发两套处理器，确保兼容性。
 * 直接 throw AppError 时仅触发 onAppError 处理器。
 */

import { createLogger } from "@/core/logging/logger";
import { AppError, throwAppError, toAppError } from "@/core/errors/appError";
import { type ErrorDomain, type ErrorSeverity, getErrorCodeInfo } from "@/core/errors/errorCodes";

const log = createLogger("error:compat");

export type { ErrorDomain, ErrorSeverity };

export interface ErrorContext {
  sessionId?: string;
  userId?: string;
  operation?: string;
  filePath?: string;
  toolName?: string;
  [key: string]: unknown;
}

const LEGACY_CODE_MAP: Record<string, string> = {
  "AGENT-001": "AGENT-500",
  "AGENT-002": "AGENT-501",
  "AGENT-003": "AGENT-502",
  "CONFIG-001": "CONFIG-300",
  "CONFIG-002": "CONFIG-301",
  "CONFIG-003": "CONFIG-302",
  "INTERNAL-001": "INTERNAL-900",
  "INTERNAL-002": "INTERNAL-904",
  "SESSION-001": "SESSION-400",
  "SESSION-002": "SESSION-402",
  "SESSION-003": "SESSION-401",
  "SYSTEM-001": "SYSTEM-001",
  "SYSTEM-002": "SYSTEM-003",
  "SYSTEM-003": "NETWORK-100",
  "SYSTEM-004": "DATABASE-800",
  "TOOL-001": "TOOL-600",
  "TOOL-002": "TOOL-601",
  "TOOL-003": "TOOL-602",
  "USER-001": "USER-200",
  "USER-002": "USER-204",
  "USER-003": "USER-204",
};

function normalizeErrorCode(code: string): string {
  if (getErrorCodeInfo(code)) {
    return code;
  }
  return LEGACY_CODE_MAP[code] ?? code;
}

function inferDomain(code: string): ErrorDomain | undefined {
  const domain = code.split("-", 1)[0];
  switch (domain) {
    case "SYSTEM":
    case "NETWORK":
    case "USER":
    case "CONFIG":
    case "SESSION":
    case "AGENT":
    case "TOOL":
    case "SECURITY":
    case "DATABASE":
    case "INTERNAL": {
      return domain;
    }
    default: {
      return undefined;
    }
  }
}

export class CrabError extends AppError {
  constructor(
    code: string,
    message: string,
    options: {
      context?: ErrorContext;
      cause?: unknown;
      severity?: ErrorSeverity;
    } = {},
  ) {
    const normalizedCode = normalizeErrorCode(code);
    super(normalizedCode, message, {
      cause: options.cause,
      context: options.context,
      domain: inferDomain(normalizedCode),
      severity: options.severity,
    });
    this.name = "CrabError";
  }

  log(): void {
    const logFn = this.severity === "critical" || this.severity === "high" ? log.error : log.warn;
    logFn(`[${this.code}] ${this.message}`, {
      context: this.context,
      domain: this.domain,
      recoverable: this.isRecoverable(),
      severity: this.severity,
      suggestion: this.getSuggestion(),
    });
  }
}

export function systemError(code: string, message: string, context?: ErrorContext, cause?: unknown): CrabError {
  return new CrabError(code, message, { cause, context });
}

export function userError(code: string, message: string, context?: ErrorContext): CrabError {
  return new CrabError(code, message, { context });
}

export function agentError(code: string, message: string, context?: ErrorContext, cause?: unknown): CrabError {
  return new CrabError(code, message, { cause, context });
}

export function configError(code: string, message: string, context?: ErrorContext): CrabError {
  return new CrabError(code, message, { context });
}

export function sessionError(code: string, message: string, context?: ErrorContext): CrabError {
  return new CrabError(code, message, { context });
}

export function toolError(code: string, message: string, context?: ErrorContext, cause?: unknown): CrabError {
  return new CrabError(code, message, { cause, context });
}

type ErrorHandler = (error: CrabError) => void;
const globalHandlers: ErrorHandler[] = [];

export function onError(handler: ErrorHandler): () => void {
  globalHandlers.push(handler);
  return () => {
    const index = globalHandlers.indexOf(handler);
    if (index !== -1) {
      globalHandlers.splice(index, 1);
    }
  };
}

function notifyLegacyHandlers(error: CrabError): void {
  for (const handler of globalHandlers) {
    try {
      handler(error);
    } catch (error) {
      log.error(`全局错误处理器执行失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export function throwError(error: CrabError): never {
  notifyLegacyHandlers(error);
  return throwAppError(error);
}

export function safeExecute<T>(
  fn: () => T,
  options: {
    onError?: (error: CrabError) => void;
    fallback?: T;
    errorCode?: string;
    context?: ErrorContext;
  } = {},
): T | undefined {
  try {
    return fn();
  } catch (err) {
    const error = toCrabError(err, options.errorCode, options.context);
    error.log();
    options.onError?.(error);
    notifyLegacyHandlers(error);
    return options.fallback;
  }
}

export async function safeExecuteAsync<T>(
  fn: () => Promise<T>,
  options: {
    onError?: (error: CrabError) => void;
    fallback?: T;
    errorCode?: string;
    context?: ErrorContext;
  } = {},
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    const error = toCrabError(err, options.errorCode, options.context);
    error.log();
    options.onError?.(error);
    notifyLegacyHandlers(error);
    return options.fallback;
  }
}

export function toCrabError(err: unknown, defaultCode = "INTERNAL-900", context?: ErrorContext): CrabError {
  if (err instanceof CrabError) {
    return err;
  }

  if (err instanceof AppError) {
    return new CrabError(err.code, err.message, {
      cause: err.cause,
      context: { ...err.context, ...context },
      severity: err.severity,
    });
  }

  const appError = toAppError(err);
  const code = normalizeErrorCode(defaultCode);
  return new CrabError(code, appError.message, {
    cause: appError.cause,
    context: { ...appError.context, ...context },
    severity: appError.severity,
  });
}
