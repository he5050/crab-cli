/**
 * 应用程序错误 — 错误类的统一基类和工厂函数。
 *
 * 职责:
 *   - 定义应用程序错误基类 AppError
 *   - 提供错误工厂函数
 *   - 错误序列化和反序列化
 *
 * 错误层级:
 *   - AppError (基类)
 *     - SystemError
 *     - UserError
 *     - AgentError
 *     - ConfigError
 *     - SessionError
 *     - ToolError
 *     - SecurityError
 *
 * 使用场景:
 *   - 所有业务错误应使用 AppError 或其子类
 *   - 统一错误处理和日志记录
 *
 * 边界:
 *   1. 不处理系统级未处理异常
 *   2. 错误码必须在 errorCodes.ts 中定义
 */

import { createLogger } from "@/core/logging/logger";
import { ERROR_CODES, type ErrorCode, type ErrorDomain, type ErrorSeverity, getErrorCodeInfo } from "./errorCodes";

const log = createLogger("error:app");

// ─── AppError 基类 ─────────────────────────────────────────────────

/**
 * 应用程序错误基类
 */
export class AppError extends Error {
  /** 错误码 */
  readonly code: string;
  /** 错误域 */
  readonly domain: ErrorDomain;
  /** 严重级别 */
  readonly severity: ErrorSeverity;
  /** 原始错误 */
  override readonly cause?: unknown;
  /** 错误上下文 */
  readonly context: Record<string, unknown>;
  /** 是否可恢复 */
  readonly recoverable: boolean;
  /** 错误时间戳 */
  readonly timestamp: number;

