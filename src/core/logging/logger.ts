/**
 * Logger — 日志系统。
 *
 * 职责:
 *   - 输出分级日志(debug/info/warn/error)
 *   - 写入内存缓冲供 TUI 状态栏读取
 *   - 持久化到文件
 *
 * 模块功能:
 *   - createLogger: 创建日志记录器
 *   - log.debug/info/warn/error: 分级日志输出
 *   - flushLogSync: 同步刷新日志
 *   - getLogBuffer: 获取日志缓冲区
 *
 * 使用场景:
 *   - 应用日志记录
 *   - 调试信息输出
 *   - 错误追踪
 *   - TUI 状态栏显示
 *
 * 边界:
 *   1. 仅负责日志记录和缓冲，不负责日志传输
 *   2. error 级别同步写入，其他级别异步写入
 *   3. Dev 模式最小级别为 debug，生产模式为 info
 *
 * 流程:
 *   1. 创建 logger 实例
 *   2. 调用分级方法记录日志
 *   3. 写入内存缓冲区
 *   4. 异步/同步写入文件
 *   5. 触发事件通知 TUI
 *
 * 写入策略:
 *   - error 级别:同步写入文件(确保不丢失)
 *   - info/warn/debug:异步写入(queueMicrotask，不阻塞主流程)
 *   - 文件存储已由 log-store.ts 在模块加载时初始化
 *
 * 模式差异:
 *   Dev 模式(CRAB_DEV=1):控制台和文件最小级别均为 debug
 *   生产模式:控制台最小级别 info，文件最小级别 info
 */
import { LOG_BUFFER_SIZE } from "@/config";
import { createId } from "@/core/identity";
import { appendLogEntry, appendLogEntryAsync } from "@/core/logging/logStore";
import { isDevMode } from "@/config/isDevMode";

// `var` avoids TDZ crashes when circular imports emit logs before this module finishes evaluating.
var loggerInitialized = false;

// ── 敏感数据脱敏 ───────────────────────────────────────────────
// 日志中需要遮蔽的敏感字段(值将被替换为 "***")。
const SENSITIVE_FIELD_PATTERNS =
  /\b(api[_-]?key|apikey|api[_-]?secret|secret[_-]?key|token|password|passwd|authorization|bearer|credentials)\b/i;

/**
 * 递归地对结构化对象中的敏感字段值进行脱敏。
 * 匹配字段的值替换为 "***"，保留键名和非敏感字段原值。
 * 不处理文件路径、行号、数字等非敏感值。
 */
