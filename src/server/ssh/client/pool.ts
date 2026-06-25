/**
 * SSH 连接池 — 管理 SSH 连接的复用和生命周期
 *
 * 职责:
 *   - 管理 SSH 连接的生命周期
 *   - 实现连接复用，减少重复连接开销
 *   - 自动清理空闲连接
 *   - 限制最大连接数
 *
 * 模块功能:
 *   - SSHConnectionPool:连接池单例类
 *   - getConnection:获取或创建连接
 *   - releaseConnection:释放连接
 *   - getStats:获取连接池统计
 *   - closeAll:关闭所有连接
 *
 * 使用场景:
 *   - 远程命令执行
 *   - 远程文件操作
 *   - 多会话复用同一连接
 *
 * 边界:
 * 1. 最大连接数限制 10 个
 * 2. 空闲连接 5 分钟后自动清理
 * 3. 仅支持基于密钥的认证
 *
 * 流程:
 * 1. getConnection() 查找现有可用连接
 * 2. 若无匹配连接且未达上限，创建新连接
 * 3. 若已达上限，驱逐最老的空闲连接后创建新连接
 * 4. 定时清理器每分钟检查并清理空闲超时的连接
 */

import type { SSHConnection, SSHConnectionConfig, SSHConnectionPoolStats } from "../types";
import { createLogger } from "@/core/logging/logger";
import { brandedId } from "@/core/id";

const log = createLogger("ssh:connection-pool");

/**
 * SSH 连接池管理类
 */
export class SSHConnectionPool {
  private static instance: SSHConnectionPool;
  private connections = new Map<string, SSHConnection>();
  private maxConnections = 10;
  private idleTimeoutMs = 300_000; // 5分钟
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  private constructor() {
    this.startCleanupTimer();
  }

  static getInstance(): SSHConnectionPool {
    if (!SSHConnectionPool.instance) {
      SSHConnectionPool.instance = new SSHConnectionPool();
    }
    return SSHConnectionPool.instance;
  }

  /**
   * 获取或创建 SSH 连接
   */
  async getConnection(config: SSHConnectionConfig): Promise<SSHConnection> {
    // 查找现有可用连接
    const existing = this.findExistingConnection(config);
    if (existing?.isConnected) {
      existing.lastUsed = new Date();
      log.debug(`复用现有 SSH 连接: ${existing.id}`);
      return existing;
    }

    // 创建新连接
    return this.createConnection(config);
  }

  /**
   * 创建新的 SSH 连接(懒加载 ssh2)
   */
  private async createConnection(config: SSHConnectionConfig): Promise<SSHConnection> {
    // 检查连接数限制
    if (this.connections.size >= this.maxConnections) {
      await this.evictOldestIdle();
    }

    try {
      // 懒加载 ssh2
      // @ts-expect-error ssh2 没有 @types 声明
      const { Client } = await import("ssh2");
      const client = new Client();

      const id = brandedId("ssh");
      const connection: SSHConnection = {
        client,
        config,
        createdAt: new Date(),
        id,
        isConnected: false,
        lastUsed: new Date(),
      };

      // 建立连接
      await this.connect(client, config);
      connection.isConnected = true;

      // 监听断开
      client.on("close", () => {
        connection.isConnected = false;
        this.connections.delete(connection.id);
        log.info(`SSH 连接关闭: ${connection.id}`);
      });

      client.on("error", (err: Error) => {
        log.error(`SSH 连接错误: ${connection.id}`, { error: err.message });
        connection.isConnected = false;
      });

      this.connections.set(connection.id, connection);
      log.info(`创建新 SSH 连接: ${connection.id} -> ${config.host}:${config.port || 22}`);

      return connection;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error(`SSH 连接失败: ${config.host}`, { error: msg });
      throw new SSHConnectionError(`无法连接到 ${config.host}: ${msg}`);
    }
  }