  constructor(
    code: string,
    message: string,
    options: {
      domain?: ErrorDomain;
      severity?: ErrorSeverity;
      cause?: unknown;
      context?: Record<string, unknown>;
      recoverable?: boolean;
    } = {},
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.timestamp = Date.now();

    // 获取错误码信息
    const codeInfo = getErrorCodeInfo(code);
    if (codeInfo) {
      this.domain = codeInfo.code.split("-")[0] as ErrorDomain;
      this.severity = codeInfo.severity;
    } else {
      this.domain = options.domain ?? "INTERNAL";
      this.severity = options.severity ?? "medium";
    }

    this.cause = options.cause;
    this.context = options.context ?? {};
    this.recoverable = options.recoverable ?? this.defaultRecoverable();

    // 捕获堆栈
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * 默认是否可恢复
   */
  private defaultRecoverable(): boolean {
    return this.severity === "low" || this.severity === "medium";
  }

  /**
   * 是否可恢复
   */
  isRecoverable(): boolean {
    return this.recoverable;
  }

  /**
   * 获取恢复建议
   */
  getSuggestion(): string | undefined {
    // 根据错误码返回建议
    const suggestions: Record<string, string> = {
      "AGENT-500": "请增加超时时间或重试",
      "AGENT-505": "请等待熔断器恢复后重试",
      "CONFIG-300": "请检查配置文件",
      "SESSION-400": "请重新创建会话",
      "SESSION-401": "请检查会话状态",
      "SESSION-402": "请重新创建会话",
      "TOOL-600": "请检查工具名称是否正确",
    };
    return suggestions[this.code];
  }

  /**
   * 转为 JSON 对象
   */
  toJSON(): Record<string, unknown> {
    return {
      cause: this.cause instanceof Error ? this.cause.message : this.cause,
      code: this.code,
      context: this.context,
      domain: this.domain,
      message: this.message,
      name: this.name,
      recoverable: this.recoverable,
      severity: this.severity,
      stack: this.stack,
      timestamp: this.timestamp,
    };
  }

  /**
   * 转为用户友好字符串
   */
  toUserString(): string {
    const suggestion = this.getSuggestion();
    let result = `[${this.code}] ${this.message}`;
    if (suggestion) {
      result += ` (建议: ${suggestion})`;
    }
    return result;
  }
}

// ─── 子类错误 ─────────────────────────────────────────────────

export class SystemError extends AppError {
  constructor(code: string, message: string, options?: ConstructorParameters<typeof AppError>[2]) {
    super(code, message, { ...options, domain: "SYSTEM" });
    this.name = "SystemError";
  }
}

export class NetworkError extends AppError {
  constructor(code: string, message: string, options?: ConstructorParameters<typeof AppError>[2]) {
    super(code, message, { ...options, domain: "NETWORK" });
    this.name = "NetworkError";
  }
}

export class UserError extends AppError {
  constructor(code: string, message: string, options?: ConstructorParameters<typeof AppError>[2]) {
    super(code, message, { ...options, domain: "USER" });
    this.name = "UserError";
  }
}

export class ConfigError extends AppError {
  constructor(code: string, message: string, options?: ConstructorParameters<typeof AppError>[2]) {
    super(code, message, { ...options, domain: "CONFIG" });
    this.name = "ConfigError";
  }
}

export class SessionError extends AppError {
  constructor(code: string, message: string, options?: ConstructorParameters<typeof AppError>[2]) {
    super(code, message, { ...options, domain: "SESSION" });
    this.name = "SessionError";
  }
}

export class AgentError extends AppError {
  constructor(code: string, message: string, options?: ConstructorParameters<typeof AppError>[2]) {
    super(code, message, { ...options, domain: "AGENT" });
    this.name = "AgentError";
  }
}

export class ToolError extends AppError {
  constructor(code: string, message: string, options?: ConstructorParameters<typeof AppError>[2]) {
    super(code, message, { ...options, domain: "TOOL" });
    this.name = "ToolError";
  }
}

export class SecurityError extends AppError {
  constructor(code: string, message: string, options?: ConstructorParameters<typeof AppError>[2]) {
    super(code, message, { ...options, domain: "SECURITY" });
    this.name = "SecurityError";
  }
}

export class DatabaseError extends AppError {
  constructor(code: string, message: string, options?: ConstructorParameters<typeof AppError>[2]) {
    super(code, message, { ...options, domain: "DATABASE" });
    this.name = "DatabaseError";
  }
}

export class InternalError extends AppError {
  constructor(code: string, message: string, options?: ConstructorParameters<typeof AppError>[2]) {
    super(code, message, { ...options, domain: "INTERNAL" });
    this.name = "InternalError";
  }
}

// ─── 错误工厂函数 ─────────────────────────────────────────────────

/**
 * 创建系统错误
 */
export function createSystemError(
  code: keyof (typeof ERROR_CODES)["SYSTEM"],
  message?: string,
  options?: { cause?: unknown; context?: Record<string, unknown> },
): SystemError {
  const info = ERROR_CODES.SYSTEM[code];
  return new SystemError(info.code, message ?? info.message, {
    severity: info.severity,
    ...options,
  });
}

/**
 * 创建网络错误
 */
export function createNetworkError(
  code: keyof (typeof ERROR_CODES)["NETWORK"],
  message?: string,
  options?: { cause?: unknown; context?: Record<string, unknown> },
): NetworkError {
  const info = ERROR_CODES.NETWORK[code];
  return new NetworkError(info.code, message ?? info.message, {
    severity: info.severity,
    ...options,
  });
}

/**
 * 创建用户错误
 */
export function createUserError(
  code: keyof (typeof ERROR_CODES)["USER"],
  message?: string,
  options?: { cause?: unknown; context?: Record<string, unknown> },
): UserError {
  const info = ERROR_CODES.USER[code];
  return new UserError(info.code, message ?? info.message, {
    severity: info.severity,
    ...options,
  });
}

/**
 * 创建配置错误
 */
export function createConfigError(
  code: keyof (typeof ERROR_CODES)["CONFIG"],
  message?: string,
  options?: { cause?: unknown; context?: Record<string, unknown> },
): ConfigError {
  const info = ERROR_CODES.CONFIG[code];
  return new ConfigError(info.code, message ?? info.message, {
    severity: info.severity,
    ...options,
  });
}

/**
 * 创建会话错误
 */
export function createSessionError(
  code: keyof (typeof ERROR_CODES)["SESSION"],
  message?: string,
  options?: { cause?: unknown; context?: Record<string, unknown> },
): SessionError {
  const info = ERROR_CODES.SESSION[code];
  return new SessionError(info.code, message ?? info.message, {
    severity: info.severity,
    ...options,
  });
}

/**
 * 创建 Agent 错误
 */
export function createAgentError(
  code: keyof (typeof ERROR_CODES)["AGENT"],
  message?: string,
  options?: { cause?: unknown; context?: Record<string, unknown> },
): AgentError {
  const info = ERROR_CODES.AGENT[code];
  return new AgentError(info.code, message ?? info.message, {
    severity: info.severity,
    ...options,
  });
}

/**
 * 创建工具错误
 */
export function createToolError(
  code: keyof (typeof ERROR_CODES)["TOOL"],
  message?: string,
  options?: { cause?: unknown; context?: Record<string, unknown> },
): ToolError {
  const info = ERROR_CODES.TOOL[code];
  return new ToolError(info.code, message ?? info.message, {
    severity: info.severity,
    ...options,
  });
}

/**
 * 创建安全错误
 */
export function createSecurityError(
  code: keyof (typeof ERROR_CODES)["SECURITY"],
  message?: string,
  options?: { cause?: unknown; context?: Record<string, unknown> },
): SecurityError {
  const info = ERROR_CODES.SECURITY[code];
  return new SecurityError(info.code, message ?? info.message, {
    severity: info.severity,
    ...options,
  });
}

/**
 * 创建数据库错误
 */
export function createDatabaseError(
  code: keyof (typeof ERROR_CODES)["DATABASE"],
  message?: string,
  options?: { cause?: unknown; context?: Record<string, unknown> },
): DatabaseError {
  const info = ERROR_CODES.DATABASE[code];
  return new DatabaseError(info.code, message ?? info.message, {
    severity: info.severity,
    ...options,
  });
}

/**
 * 创建内部错误
 */
export function createInternalError(
  code: keyof (typeof ERROR_CODES)["INTERNAL"],
  message?: string,
  options?: { cause?: unknown; context?: Record<string, unknown> },
): InternalError {
  const info = ERROR_CODES.INTERNAL[code];
  return new InternalError(info.code, message ?? info.message, {
    severity: info.severity,
    ...options,
  });
}

// ─── 全局错误处理 ─────────────────────────────────────────────────

/**
 * 全局错误处理器
 */
type GlobalErrorHandler = (error: AppError) => void;
const handlers: GlobalErrorHandler[] = [];

/**
 * 注册全局错误处理器
 */
export function onAppError(handler: GlobalErrorHandler): () => void {
  handlers.push(handler);
  return () => {
    const index = handlers.indexOf(handler);
    if (index !== -1) {
      handlers.splice(index, 1);
    }
  };
}

/**
 * 抛出并记录错误
 */
export function throwAppError(error: AppError): never {
  log.error(`[${error.code}] ${error.message}`, error.context);
  for (const handler of handlers) {
    try {
      handler(error);
    } catch {
      // 忽略处理器错误
    }
  }
  throw error;
}

// ─── 错误转换 ─────────────────────────────────────────────────

/**
 * 转换任意错误为 AppError
 */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    return new InternalError("INTERNAL-904", error.message, { cause: error });
  }

  return new InternalError("INTERNAL-904", String(error));
}
