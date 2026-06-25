/**
 * 审计日志存储 — 日志持久化和查询接口。
 *
 * 职责:
 *   - 日志持久化到存储后端
 *   - 日志归档管理
 *   - 查询接口实现
 *
 * 支持的存储后端:
 *   - MemoryStore: 内存存储(默认，测试用)
 *   - FileStore: 文件存储(JSONL 追加写入，异步 I/O)
 */

import { RingBuffer } from "@/core/concurrency/ringBuffer";
import type { AuditLogEntry, AuditQuery } from "./auditLogger";
import { JsonlPersister } from "./jsonlPersister";

/**
 * 审计日志存储接口
 */
export interface AuditStore {
  /** 保存日志条目 */
  save(entry: AuditLogEntry): Promise<void>;

  /** 批量保存日志 */
  saveBatch(entries: AuditLogEntry[]): Promise<void>;

  /** 查询日志 */
  query(filter: AuditQuery): Promise<AuditLogEntry[]>;

  /** 获取最近的日志 */
  getRecent(limit: number): Promise<AuditLogEntry[]>;

  /** 获取日志统计 */
  getStats(timeRange?: { startTime: number; endTime: number }): Promise<{
    total: number;
    byLevel: Record<string, number>;
    byEventType: Record<string, number>;
  }>;

  /** 删除旧日志(归档) */
  deleteOlderThan(timestamp: number): Promise<number>;

  /** 获取存储信息 */
  getStorageInfo(): Promise<{ count: number; oldestTimestamp?: number; newestTimestamp?: number }>;
}

/**
 * 对日志条目数组应用查询过滤条件。
 * 供 AuditLogger 和 AuditStore 复用，消除重复代码。
 */
export function applyAuditFilters(entries: AuditLogEntry[], filter: AuditQuery): AuditLogEntry[] {
  let results = entries;

  if (filter.startTime) {
    results = results.filter((e) => e.timestamp >= filter.startTime!);
  }
  if (filter.endTime) {
    results = results.filter((e) => e.timestamp <= filter.endTime!);
  }
  if (filter.eventType) {
    const types = Array.isArray(filter.eventType) ? filter.eventType : [filter.eventType];
    results = results.filter((e) => types.includes(e.eventType));
  }
  if (filter.level) {
    const levels = Array.isArray(filter.level) ? filter.level : [filter.level];
    results = results.filter((e) => levels.includes(e.level));
  }
  if (filter.subjectId) {
    results = results.filter((e) => e.subject?.userId === filter.subjectId);
  }
  if (filter.resourceType) {
    results = results.filter((e) => e.resource?.type === filter.resourceType);
  }
  if (filter.resourceId) {
    results = results.filter((e) => e.resource?.id === filter.resourceId);
  }
  if (filter.search) {
    const keyword = filter.search.toLowerCase();
    results = results.filter(
      (e) =>
        e.action.toLowerCase().includes(keyword) ||
        e.subject?.username?.toLowerCase().includes(keyword) ||
        e.resource?.name?.toLowerCase().includes(keyword),
    );
  }

  const offset = filter.offset ?? 0;
  const limit = filter.limit ?? 100;
  return results.slice(offset, offset + limit);
}

/**
 * 对日志条目数组计算统计信息。
 * 供 AuditLogger 和 AuditStore 复用。
 */
export function computeAuditStats(
  entries: AuditLogEntry[],
  timeRange?: { startTime: number; endTime: number },
): {
  total: number;
  byLevel: Record<string, number>;
  byEventType: Record<string, number>;
} {
  let source = entries;
  if (timeRange) {
    source = entries.filter((e) => e.timestamp >= timeRange.startTime && e.timestamp <= timeRange.endTime);
  }

  const stats: { byLevel: Record<string, number>; byEventType: Record<string, number>; total: number } = {
    byLevel: {},
    byEventType: {},
    total: source.length,
  };

  for (const entry of source) {
    stats.byLevel[entry.level] = (stats.byLevel[entry.level] || 0) + 1;
    stats.byEventType[entry.eventType] = (stats.byEventType[entry.eventType] || 0) + 1;
  }

  return stats;
}

export interface AuditStoreConfig {
  maxEntries?: number;
  filePath?: string;
}

/** 校验审计存储配置，防止配置炸弹或非法值 */
export function validateAuditStoreConfig(config: AuditStoreConfig): void {
  const maxEntries = config.maxEntries ?? 10_000;
  if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
    throw new Error(`Invalid AuditStore maxEntries: ${maxEntries}`);
  }
  if (maxEntries > 10_000_000) {
    throw new Error(`maxEntries exceeds safety cap (10_000_000): ${maxEntries}`);
  }
  if (config.filePath !== undefined && typeof config.filePath !== "string") {
    throw new Error(`Invalid AuditStore filePath: must be a string`);
  }
}

/**
 * 内存存储实现
 */
export class MemoryAuditStore implements AuditStore {
  private entries: RingBuffer<AuditLogEntry>;

  constructor(maxEntries = 10_000) {
    validateAuditStoreConfig({ maxEntries });
    this.entries = new RingBuffer<AuditLogEntry>(maxEntries);
  }

  async save(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
  }