function redactSensitiveFields(obj: unknown, depth = 0): unknown {
  if (depth > 10 || obj === null || obj === undefined) {
    return obj;
  }
  if (typeof obj === "string") {
    return obj;
  } // 原始字符串不参与字段匹配
  if (typeof obj !== "object") {
    return obj;
  } // 数字、布尔等基础类型直接透传

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSensitiveFields(item, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof value === "string" && SENSITIVE_FIELD_PATTERNS.test(key)) {
      result[key] = value.length > 0 ? "***" : "";
    } else {
      result[key] = redactSensitiveFields(value, depth + 1);
    }
  }
  return result;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogMetadata {
  eventType?: string;
  sessionId?: string;
  turnId?: string;
  requestId?: string;
  parentRequestId?: string;
  providerId?: string;
  modelId?: string;
  requestMethod?: string;
  fallbackFrom?: string;
  fallbackTo?: string;
  toolCallId?: string;
  success?: boolean;
  durationMs?: number;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

/** 日志条目 */
export interface LogEntry {
  id: string;
  level: LogLevel;
  message: string;
  service?: string;
  timestamp: number;
  eventType?: string;
  sessionId?: string;
  turnId?: string;
  requestId?: string;
  parentRequestId?: string;
  providerId?: string;
  modelId?: string;
  requestMethod?: string;
  fallbackFrom?: string;
  fallbackTo?: string;
  toolCallId?: string;
  success?: boolean;
  durationMs?: number;
  payload?: Record<string, unknown>;
}

/** 内存日志缓冲区(供 TUI 读取最近日志) */
const logBuffer: LogEntry[] = [];
const MAX_BUFFER_SIZE = LOG_BUFFER_SIZE;

/** 控制台最小输出级别(dev 模式自动降为 debug) */
let minLevel: LogLevel = isDevMode() ? "debug" : "info";

/** 文件最小写入级别(dev 模式写入所有级别含 debug) */
let fileMinLevel: LogLevel = isDevMode() ? "debug" : "info";

/** log() 中需要从 data 提取到 entry 顶层字段的保留 key（模块常量，避免每次调用重建） */
const RESERVED_LOG_KEYS = new Set([
  "durationMs",
  "eventType",
  "fallbackFrom",
  "fallbackTo",
  "modelId",
  "parentRequestId",
  "payload",
  "providerId",
  "requestId",
  "requestMethod",
  "sessionId",
  "success",
  "toolCallId",
  "turnId",
]);

function getLevelOrder(level: LogLevel): number {
  switch (level) {
    case "debug":
      return 0;
    case "info":
      return 1;
    case "warn":
      return 2;
    case "error":
      return 3;
  }
}

function isStdoutProtocolMode(): boolean {
  return process.env.CRAB_STDIO_PROTOCOL === "1" || process.argv.includes("--acp");
}

export interface LogEventSinkEntry {
  level: LogLevel;
  message: string;
}

type LogEventSink = (entry: LogEventSinkEntry) => void;

let logEventSink: LogEventSink | null = null;

function publishLogEvent(level: LogLevel, message: string): void {
  try {
    logEventSink?.({ level, message });
  } catch {
    // Logging must never fail the caller because the event sink is unavailable.
  }
}

export function setLogEventSink(sink: LogEventSink | null): void {
  logEventSink = sink;
}

/**
 * 设置控制台最小日志级别。
 */
export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

/**
 * 设置文件最小写入级别。
 */
export function setFileLogLevel(level: LogLevel): void {
  fileMinLevel = level;
}

/**
 * 获取最近 N 条日志。
 */
export function getRecentLogs(count = 20): LogEntry[] {
  return logBuffer.slice(-count);
}

/**
 * 同步写入日志到文件(用于致命错误场景或 error 级别)。
 */
export function flushLogSync(entry: LogEntry): void {
  try {
    appendLogEntry(entry);
  } catch (error) {
    console.error("[LOGGER] 同步写入日志失败:", error);
  }
}

/**
 * 创建命名 Logger。
 *
 * @param service - 服务名称，用于标识日志来源
 * @returns Logger 对象
 *
 * @example
 * const log = createLogger("session");
 * log.info("会话已创建", { id: "ses_123" });
 */
export function createLogger(service?: string) {
  function log(level: LogLevel, message: string, data?: LogMetadata): void {
    if (!loggerInitialized) {
      return;
    }

    if (getLevelOrder(level) < getLevelOrder(minLevel)) {
      return;
    }

    // 使用模块级 RESERVED_LOG_KEYS 常量（定义在文件顶部）

    const extraPayload = Object.fromEntries(Object.entries(data ?? {}).filter(([key]) => !RESERVED_LOG_KEYS.has(key)));
    const rawPayload = data?.payload ?? (Object.keys(extraPayload).length > 0 ? extraPayload : undefined);
    const payload = rawPayload ? (redactSensitiveFields(rawPayload) as Record<string, unknown> | undefined) : undefined;

    const entry: LogEntry = {
      durationMs: typeof data?.durationMs === "number" ? data.durationMs : undefined,
      eventType: data?.eventType ? String(data.eventType) : undefined,
      fallbackFrom: data?.fallbackFrom ? String(data.fallbackFrom) : undefined,
      fallbackTo: data?.fallbackTo ? String(data.fallbackTo) : undefined,
      id: createId("evt"),
      level,
      message,
      modelId: data?.modelId ? String(data.modelId) : undefined,
      parentRequestId: data?.parentRequestId ? String(data.parentRequestId) : undefined,
      payload,
      providerId: data?.providerId ? String(data.providerId) : undefined,
      requestId: data?.requestId ? String(data.requestId) : undefined,
      requestMethod: data?.requestMethod ? String(data.requestMethod) : undefined,
      service,
      sessionId: data?.sessionId ? String(data.sessionId) : undefined,
      success: typeof data?.success === "boolean" ? data.success : undefined,
      timestamp: Date.now(),
      toolCallId: data?.toolCallId ? String(data.toolCallId) : undefined,
      turnId: data?.turnId ? String(data.turnId) : undefined,
    };

    // 写入缓冲区
    logBuffer.push(entry);
    if (logBuffer.length > MAX_BUFFER_SIZE) {
      logBuffer.shift();
    }

    // 发布到 EventBus(懒加载，避免 logger/eventBus 循环初始化)
    publishLogEvent(level, payload ? `${entry.message} ${JSON.stringify(payload)}` : entry.message);

    // 写入日志文件
    if (getLevelOrder(level) >= getLevelOrder(fileMinLevel)) {
      if (level === "error") {
        // Error 级别同步写入，确保不丢失
        flushLogSync(entry);
      } else {
        // 其他级别异步写入（通过 logStore 的异步方法，避免同步 I/O 阻塞）
        appendLogEntryAsync(entry);
      }
    }

    // 控制台输出
    const prefix = service ? `[${service}]` : "";
    const metaPrefix = [entry.eventType ? `[${entry.eventType}]` : "", entry.requestId ? `[${entry.requestId}]` : ""]
      .filter(Boolean)
      .join("");
    const output = payload ? `${entry.message} ${JSON.stringify(payload)}` : entry.message;
    if (isStdoutProtocolMode()) {
      console.error(`[${level.toUpperCase()}]${prefix}${metaPrefix} ${output}`);
      return;
    }

    switch (level) {
      case "debug": {
        console.debug(`[DEBUG]${prefix}${metaPrefix} ${output}`);
        break;
      }
      case "info": {
        console.info(`[INFO]${prefix}${metaPrefix} ${output}`);
        break;
      }
      case "warn": {
        console.warn(`[WARN]${prefix}${metaPrefix} ${output}`);
        break;
      }
      case "error": {
        console.error(`[ERROR]${prefix}${metaPrefix} ${output}`);
        break;
      }
    }
  }

  return {
    debug: (msg: string, data?: LogMetadata) => log("debug", msg, data),
    error: (msg: string, data?: LogMetadata) => log("error", msg, data),
    /** 同步写入日志(用于致命错误场景)，同时写入文件和控制台 */
    errorSync: (msg: string, data?: LogMetadata) => {
      log("error", msg, data);
      // Error 已经同步写入了，这里无需额外操作
    },
    info: (msg: string, data?: LogMetadata) => log("info", msg, data),
    warn: (msg: string, data?: LogMetadata) => log("warn", msg, data),
  };
}

loggerInitialized = true;

/** 重置模块状态(仅用于测试隔离) */
export function _resetLoggerForTesting(): void {
  logBuffer.length = 0;
  minLevel = isDevMode() ? "debug" : "info";
  fileMinLevel = isDevMode() ? "debug" : "info";
  logEventSink = null;
}

export function _setLogEventSinkForTesting(sink: LogEventSink | null): void {
  logEventSink = sink;
}
