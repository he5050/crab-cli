import { createLogger } from "@/core/logging/logger";
import { toAppError } from "@/core/errors/appError";

const log = createLogger("config:errors");

export function getConfigErrorMessage(error: unknown): string {
  return toAppError(error).message;
}

export function logConfigDebugFailure(message: string, error: unknown, context: Record<string, unknown> = {}): void {
  const appError = toAppError(error);
  log.debug(message, {
    ...context,
    error: appError.message,
    errorCode: appError.code,
  });
}

export function logConfigWarnFailure(message: string, error: unknown, context: Record<string, unknown> = {}): void {
  const appError = toAppError(error);
  log.warn(message, {
    ...context,
    error: appError.message,
    errorCode: appError.code,
  });
}
