/**
 * 日志文件存储 — 按日期和级别分类写入日志文件。
 *
 * 职责:
 *   - 将日志条目追加写入 ~/.crab/logs/ 下的分类文件
 *   - 按日期和级别分类存储
 *   - 自动清理旧日志文件
 *
 * 模块功能:
 *   - writeLogEntry: 写入日志条目
 *   - flushLogSync: 同步刷新日志
 *   - setLogDirectory: 设置日志目录
 *   - cleanupOldLogs: 清理旧日志文件
 *
 * 使用场景:
 *   - 应用日志持久化
 *   - 错误日志记录
 *   - 调试信息存储
 *
 * 边界:
 *   1. 仅负责文件写入和旧文件清理，不提供查询能力
 *   2. 日志目录默认在 ~/.crab/logs/
 *   3. 保留策略:debug 3天, info 7天, warn 14天, error 30天
 *
 * 流程:
 *   1. 模块加载时创建日志目录
 *   2. 接收日志条目
 *   3. 按级别分类写入对应文件
 *   4. 定期清理过期日志
 *
 * 文件命名规则:
 *   YYYY-MM-DD-errors.log    — 错误日志
 *   YYYY-MM-DD-warnings.log  — 警告日志
 *   YYYY-MM-DD-info.log      — 信息日志
 *   YYYY-MM-DD-debug.log     — 调试日志
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { registerCleanup } from "@/bus";
import type { LogEntry, LogLevel } from "@/core/logging/logger";

/** 日志保留策略 */
interface LogRetentionPolicy {
  debugDays: number;
  infoDays: number;
  warnDays: number;
  errorDays: number;
}

/** 默认保留策略 */
const DEFAULT_RETENTION: LogRetentionPolicy = {
  debugDays: 3,
  errorDays: 30,
  infoDays: 7,
  warnDays: 14,
};

/** 日志保留天数 */
const RETENTION_DAYS = 7;

/** 单个日志文件最大大小(10MB)，超过则 rotation */
const MAX_LOG_FILE_SIZE = 10 * 1024 * 1024;

/** 每个 log 文件最多保留的 rotated 副本数 */
const MAX_ROTATED_FILES = 3;

/** 日志目录:~/.crab/logs/ */
const DEFAULT_LOG_DIR = path.join(os.homedir(), ".crab", "logs");

let logDir = DEFAULT_LOG_DIR;
let initialized = false;
let retentionPolicy: LogRetentionPolicy = DEFAULT_RETENTION;

/**
 * 确保日志目录存在。
 */
function ensureLogDirectory(): void {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

/**
 * 获取当前日期前缀 (YYYY-MM-DD)。
 */
function getDatePrefix(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * 根据日志级别获取对应的文件后缀名。
 */
function getLevelSuffix(level: LogLevel): string {
  switch (level) {
    case "error": {
      return "errors";
    }
    case "warn": {
      return "warnings";
    }
    case "info": {
      return "info";
    }
    case "debug": {
      return "debug";
    }
  }
}

/**
 * 获取日志目录路径(供外部使用，如 Ctrl+L 打开目录)。
 */
export function getLogDir(): string {
  return logDir;
}

/**
 * 初始化日志存储。
 * 模块加载时已自动调用一次(同步创建目录)。
 * 后续调用仅用于更新路径。
 */
export function initLogStore(customPath?: string, customRetention?: Partial<LogRetentionPolicy>): void {
  if (customPath) {
    logDir = customPath;
  }

  if (customRetention) {
    retentionPolicy = { ...DEFAULT_RETENTION, ...customRetention };
  }

  if (!initialized) {
    initialized = true;
    cleanupOldLogs();
    registerCleanup(() => {
      cleanupOldLogs();
    });
  }
}

/**
 * 追加写入一条日志到对应的分类文件。
 * 每条日志为一行 JSON，方便 grep/jq 等工具查询。
 */
export function appendLogEntry(entry: LogEntry): void {
  try {
    ensureLogDirectory();
    const datePrefix = getDatePrefix();
    const levelSuffix = getLevelSuffix(entry.level);
    const fileName = `${datePrefix}-${levelSuffix}.log`;
    const filePath = path.join(logDir, fileName);

    const logLine = `${JSON.stringify({
      id: entry.id,
      level: entry.level,
      msg: entry.message,
      service: entry.service ?? "",
      ts: new Date(entry.timestamp).toISOString(),
      ...(entry.eventType ? { evt: entry.eventType } : {}),
      ...(entry.sessionId ? { ses: entry.sessionId } : {}),
      ...(entry.requestId ? { req: entry.requestId } : {}),
      ...(entry.turnId ? { trn: entry.turnId } : {}),
      ...(entry.providerId ? { provider: entry.providerId } : {}),
      ...(entry.modelId ? { model: entry.modelId } : {}),
      ...(entry.requestMethod ? { method: entry.requestMethod } : {}),
      ...(entry.toolCallId ? { tool: entry.toolCallId } : {}),
      ...(entry.success != null ? { ok: entry.success } : {}),
      ...(entry.durationMs != null ? { ms: entry.durationMs } : {}),
      ...(entry.payload ? { data: entry.payload } : {}),
    })}\n`;

    fs.appendFileSync(filePath, logLine, "utf8");

    // 文件大小超限则 rotation
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_LOG_FILE_SIZE) {
        rotateLogFile(filePath);
      }
    } catch {
      // Stat 失败不影响写入
    }
  } catch (error) {
    console.error("[LOG-STORE] 写入日志文件失败:", error);
  }
}

