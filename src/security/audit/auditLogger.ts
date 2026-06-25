/**
 * 审计日志服务 — 记录和查询安全相关操作。
 *
 * 职责:
 *   - 记录操作审计日志
 *   - 日志分类和级别
 *   - 日志过滤和搜索
 *   - 日志导出
 *
 * 审计事件类型:
 *   - authentication: 认证相关
 *   - authorization: 授权相关
 *   - data_access: 数据访问
 *   - data_modification: 数据修改
 *   - config_change: 配置变更
 *   - security_event: 安全事件
 *   - system: 系统操作
 *
 * 边界:
 *   1. 日志不可删除，只能归档
 *   2. 日志包含完整的上下文信息
 *   3. 支持结构化日志查询
 */

import { type LogMetadata, createLogger } from "@/core/logging/logger";
import { RingBuffer } from "@/core/concurrency/ringBuffer";
import { EventEmitter } from "events";
import { join } from "node:path";
import { exportAuditAsJson, exportAuditAsCsv } from "./exporter";
import { JsonlPersister } from "./jsonlPersister";
import { getAuditDir } from "@/config";
import { IntegrityError, stampEntry, verifyEntry } from "./integrity";
import { applyAuditFilters, computeAuditStats } from "./auditStore";
import { sanitizeAuditData } from "./sanitize";
import { type AuditLevel, type AuditEventType } from "./types";
import { auditId } from "@/core/id";

const log = createLogger("security:audit");

/** 审计级别 — 集中定义于 audit/types.ts */
export type { AuditLevel } from "./types";

/** 审计事件类型 — 集中定义于 audit/types.ts */
export type { AuditEventType } from "./types";

/** 审计主体 */
export interface AuditSubject {
  /** 用户 ID */
  userId?: string;
  /** 用户名 */
  username?: string;
  /** 角色 */
  role?: string;
  /** IP 地址 */
  ip?: string;
  /** 用户代理 */
  userAgent?: string;
  /** 会话 ID */
  sessionId?: string;
}

/** 审计资源 */
export interface AuditResource {
  /** 资源类型 */
  type: string;
  /** 资源 ID */
  id?: string;
  /** 资源名称 */
  name?: string;
  /** 父资源 */
  parent?: string;
}

/** 审计上下文 */
export interface AuditContext {
  /** 操作描述 */
  action: string;
  /** 事件类型 */
  eventType: AuditEventType;
  /** 级别 */
  level: AuditLevel;
  /** 主体 */
  subject?: AuditSubject;
  /** 资源 */
  resource?: AuditResource;
  /** 额外数据 */
  metadata?: Record<string, unknown>;
  /** 错误信息 */
  error?: string;
  /** 持续时间(毫秒) */
  duration?: number;
}

/** 审计日志条目 */
export interface AuditLogEntry extends AuditContext {
  /** 日志 ID */
  id: string;
  /** 时间戳 */
  timestamp: number;
  /** 应用名称 */
  app: string;
  /** 版本 */
  version?: string;
  /** 请求 ID */
  requestId?: string;
  /** 相关日志 ID */
  correlationId?: string;
  /** HMAC-SHA256 完整性签名(hex)。可选:旧 entry 可能无此字段。 */
  integrity?: string;
}

/** 审计查询条件 */
export interface AuditQuery {
  /** 开始时间 */
  startTime?: number;
  /** 结束时间 */
  endTime?: number;
  /** 事件类型 */
  eventType?: AuditEventType | AuditEventType[];
  /** 级别 */
  level?: AuditLevel | AuditLevel[];
  /** 主体 ID */
  subjectId?: string;
  /** 资源类型 */
  resourceType?: string;
  /** 资源 ID */
  resourceId?: string;
  /** 搜索关键词 */
  search?: string;
  /** 限制返回数量 */
  limit?: number;
  /** 偏移量 */
  offset?: number;
}

/**
 * 审计日志服务
 */
export class AuditLogger extends EventEmitter {
  private appName: string;
  private version?: string;
  private store: RingBuffer<AuditLogEntry>;
  private maxEntries: number;
  private auditListeners = new Set<(entry: AuditLogEntry) => void>();
  private integrityKey: string | null = null;
  private persistToFile: boolean;
  private persister: JsonlPersister | null = null;
  private maxLogFileSize: number;
  private _initialized = false;

  constructor(
    appName: string,
    options?: {
      version?: string;
      maxEntries?: number;
      integrityKey?: string | null;
      persistToFile?: boolean;
      /** JSONL 文件最大字节数，超过后自动轮转（默认 10MB） */
      maxLogFileSize?: number;
    },
  ) {
    super();
    this.appName = appName;
    this.version = options?.version;
    this.maxEntries = options?.maxEntries ?? 10_000;
    this.integrityKey = options?.integrityKey ?? null;
    this.persistToFile = options?.persistToFile ?? false;
    this.maxLogFileSize = options?.maxLogFileSize ?? 10 * 1024 * 1024;
    this.store = new RingBuffer<AuditLogEntry>(this.maxEntries);

    // 如果 persistToFile 为 true 且 integrityKey 为 null，提示缺少签名密钥
    if (this.persistToFile && !this.integrityKey) {
      log.debug("persistToFile 启用但未配置 integrityKey，审计日志将不包含完整性签名");
    }

    // 文件路径设置和目录创建延迟到 init() 中
    this._initialized = !this.persistToFile;
  }

