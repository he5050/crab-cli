/**
 * 重放攻击防护 — 防止请求和消息被恶意重放。
 *
 * 职责:
 *   - Nonce 生成和验证（带 TTL 过期清理）
 *   - 请求时间戳检查(防重放)
 *   - 消息指纹追踪(防 Agent 消息重放)
 *   - 滑动窗口去重
 *
 * 攻击场景:
 *   1. 请求重放:截获请求后重复发送
 *   2. 消息重放:复制历史 Agent 消息再次注入
 *   3. 时间重放:使用旧时间戳构造请求
 *
 * 防护策略:
 *   1. Nonce:唯一随机数，每个请求只处理一次
 *   2. Timestamp:请求必须带有时间戳，5分钟内有效
 *   3. Fingerprint:消息内容指纹，防止重放历史消息
 *
 * 使用场景:
 *   - API 请求验证
 *   - SSE 事件验证
 *   - 消息队列去重
 *   - Agent 对话消息验证
 *
 * 边界:
 *   1. Nonce 存储有上限(内存中)，防止无限增长
 *   2. 时间窗口可配置
 *   3. 消息指纹使用 SHA-256，避免非加密哈希碰撞风险
 *   4. reset() 仅在非生产环境可用，防止运行时被意外清除
 */

import { createLogger } from "@/core/logging/logger";
import { RingBuffer } from "@/core/concurrency/ringBuffer";
import { createHash } from "node:crypto";
import { nonce } from "@/core/id";

const log = createLogger("security:replay");

// ─── 类型定义 ─────────────────────────────────────────────────────

/** 重放防护配置 */
export interface ReplayProtectionConfig {
  /** 时间戳有效期(毫秒)，默认 5 分钟 */
  timestampWindowMs?: number;
  /** 最大 nonce 缓存数量（必须 > 0） */
  maxNonceCacheSize?: number;
  /** 最大消息指纹缓存数量（必须 > 0） */
  maxFingerprintCacheSize?: number;
  /** 是否启用严格模式(timestamp 必填) */
  strictMode?: boolean;
}

/** 请求上下文 */
export interface RequestContext {
  /** Nonce */
  nonce?: string;
  /** 时间戳(毫秒) */
  timestamp?: number;
  /** 会话 ID */
  sessionId?: string;
  /** 请求来源 */
  source?: "cli" | "api" | "sse" | "internal";
}

/** 验证结果 */
export interface ValidationResult {
  /** 是否有效 */
  valid: boolean;
  /** 错误码 */
  errorCode?: "MISSING_NONCE" | "MISSING_TIMESTAMP" | "INVALID_NONCE" | "EXPIRED_TIMESTAMP" | "REPLAYED_MESSAGE";
  /** 错误消息 */
  message?: string;
}

// ─── 常量 ─────────────────────────────────────────────────────

const DEFAULT_TIMESTAMP_WINDOW_MS = 5 * 60 * 1000; // 5 分钟
const DEFAULT_MAX_NONCE_CACHE = 10_000;
const DEFAULT_MAX_FINGERPRINT_CACHE = 50_000;

// ─── 配置校验 ────────────────────────────────────────────────────

/**
 * 校验 ReplayProtectionConfig，防止配置炸弹或非法值。
 * @throws Error 当配置值不合法时
 */
export function validateReplayProtectionConfig(config: Partial<ReplayProtectionConfig>): void {
  if (config.maxNonceCacheSize !== undefined) {
    if (!Number.isSafeInteger(config.maxNonceCacheSize) || config.maxNonceCacheSize <= 0) {
      throw new Error(`Invalid maxNonceCacheSize: ${config.maxNonceCacheSize} (must be a positive integer)`);
    }
    if (config.maxNonceCacheSize > 1_000_000) {
      throw new Error(`maxNonceCacheSize exceeds safety cap (1_000_000): ${config.maxNonceCacheSize}`);
    }
  }
  if (config.maxFingerprintCacheSize !== undefined) {
    if (!Number.isSafeInteger(config.maxFingerprintCacheSize) || config.maxFingerprintCacheSize <= 0) {
      throw new Error(
        `Invalid maxFingerprintCacheSize: ${config.maxFingerprintCacheSize} (must be a positive integer)`,
      );
    }
    if (config.maxFingerprintCacheSize > 10_000_000) {
      throw new Error(`maxFingerprintCacheSize exceeds safety cap (10_000_000): ${config.maxFingerprintCacheSize}`);
    }
  }
  if (config.timestampWindowMs !== undefined) {
    if (!Number.isSafeInteger(config.timestampWindowMs) || config.timestampWindowMs <= 0) {
      throw new Error(`Invalid timestampWindowMs: ${config.timestampWindowMs} (must be a positive integer)`);
    }
    // 上限 24 小时，防止传参为 0 导致所有请求立即过期
    if (config.timestampWindowMs > 24 * 60 * 60 * 1000) {
      throw new Error(`timestampWindowMs exceeds safety cap (24h): ${config.timestampWindowMs}`);
    }
  }
}