/**
 * 异步追加写入一条日志（使用 queueMicrotask，不阻塞事件循环）。
 * 用于非 error 级别的日志，在高频场景下避免同步文件 I/O 阻塞主线程。
 */
export function appendLogEntryAsync(entry: LogEntry): void {
  queueMicrotask(() => {
    try {
      appendLogEntry(entry);
    } catch {
      // 静默处理，不影响调用方
    }
  });
}

/** 查询过滤器 */
interface LogQueryFilter {
  requestId?: string;
  turnId?: string;
  sessionId?: string;
  level?: LogLevel;
  service?: string;
}

/**
 * 从日志文件中查询日志。
 * 注意:文件存储模式下，查询需要读取所有日志文件，性能较低。
 */
export function queryLogs(filter: LogQueryFilter): LogEntry[] {
  try {
    ensureLogDirectory();
    const files = fs.readdirSync(logDir).filter((f) => f.endsWith(".log"));
    const results: LogEntry[] = [];

    for (const file of files) {
      const filePath = path.join(logDir, file);
      const content = fs.readFileSync(filePath, "utf8");
      const lines = content.split("\n").filter((line) => line.trim());

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          const entry: LogEntry = {
            durationMs: parsed.ms,
            eventType: parsed.evt,
            id: parsed.id || "",
            level: parsed.level,
            message: parsed.msg || "",
            modelId: parsed.model,
            payload: parsed.data,
            providerId: parsed.provider,
            requestId: parsed.req,
            requestMethod: parsed.method,
            service: parsed.service,
            sessionId: parsed.ses,
            success: parsed.ok,
            timestamp: new Date(parsed.ts).getTime(),
            toolCallId: parsed.tool,
            turnId: parsed.trn,
          };

          // 应用过滤器
          if (filter.requestId && entry.requestId !== filter.requestId) {
            continue;
          }
          if (filter.turnId && entry.turnId !== filter.turnId) {
            continue;
          }
          if (filter.sessionId && entry.sessionId !== filter.sessionId) {
            continue;
          }
          if (filter.level && entry.level !== filter.level) {
            continue;
          }
          if (filter.service && entry.service !== filter.service) {
            continue;
          }

          results.push(entry);
        } catch (error) {
          // 跳过无法解析的行
          console.debug(`[LOG-STORE] 跳过无法解析的日志行: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    // 按时间戳降序排列
    return results.toSorted((a, b) => b.timestamp - a.timestamp);
  } catch (error) {
    console.error("[LOG-STORE] 查询日志失败:", error);
    return [];
  }
}

/**
 * 获取日志保留策略。
 */
export function getLogRetentionPolicy(): LogRetentionPolicy {
  return { ...retentionPolicy };
}

/**
 * 清理过期日志（逐行解析过滤）。
 *
 * 注意: 此函数对每个日志文件执行完整读取→逐行 JSON 解析→过滤→写回。
 * 对于接近 MAX_LOG_FILE_SIZE(10MB) 的文件，会造成显著内存峰值。
 * 日常清理已由 cleanupOldLogs() 按文件名日期粒度完成，
 * pruneLogs 仅在需要精确到单条日志级别的清理时手动调用。
 *
 * @returns 删除的日志条数
 */
export function pruneLogs(now: number = Date.now()): number {
  try {
    if (!fs.existsSync(logDir)) {
      return 0;
    }

    const debugCutoff = now - retentionPolicy.debugDays * 24 * 60 * 60 * 1000;
    const infoCutoff = now - retentionPolicy.infoDays * 24 * 60 * 60 * 1000;
    const warnCutoff = now - retentionPolicy.warnDays * 24 * 60 * 60 * 1000;
    const errorCutoff = now - retentionPolicy.errorDays * 24 * 60 * 60 * 1000;

    const files = fs.readdirSync(logDir);
    let deleted = 0;

    for (const file of files) {
      if (!file.endsWith(".log")) {
        continue;
      }

      const filePath = path.join(logDir, file);
      const content = fs.readFileSync(filePath, "utf8");
      const lines = content.split("\n").filter((line) => line.trim());

      // 过滤掉过期日志
      const remainingLines: string[] = [];
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          const timestamp = new Date(parsed.ts).getTime();
          const level = parsed.level as LogLevel;

          let cutoff: number;
          switch (level) {
            case "debug": {
              cutoff = debugCutoff;
              break;
            }
            case "info": {
              cutoff = infoCutoff;
              break;
            }
            case "warn": {
              cutoff = warnCutoff;
              break;
            }
            case "error": {
              cutoff = errorCutoff;
              break;
            }
            default: {
              cutoff = infoCutoff;
            }
          }

          if (timestamp >= cutoff) {
            remainingLines.push(line);
          } else {
            deleted++;
          }
        } catch (error) {
          console.debug(
            `[LOG-STORE] 清理时跳过无法解析的行: ${error instanceof Error ? error.message : String(error)}`,
          );
          remainingLines.push(line);
        }
      }

      // 写回文件
      if (remainingLines.length === 0) {
        fs.unlinkSync(filePath);
      } else if (remainingLines.length !== lines.length) {
        fs.writeFileSync(filePath, `${remainingLines.join("\n")}\n`, "utf8");
      }
    }

    return deleted;
  } catch (error) {
    console.error("[LOG-STORE] 清理日志失败:", error);
    return 0;
  }
}

/**
 * 强制刷新(同步写入无需额外操作，保留接口兼容)。
 */
export function flushLogStore(): void {
  // 同步写入无需 flush
}

/**
 * 清理超过 RETENTION_DAYS 天的日志文件。
 * 按文件名中的日期前缀判断。
 */
function cleanupOldLogs(): void {
  if (!fs.existsSync(logDir)) {
    return;
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);
  const cutoffStr = formatDate(cutoffDate);

  try {
    const files = fs.readdirSync(logDir);
    for (const file of files) {
      if (!file.endsWith(".log") && !/\.log\.\d+$/.test(file)) {
        continue;
      }

      const datePart = file.slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(datePart) && datePart < cutoffStr) {
        fs.unlinkSync(path.join(logDir, file));
      }
    }
  } catch (error) {
    console.error("[LOG-STORE] 清理旧日志文件失败:", error);
  }
}

/**
 * 对单个日志文件执行 rotation:file.log → file.log.1 → file.log.2 → ... → 删除最旧
 */
function rotateLogFile(filePath: string): void {
  try {
    // 删除最旧副本
    const oldest = `${filePath}.${MAX_ROTATED_FILES}`;
    if (fs.existsSync(oldest)) {
      fs.unlinkSync(oldest);
    }

    // .N → .N+1
    for (let i = MAX_ROTATED_FILES - 1; i >= 1; i--) {
      const src = `${filePath}.${i}`;
      const dst = `${filePath}.${i + 1}`;
      if (fs.existsSync(src)) {
        fs.renameSync(src, dst);
      }
    }

    // 原文件 → .1
    fs.renameSync(filePath, `${filePath}.1`);
  } catch (error) {
    console.error("[LOG-STORE] 日志 rotation 失败:", error);
  }
}

/** 格式化日期为 YYYY-MM-DD */
function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * 测试重置。
 */
export function resetLogStoreForTests(): void {
  initialized = false;
  logDir = DEFAULT_LOG_DIR;
  retentionPolicy = DEFAULT_RETENTION;
}

/**
 * 清理日志目录(仅用于测试)。
 */
export function cleanupLogDirectory(): void {
  try {
    if (fs.existsSync(logDir)) {
      const files = fs.readdirSync(logDir);
      for (const file of files) {
        if (file.endsWith(".log")) {
          fs.unlinkSync(path.join(logDir, file));
        }
      }
    }
  } catch (error) {
    console.debug(`[LOG-STORE] 清理日志文件失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// 模块加载时立即初始化
ensureLogDirectory();