  async saveBatch(entries: AuditLogEntry[]): Promise<void> {
    for (const entry of entries) {
      this.entries.push(entry);
    }
  }

  async query(filter: AuditQuery): Promise<AuditLogEntry[]> {
    return applyAuditFilters(this.entries.toArray(), filter);
  }

  async getRecent(limit: number): Promise<AuditLogEntry[]> {
    return this.entries.toArray().slice(-limit);
  }

  async getStats(timeRange?: { startTime: number; endTime: number }): Promise<{
    total: number;
    byLevel: Record<string, number>;
    byEventType: Record<string, number>;
  }> {
    return computeAuditStats(this.entries.toArray(), timeRange);
  }

  async deleteOlderThan(timestamp: number): Promise<number> {
    const initialLength = this.entries.size;
    const remaining = this.entries.toArray().filter((e) => e.timestamp >= timestamp);
    this.entries.clear();
    for (const e of remaining) {
      this.entries.push(e);
    }
    return initialLength - this.entries.size;
  }

  async getStorageInfo(): Promise<{ count: number; oldestTimestamp?: number; newestTimestamp?: number }> {
    const arr = this.entries.toArray();
    if (arr.length === 0) {
      return { count: 0 };
    }
    const first = arr[0];
    const last = arr[arr.length - 1];
    return {
      count: this.entries.size,
      newestTimestamp: last?.timestamp,
      oldestTimestamp: first?.timestamp,
    };
  }

  /** 清除所有日志(仅测试用) */
  clear(): void {
    this.entries.clear();
  }
}

/**
 * 文件存储实现 — 使用 JSONL 追加写入 + 异步 I/O。
 *
 * 与 AuditLogger 的文件格式保持一致 (JSONL)，避免全量读写。
 */
export class FileAuditStore implements AuditStore {
  private persister: JsonlPersister;
  private buffer: AuditLogEntry[] = [];
  private loaded = false;
  private loadPromise: Promise<void> | null = null;
  private maxEntries: number;

  constructor(filePath: string, maxEntries = 10_000) {
    validateAuditStoreConfig({ maxEntries });
    this.persister = new JsonlPersister(filePath);
    this.maxEntries = maxEntries;
  }

  /** 异步确保文件已加载（init promise 模式，避免并发竞态） */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (!this.loadPromise) {
      this.loadPromise = this.doLoad().finally(() => {
        this.loadPromise = null;
      });
    }
    await this.loadPromise;
  }

  /** 实际加载逻辑，仅由 ensureLoaded 调用一次 */
  private async doLoad(): Promise<void> {
    const { entries } = await this.persister.load<AuditLogEntry>();
    this.buffer.push(...entries);
    this.loaded = true;
  }

  async save(entry: AuditLogEntry): Promise<void> {
    await this.ensureLoaded();
    await this.persister.appendLine(`${JSON.stringify(entry)}\n`);
    this.buffer.push(entry);
    if (this.buffer.length > this.maxEntries) {
      this.buffer.splice(0, this.buffer.length - this.maxEntries);
    }
  }

  async saveBatch(entries: AuditLogEntry[]): Promise<void> {
    await this.ensureLoaded();
    const lines = entries.map((e) => `${JSON.stringify(e)}\n`).join("");
    await this.persister.appendLine(lines);
    this.buffer.push(...entries);
    if (this.buffer.length > this.maxEntries) {
      this.buffer.splice(0, this.buffer.length - this.maxEntries);
    }
  }

  async query(filter: AuditQuery): Promise<AuditLogEntry[]> {
    await this.ensureLoaded();
    return applyAuditFilters([...this.buffer], filter);
  }

  async getRecent(limit: number): Promise<AuditLogEntry[]> {
    await this.ensureLoaded();
    return this.buffer.slice(-limit);
  }

  async getStats(timeRange?: { startTime: number; endTime: number }): Promise<{
    total: number;
    byLevel: Record<string, number>;
    byEventType: Record<string, number>;
  }> {
    await this.ensureLoaded();
    return computeAuditStats(this.buffer, timeRange);
  }

  async deleteOlderThan(timestamp: number): Promise<number> {
    await this.ensureLoaded();
    const initialLength = this.buffer.length;
    this.buffer = this.buffer.filter((e) => e.timestamp >= timestamp);
    if (initialLength !== this.buffer.length) {
      const lines = this.buffer.map((e) => `${JSON.stringify(e)}\n`).join("");
      await this.persister.atomicWrite(lines);
    }
    return initialLength - this.buffer.length;
  }

  async getStorageInfo(): Promise<{ count: number; oldestTimestamp?: number; newestTimestamp?: number }> {
    await this.ensureLoaded();
    if (this.buffer.length === 0) {
      return { count: 0 };
    }
    const first = this.buffer[0];
    const last = this.buffer[this.buffer.length - 1];
    return {
      count: this.buffer.length,
      newestTimestamp: last?.timestamp,
      oldestTimestamp: first?.timestamp,
    };
  }
}

/**
 * 创建内存存储
 */
export function createMemoryStore(maxEntries?: number): AuditStore {
  return new MemoryAuditStore(maxEntries);
}

/**
 * 创建文件存储
 */
export function createFileStore(filePath: string, maxEntries?: number): AuditStore {
  return new FileAuditStore(filePath, maxEntries);
}