  /**
   * 异步初始化 — 加载已有日志文件。
   * 如果 persistToFile 为 false，调用后立即 resolved。
   *
   * 注意: init() 是幂等的，多次调用不会重复加载。
   */
  async init(): Promise<void> {
    if (this._initialized) return;
    if (this.persistToFile && !this.persister) {
      try {
        const auditDir = getAuditDir();
        this.persister = new JsonlPersister(join(auditDir, "audit.jsonl"), {
          maxFileSize: this.maxLogFileSize,
        });
      } catch (err) {
        log.warn("审计日志文件目录创建失败，回退纯内存模式", err as LogMetadata);
      }
    }
    if (this.persister) {
      const { entries } = await this.persister.load<AuditLogEntry>();
      for (const entry of entries) {
        this.store.push(entry);
      }
    }
    this._initialized = true;
  }

  /** 异步持久化日志条目到文件（委托给 JsonlPersister） */
  private persistEntry(entry: AuditLogEntry): void {
    if (!this.persister) return;
    this.persister.appendLine(`${JSON.stringify(entry)}\n`).catch((err) => {
      log.error("异步写入审计日志文件失败", err as LogMetadata);
      this.emit("writeError", err);
    });
  }

  /**
   * 记录审计日志
   */
  log(context: AuditContext): string {
    const entry: AuditLogEntry = {
      app: this.appName,
      id: this.generateId(),
      requestId: undefined,
      timestamp: Date.now(),
      version: this.version,
      ...context,
    };

    // 脱敏: 在签名前处理，保证签名基于脱敏后的数据
    const sanitizedMetadata = entry.metadata ? sanitizeAuditData(entry.metadata) : undefined;
    const sanitizedSubject = entry.subject ? sanitizeAuditData(entry.subject) : undefined;
    const sanitizedResource = entry.resource ? sanitizeAuditData(entry.resource) : undefined;
    if (sanitizedMetadata) entry.metadata = sanitizedMetadata as Record<string, unknown>;
    if (sanitizedSubject) entry.subject = sanitizedSubject as AuditSubject;
    if (sanitizedResource) entry.resource = sanitizedResource as AuditResource;

    // 签名:内存与文件必须保持一致，避免 verify 出现”内存未签 / 文件已签”的偏差
    const stamped: AuditLogEntry = this.integrityKey ? (stampEntry(entry, this.integrityKey) as AuditLogEntry) : entry;

    // 统一使用 stamped 写入所有通道，保证签名一致性
    this.store.push(stamped);
    this.persistEntry(stamped);

    // 通知监听器（使用 stamped，与内存/文件一致）
    for (const listener of this.auditListeners) {
      try {
        listener(stamped);
      } catch (error) {
        log.error("审计日志监听器执行失败", error as LogMetadata);
      }
    }

    // 发送事件（使用 stamped，与内存/文件一致）
    this.emit("entry", stamped);

    log.debug(`审计日志: ${context.eventType} - ${context.action}`);
    return stamped.id;
  }

  /**
   * 记录认证事件
   */
  logAuth(action: string, context: Partial<AuditContext> & { success: boolean; subject?: AuditSubject }): string {
    return this.log({
      action,
      error: context.error,
      eventType: "authentication",
      level: context.success ? "info" : "warning",
      metadata: context.metadata,
      subject: context.subject,
      ...context,
    });
  }

  /**
   * 记录授权事件
   */
  logAuthz(action: string, context: Partial<AuditContext> & { allowed: boolean; resource?: AuditResource }): string {
    return this.log({
      action,
      error: context.error,
      eventType: "authorization",
      level: context.allowed ? "info" : "warning",
      metadata: context.metadata,
      resource: context.resource,
      ...context,
    });
  }

  /**
   * 记录数据访问
   */
  logDataAccess(action: string, context: Partial<AuditContext> & { resource: AuditResource }): string {
    return this.log({
      action,
      eventType: "data_access",
      level: "info",
      metadata: context.metadata,
      ...context,
    });
  }

  /**
   * 记录数据修改
   */
  logDataModification(
    action: string,
    context: Partial<AuditContext> & { resource: AuditResource; before?: unknown; after?: unknown },
  ): string {
    return this.log({
      action,
      eventType: "data_modification",
      level: "warning",
      metadata: { ...context.metadata, after: context.after, before: context.before },
      ...context,
    });
  }