  /**
   * 建立 SSH 连接
   */
  private connect(client: any, config: SSHConnectionConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("SSH 连接超时"));
      }, config.readyTimeout || 20_000);

      client.on("ready", () => {
        clearTimeout(timeout);
        resolve();
      });

      client.on("error", (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      });

      const connectOpts: Record<string, unknown> = {
        host: config.host,
        passphrase: config.passphrase,
        password: config.password,
        port: config.port || 22,
        privateKey: config.privateKey,
        readyTimeout: config.readyTimeout || 20_000,
        username: config.username,
        hostVerifier: (key: Buffer): boolean => {
          if (config.hostVerifier) {
            return config.hostVerifier(key);
          }
          if (config.knownHostKeys && config.knownHostKeys.length > 0) {
            const crypto = require("node:crypto");
            const fingerprint = `SHA256:${crypto.createHash("sha256").update(key).digest("base64")}`;
            return config.knownHostKeys.includes(fingerprint);
          }
          // 无已知密钥时拒绝连接，防止中间人攻击
          log.warn(`SSH 主机 ${config.host} 无已知密钥，连接被拒绝（中间人攻击防护）`);
          return false;
        },
      };

      client.connect(connectOpts);
    });
  }

  /**
   * 查找现有连接
   */
  private findExistingConnection(config: SSHConnectionConfig): SSHConnection | undefined {
    for (const conn of this.connections.values()) {
      if (
        conn.config.host === config.host &&
        conn.config.port === config.port &&
        conn.config.username === config.username &&
        conn.isConnected
      ) {
        return conn;
      }
    }
    return undefined;
  }

  /**
   * 驱逐最老的空闲连接
   */
  private async evictOldestIdle(): Promise<void> {
    let oldest: SSHConnection | null = null;
    const now = Date.now();

    for (const conn of this.connections.values()) {
      if (!conn.isConnected) {
        this.connections.delete(conn.id);
        return;
      }
      if (!oldest || conn.lastUsed < oldest.lastUsed) {
        oldest = conn;
      }
    }

    if (oldest && now - oldest.lastUsed.getTime() > this.idleTimeoutMs) {
      await this.closeConnection(oldest.id);
    }
  }

  /**
   * 关闭连接
   */
  async closeConnection(id: string): Promise<void> {
    const conn = this.connections.get(id);
    if (!conn) {
      return;
    }

    try {
      conn.client.end();
    } catch (error) {
      log.warn(`关闭 SSH 连接时出错: ${id}`, { error });
    }

    this.connections.delete(id);
    log.debug(`关闭 SSH 连接: ${id}`);
  }

  /**
   * 获取统计信息
   */
  getStats(): SSHConnectionPoolStats {
    let active = 0;
    for (const conn of this.connections.values()) {
      if (conn.isConnected) {
        active++;
      }
    }

    return {
      active,
      idle: this.connections.size - active,
      total: this.connections.size,
    };
  }

  /**
   * 启动清理定时器
   */
  private startCleanupTimer(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleConnections();
    }, 60_000); // 每分钟检查一次
  }

  /**
   * 清理空闲连接
   */
  private cleanupIdleConnections(): void {
    const now = Date.now();
    const toClose: string[] = [];

    for (const conn of this.connections.values()) {
      if (conn.isConnected && now - conn.lastUsed.getTime() > this.idleTimeoutMs) {
        toClose.push(conn.id);
      }
    }

    for (const id of toClose) {
      void this.closeConnection(id);
    }

    if (toClose.length > 0) {
      log.debug(`清理 ${toClose.length} 个空闲 SSH 连接`);
    }
  }

  /**
   * 关闭所有连接
   */
  async closeAll(): Promise<void> {
    const promises = [...this.connections.keys()].map((id) => this.closeConnection(id));
    await Promise.all(promises);

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

export class SSHConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SSHConnectionError";
  }
}

// 导出单例
export const sshConnectionPool = SSHConnectionPool.getInstance();
