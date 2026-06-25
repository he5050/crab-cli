/**
 * CLI 错误处理模块 — 统一构造与输出 CLI 层的错误。
 *
 * 职责:
 *   - 包装底层 AppError 为 CliError
 *   - 提供带分类的 CLI 错误工厂
 *   - 提供统一的错误输出函数
 *
 * 模块功能:
 *   - createCliError: 创建 CLI 错误
 *   - writeCliError: 输出 CLI 错误
 *   - CliErrorKind: 错误分类
 */
import {
  AppError,
  createInternalError,
  createSystemError,
  createToolError,
  createUserError,
  toAppError,
} from "@/core/errors/appError";

export type CliErrorKind =
  | "invalid-parameter"
  | "invalid-path"
  | "resource-conflict"
  | "resource-not-found"
  | "unavailable"
  | "write-failed"
  | "internal";

export interface CliErrorOptions {
  kind: CliErrorKind;
  message: string;
  cause?: unknown;
  context?: Record<string, unknown>;
}

export function createCliError(options: CliErrorOptions): AppError {
  switch (options.kind) {
    case "invalid-parameter": {
      return createUserError("INVALID_PARAMETER", options.message, {
        cause: options.cause,
        context: options.context,
      });
    }
    case "invalid-path": {
      return createSystemError("INVALID_PATH", options.message, {
        cause: options.cause,
        context: options.context,
      });
    }
    case "resource-not-found": {
      return createUserError("RESOURCE_NOT_FOUND", options.message, {
        cause: options.cause,
        context: options.context,
      });
    }
    case "resource-conflict": {
      return createUserError("RESOURCE_EXISTS", options.message, {
        cause: options.cause,
        context: options.context,
      });
    }
    case "unavailable": {
      return createToolError("TOOL_UNAVAILABLE", options.message, {
        cause: options.cause,
        context: options.context,
      });
    }
    case "write-failed": {
      return createSystemError("FS_WRITE_ERROR", options.message, {
        cause: options.cause,
        context: options.context,
      });
    }
    case "internal": {
      return createInternalError("INTERNAL_ERROR", options.message, {
        cause: options.cause,
        context: options.context,
      });
    }
    default: {
      // 防御性兜底：新增 CliErrorKind 时 TS 类型收窄会提示此处不可达
      const exhaustive: never = options.kind;
      return createInternalError("INTERNAL_ERROR", `未处理的错误分类: ${exhaustive}`, {
        cause: options.cause,
        context: options.context,
      });
    }
  }
}

export function getCliErrorMessage(error: unknown): string {
  if (error instanceof AppError) {
    return error.message;
  }
  return toAppError(error).message;
}

export function formatCliError(error: unknown, options: { includeCause?: boolean } = {}): string {
  const appError = error instanceof AppError ? error : toAppError(error);
  const lines = [appError.toUserString()];
  if (options.includeCause && appError.cause) {
    lines.push(getCliErrorMessage(appError.cause));
  }
  return lines.join("\n");
}

export function writeCliError(
  error: unknown,
  options: { includeCause?: boolean; write?: (message: string) => void } = {},
): void {
  const write =
    options.write ??
    ((message: string) => {
      process.stderr.write(message);
    });
  write(`${formatCliError(error, { includeCause: options.includeCause })}\n`);
}

/**
 * 统一的错误退出函数 — 输出错误并终止进程。
 *
 * 用于替换分散的 writeCliError + process.exit() 模式，确保：
 * 1. 所有错误都通过标准格式输出
 * 2. 退出前有机会执行清理逻辑（由调用方决定）
 * 3. 代码更简洁，减少重复
 *
 * @param kind - 错误分类
 * @param message - 错误消息
 * @param context - 可选的上下文信息
 * @param exitCode - 退出码，默认 1
 */
export function exitWithError(
  kind: CliErrorKind,
  message: string,
  context?: Record<string, unknown>,
  exitCode: number = 1,
): never {
  writeCliError(createCliError({ kind, message, context }));
  process.exit(exitCode);
}