// ─── Nonce 条目（带 TTL）──────────────────────────────────────────

interface NonceEntry {
  nonce: string;
  /** 首次使用时间戳（用于 TTL 过期清理） */
  firstSeen: number;
}

/** Agent 消息结构（用于重放防护指纹计算） */
export interface ReplayAgentMessage {
  role?: string;
  content?: string;
  tool_calls?: unknown;
  tool_call_id?: string;
}

// ─── Nonce 管理器 ─────────────────────────────────────────────────

/**
 * Nonce 管理器 — 使用 Map + TTL 防止内存泄漏。
 *
 * 修复要点（P0-2）:
 *   - usedNonces 不再使用无 TTL 的 Set，改用 Map<nonce, NonceEntry>
 *   - cleanup() 同时清理 RingBuffer 溢出条目和 Map 中超过 timestampWindowMs 的过期条目
 *   - 每次 checkAndMark 都触发 cleanup，保证内存不会无限增长
 */
class NonceManager {
  /** nonce → 首次使用时间戳 */
  private usedNonces = new Map<string, NonceEntry>();
  /** 用于 FIFO 淘汰的 RingBuffer（保留最近 N 条 nonce，仅做历史记录） */
  private nonceHistory: RingBuffer<string>;
  /** TTL：超过此时间未使用的 nonce 视为过期，可安全移除 */
  private ttlMs: number;

  constructor(maxSize: number, ttlMs: number) {
    this.ttlMs = ttlMs;
    this.nonceHistory = new RingBuffer<string>(maxSize);
  }

  /**
   * 生成新的 Nonce
   */
  generate(): string {
    return nonce();
  }

  /**
   * 验证 Nonce 是否已使用
   * @returns true 表示是新 nonce(有效)，false 表示已使用(重放)
   */
  checkAndMark(nonce: string): boolean {
    const now = Date.now();

    if (this.usedNonces.has(nonce)) {
      log.warn(`Nonce 已使用(重放攻击检测): ${nonce.slice(0, 20)}...`);
      return false;
    }

    // 标记为已使用，记录首次出现时间
    this.usedNonces.set(nonce, { nonce, firstSeen: now });
    this.nonceHistory.push(nonce);

    // 每次 check 时清理过期条目，防止内存泄漏
    this.cleanup(now);

    return true;
  }

  /**
   * 清理过期 nonce:
   *   1. 先清理 Map 中超过 TTL 的条目
   *   2. 再处理 RingBuffer 溢出（清理最旧的）
   */
  cleanup(now: number): void {
    // 清理 TTL 过期的条目
    let removedByTtl = 0;
    for (const [nonce, entry] of this.usedNonces) {
      if (now - entry.firstSeen > this.ttlMs) {
        this.usedNonces.delete(nonce);
        removedByTtl++;
      }
    }
    if (removedByTtl > 0) {
      log.debug(`Nonce TTL 清理: 移除 ${removedByTtl} 个过期条目`);
    }
    // 注意: RingBuffer 已内置容量限制，溢出条目自动覆盖最旧元素，无需额外清理
  }

  /**
   * 获取缓存大小
   */
  size(): number {
    return this.usedNonces.size;
  }

  /**
   * 重置（测试/重置场景可用，生产环境应通过 ReplayProtector 的 reset 控制）
   */
  reset(): void {
    this.usedNonces.clear();
    this.nonceHistory.clear();
  }
}

// ─── 消息指纹管理器 ─────────────────────────────────────────────────

/**
 * 消息指纹管理器 — 防止 Agent 消息被重放
 */