  /**
   * 记录配置变更
   */
  logConfigChange(action: string, context: Partial<AuditContext> & { resource: AuditResource }): string {
    return this.log({
      action,
      eventType: "config_change",
      level: "warning",
      metadata: context.metadata,
      ...context,
    });
  }

  /**
   * 记录安全事件
   */
  logSecurityEvent(
    action: string,
    context: Partial<AuditContext> & { severity: AuditLevel; resource?: AuditResource },
  ): string {
    return this.log({
      action,
      error: context.error,
      eventType: "security_event",
      level: context.severity,
      metadata: context.metadata,
      resource: context.resource,
      ...context,
    });
  }

  /**
   * 查询日志 — 委托给 auditStore 的共享过滤逻辑
   */
  query(filter: AuditQuery): AuditLogEntry[] {
    return applyAuditFilters(this.store.toArray(), filter);
  }

  /**
   * 获取最近的日志
   */
  getRecent(limit = 100): AuditLogEntry[] {
    return this.store.toArray().slice(-limit).toReversed();
  }

  /**
   * 获取日志统计 — 委托给 auditStore 的共享统计逻辑
   */
  getStats(timeRange?: { startTime: number; endTime: number }): {
    total: number;
    byLevel: Record<AuditLevel, number>;
    byEventType: Record<AuditEventType, number>;
  } {
    const raw = computeAuditStats(this.store.toArray(), timeRange);
    return {
      total: raw.total,
      byLevel: raw.byLevel as Record<AuditLevel, number>,
      byEventType: raw.byEventType as Record<AuditEventType, number>,
    };
  }

  /**
   * 添加日志监听器
   */
  onAuditEntry(listener: (entry: AuditLogEntry) => void): () => void {
    this.auditListeners.add(listener);
    return () => this.auditListeners.delete(listener);
  }

  /**
   * 导出日志
   */
  export(format: "json" | "csv" = "json"): string {
    const snapshot = this.store.toArray();
    if (format === "json") {
      return exportAuditAsJson(snapshot);
    }
    return exportAuditAsCsv(snapshot);
  }

  /**
   * 验证单个条目的完整性签名。返回:
   *   - `true`  签名匹配
   *   - `false` 该条目无签名(旧格式)
   *   - 抛 IntegrityError 当签名不匹配(条目被篡改)
   * 未配置密钥时直接抛错。
   */
  verifyIntegrity(entry: AuditLogEntry): boolean {
    if (!this.integrityKey) {
      throw new IntegrityError("审计日志未配置完整性密钥");
    }
    return verifyEntry(entry as unknown as Record<string, unknown> & { integrity?: string }, this.integrityKey);
  }

  /**
   * 清除日志(仅在测试环境)
   */
  async clear(): Promise<void> {
    const env = typeof process !== "undefined" && process.env ? process.env : {};
    if ((env.NODE_ENV ?? env.BUN_ENV) === "production") {
      throw new Error("生产环境不允许清除审计日志");
    }
    this.store.clear();
    if (this.persister) {
      await this.persister.clear();
    }
    log.warn("审计日志已清除");
  }

  /**
   * 获取持久化状态信息（文件路径、连续写入失败次数）
   */
  getPersistenceInfo(): { filePath: string; consecutiveWriteFailures: number } | null {
    if (!this.persister) return null;
    return {
      consecutiveWriteFailures: this.persister.consecutiveWriteFailures,
      filePath: this.persister.getFilePath(),
    };
  }

  /**
   * 获取日志数量
   */
  size(): number {
    return this.store.size;
  }

  /**
   * 生成日志 ID
   */
  private generateId(): string {
    return auditId();
  }
}

/** 全局审计日志实例 */
let globalAuditLogger: AuditLogger | null = null;
let globalAuditInitPromise: Promise<void> | null = null;

/**
 * 获取全局审计日志实例
 */
export function getGlobalAuditLogger(): AuditLogger {
  const testAuditLogger = (
    globalThis as typeof globalThis & {
      __test_auditLogger?: AuditLogger | null;
    }
  ).__test_auditLogger;
  if (testAuditLogger) {
    return testAuditLogger;
  }
  if (!globalAuditLogger) {
    const integrityKey = process.env.CRAB_AUDIT_HMAC_KEY || null;
    globalAuditLogger = new AuditLogger("crab-cli", { version: "1.0.0", persistToFile: true, integrityKey });
    globalAuditInitPromise = globalAuditLogger.init();
  }
  return globalAuditLogger;
}

/** 等待全局审计日志实例完成异步初始化 */
export function waitForGlobalAuditLogger(): Promise<void> {
  return globalAuditInitPromise ?? Promise.resolve();
}

/**
 * 创建审计日志实例
 */
export function createAuditLogger(
  appName: string,
  options?: {
    version?: string;
    maxEntries?: number;
    integrityKey?: string | null;
    persistToFile?: boolean;
    maxLogFileSize?: number;
  },
): AuditLogger {
  return new AuditLogger(appName, options);
}