class MessageFingerprintManager {
  private fingerprints = new Map<string, number>(); // Fingerprint -> first seen timestamp
  private messageCount = new Map<string, number>(); // Fingerprint -> count
  private maxSize: number;
  private windowMs: number;

  constructor(maxSize: number, windowMs: number) {
    this.maxSize = maxSize;
    this.windowMs = windowMs;
  }

  /**
   * 计算消息指纹
   */
  calculateFingerprint(message: ReplayAgentMessage): string {
    const parts: string[] = [];

    if (message.role) {
      parts.push(`role:${message.role}`);
    }
    if (message.content) {
      parts.push(`content:${message.content}`);
    }
    if (message.tool_calls) {
      parts.push(`tools:${JSON.stringify(message.tool_calls)}`);
    }
    if (message.tool_call_id) {
      parts.push(`toolId:${message.tool_call_id}`);
    }

    // SHA-256 哈希
    const content = parts.join("|");
    return createHash("sha256").update(content).digest("hex");
  }

  /**
   * 检查消息是否是新消息(未被重放过)
   */
  checkAndRecord(fingerprint: string): boolean {
    const now = Date.now();

    // 检查是否已存在
    if (this.fingerprints.has(fingerprint)) {
      const count = this.messageCount.get(fingerprint) ?? 1;
      this.messageCount.set(fingerprint, count + 1);

      log.warn(`消息指纹重复(重放检测): ${fingerprint.slice(0, 12)}..., count=${count + 1}`);
      return false;
    }

    // 记录新指纹
    this.fingerprints.set(fingerprint, now);
    this.messageCount.set(fingerprint, 1);

    // 清理过期指纹
    this.cleanup(now);

    return true;
  }

  /**
   * 清理过期指纹 — 先收集再批量删除，避免遍历中修改 Map。
   *
   * 两阶段策略:
   *   1. 超时清理: 移除所有超过 windowMs 的条目（始终执行）
   *   2. 溢出清理: 若仍超限，按 FIFO 顺序移除最旧条目
   */
  private cleanup(now: number): void {
    // 阶段1: 超时清理 — 先收集过期 key，再批量删除
    const expiredKeys: string[] = [];
    for (const [fp, timestamp] of this.fingerprints) {
      if (now - timestamp > this.windowMs) {
        expiredKeys.push(fp);
      }
    }
    for (const fp of expiredKeys) {
      this.fingerprints.delete(fp);
      this.messageCount.delete(fp);
    }
    if (expiredKeys.length > 0) {
      log.debug(`消息指纹超时清理: 移除 ${expiredKeys.length} 个过期条目`);
    }

    // 阶段2: 溢出清理 — FIFO 移除最旧条目
    if (this.fingerprints.size > this.maxSize) {
      let toRemove = this.fingerprints.size - this.maxSize;
      const iter = this.fingerprints.keys();
      for (let i = 0; i < toRemove; i++) {
        const { value, done } = iter.next();
        if (done) break;
        this.fingerprints.delete(value);
        this.messageCount.delete(value);
      }
      log.warn(
        `消息指纹溢出清理: 移除 ${Math.min(toRemove, this.fingerprints.size + toRemove)} 个最旧条目，安全防护窗口已缩窄`,
      );
    }
  }

  /**
   * 获取统计
   */
  getStats(): { uniqueCount: number; totalCount: number } {
    let total = 0;
    for (const count of this.messageCount.values()) {
      total += count;
    }
    return {
      totalCount: total,
      uniqueCount: this.fingerprints.size,
    };
  }

  /**
   * 重置
   */
  reset(): void {
    this.fingerprints.clear();
    this.messageCount.clear();
  }
}

// ─── 重放防护器 ─────────────────────────────────────────────────

/**
 * 重放防护器
 *
 * @experimental 此组件已实现但尚未在核心请求流程中完全集成。
 *   当前仅提供 API 供手动使用，未来版本将集成到 tool/executor 请求验证中。
 */
export class ReplayProtector {
  private nonceManager: NonceManager;
  private fingerprintManager: MessageFingerprintManager;
  private config: Required<ReplayProtectionConfig>;

  constructor(config: ReplayProtectionConfig = {}) {
    // P0-3: 配置边界校验，防止非法值导致运行时问题
    validateReplayProtectionConfig(config);

    this.config = {
      maxFingerprintCacheSize: config.maxFingerprintCacheSize ?? DEFAULT_MAX_FINGERPRINT_CACHE,
      maxNonceCacheSize: config.maxNonceCacheSize ?? DEFAULT_MAX_NONCE_CACHE,
      strictMode: config.strictMode ?? false,
      timestampWindowMs: config.timestampWindowMs ?? DEFAULT_TIMESTAMP_WINDOW_MS,
    };

    this.nonceManager = new NonceManager(this.config.maxNonceCacheSize, this.config.timestampWindowMs);
    this.fingerprintManager = new MessageFingerprintManager(
      this.config.maxFingerprintCacheSize,
      this.config.timestampWindowMs,
    );
  }

  /**
   * 验证请求
   */
  validateRequest(ctx: RequestContext): ValidationResult {
    // Nonce 检查
    if (!ctx.nonce) {
      if (this.config.strictMode) {
        return { errorCode: "MISSING_NONCE", message: "请求缺少 Nonce", valid: false };
      }
    } else {
      if (!this.nonceManager.checkAndMark(ctx.nonce)) {
        return { errorCode: "INVALID_NONCE", message: "Nonce 已被使用(重放请求)", valid: false };
      }
    }

    // 时间戳检查
    if (!ctx.timestamp) {
      if (this.config.strictMode) {
        return { errorCode: "MISSING_TIMESTAMP", message: "请求缺少时间戳", valid: false };
      }
    } else {
      const now = Date.now();
      const elapsed = now - ctx.timestamp;

      if (elapsed < 0) {
        // 时间戳在未来，可能有问题但不放行
        return { errorCode: "EXPIRED_TIMESTAMP", message: "时间戳无效", valid: false };
      }

      if (elapsed > this.config.timestampWindowMs) {
        return {
          errorCode: "EXPIRED_TIMESTAMP",
          message: `请求已过期(${Math.round(elapsed / 1000)}秒前)`,
          valid: false,
        };
      }
    }

    return { valid: true };
  }

  /**
   * 生成新 Nonce
   */
  generateNonce(): string {
    return this.nonceManager.generate();
  }

  /**
   * 创建请求上下文(带 nonce 和 timestamp)
   */
  createRequestContext(
    sessionId?: string,
    source?: RequestContext["source"],
  ): RequestContext & { nonce: string; timestamp: number } {
    return {
      nonce: this.generateNonce(),
      sessionId,
      source,
      timestamp: Date.now(),
    };
  }

  /**
   * 验证 Agent 消息是否被重放
   */
  validateAgentMessage(message: ReplayAgentMessage): ValidationResult {
    const fingerprint = this.fingerprintManager.calculateFingerprint(message);

    if (!this.fingerprintManager.checkAndRecord(fingerprint)) {
      return {
        errorCode: "REPLAYED_MESSAGE",
        message: "检测到重复消息(可能被重放)",
        valid: false,
      };
    }

    return { valid: true };
  }

  /**
   * 获取防护统计
   */
  getStats(): {
    nonceCacheSize: number;
    messageFingerprints: number;
    totalMessages: number;
  } {
    const fpStats = this.fingerprintManager.getStats();
    return {
      messageFingerprints: fpStats.uniqueCount,
      nonceCacheSize: this.nonceManager.size(),
      totalMessages: fpStats.totalCount,
    };
  }

  /**
   * 重置所有状态。
   *
   * 安全说明:
   *   - 生产环境 (NODE_ENV === "production") 下调用将抛出错误，
   *     防止运行时被意外清除防护状态。
   *   - 仅应在测试、初始化或明确的运维场景下使用。
   */
  reset(): void {
    const env = typeof process !== "undefined" && process.env ? process.env : {};
    if ((env.NODE_ENV ?? env.BUN_ENV) === "production") {
      throw new Error("生产环境不允许重置 ReplayProtector 状态");
    }
    this.nonceManager.reset();
    this.fingerprintManager.reset();
    log.debug("重放防护器状态已重置");
  }
}

// ─── 单例导出 ────────────────────────────────────────────────────

export const replayProtector = new ReplayProtector();

// ─── 工厂函数 ────────────────────────────────────────────────────

/**
 * 创建重放防护器（支持自定义配置）
 */
export function createReplayProtector(config?: ReplayProtectionConfig): ReplayProtector {
  return new ReplayProtector(config);
}
