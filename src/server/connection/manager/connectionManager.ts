/**
 * 连接管理器 — 管理所有连接的生命周期和状态。
 *
 * 职责:
 *   - 管理连接的创建、更新、删除操作
 *   - 处理连接的建立和断开逻辑
 *   - 维护连接状态和事件通知
 *   - 持久化连接配置到本地文件
 *
 * 模块功能:
 *   - ConnectionManager: 连接管理器类(单例模式)
 *   - getInstance: 获取管理器单例
 *   - addConnection: 添加新连接
 *   - getConnection: 获取指定连接
 *   - getAllConnections: 获取所有连接
 *   - getConnections: 根据过滤器获取连接
 *   - updateConnection: 更新连接配置
 *   - removeConnection: 删除连接
 *   - connect: 建立连接
 *   - disconnect: 断开连接
 *   - disconnectAll: 断开所有连接
 *   - getActiveConnection: 获取当前活动连接
 *   - setActiveConnection: 设置活动连接
 *   - clearActiveConnection: 清除活动连接
 *   - getConnectionContext: 获取连接上下文
 *   - getActiveConnectionContext: 获取活动连接上下文
 *   - getStats: 获取连接统计信息
 *   - addEventListener: 添加连接事件监听器
 *
 * 使用场景:
 *   - 应用启动时加载已保存的连接配置
 *   - 用户管理多个远程/本地连接
 *   - 在不同连接间快速切换工作环境
 *   - 监听连接状态变化(如断开、错误)
 *
 * 边界:
 * 1. 仅负责连接管理，不实现具体连接协议
 * 2. 连接配置持久化在 ~/.crab/connections.json
 * 3. 连接状态保存在内存中，重启后需重新连接
 * 4. SSH 连接通过 SSHConnectionPool 复用
 * 5. 使用单例模式确保全局唯一实例
 *
 * 流程:
 * 1. 通过 getInstance 获取单例实例
 * 2. 调用 init() 从文件系统加载已保存的连接
 * 3. 通过 addConnection 创建新连接
 * 4. 调用 connect() 建立连接(支持 local/ssh/docker/wsl)
 * 5. 通过 setActiveConnection 设置当前工作连接
 * 6. 应用退出时调用 disconnectAll 清理
 */
import type {
  Connection,
  ConnectionConfig,
  ConnectionContext,
  ConnectionEvent,
  ConnectionEventType,
  ConnectionFilter,
  ConnectionStats,
} from "../types";
import { CONNECTION_STUB_LABEL } from "../types";
import { createLogger } from "@/core/logging/logger";

import { readJsonFile, writeJsonFile } from "@/core/utilities/fileUtils";
import { getDataDir } from "@/config";
import path from "node:path";
import fs from "node:fs";
import { InternalError, SystemError, UserError } from "@/core/errors/appError";
import { ERROR_CODES } from "@/core/errors/errorCodes";

const log = createLogger("connection:manager");
const CONNECTIONS_FILE = "connections.json";

function createExperimentalConnectionError(type: "docker" | "wsl"): InternalError {
  return new InternalError(
    ERROR_CODES.INTERNAL.NOT_IMPLEMENTED.code,
    `${type} 连接当前为 ${CONNECTION_STUB_LABEL}，尚未实现真实 runtime 集成`,
    { context: { stub: true, type } },
  );
}

/**
 * 连接管理器类。
 *
 * 使用单例模式确保全局只有一个连接管理器实例。
 */
export class ConnectionManager {
  private static instance: ConnectionManager;
  private connections = new Map<string, Connection>();
  private initialized = false;
  private activeConnectionId: string | null = null;
  private eventListeners = new Set<(event: ConnectionEvent) => void>();
  /** 正在连接中的 Promise 缓冲，防止对同一 ID 并发 connect() */
  private connectingPromises = new Map<string, Promise<Connection>>();
  /** init() 的 in-flight Promise，防止并发初始化重复执行文件 I/O */
  private initPromise: Promise<void> | null = null;

  /**
   * 获取 ConnectionManager 单例实例。
   */
  static getInstance(): ConnectionManager {
    if (!ConnectionManager.instance) {
      ConnectionManager.instance = new ConnectionManager();
    }
    return ConnectionManager.instance;
  }

  private constructor() {
    // 私有构造函数，防止外部实例化
  }

  /**
   * 初始化连接管理器。
   *
   * 通过 in-flight Promise 缓冲防止并发初始化重复执行文件 I/O。
   * 从 ~/.crab/connections.json 加载已保存的连接配置。
   */
  async init(): Promise<void> {
    if (this.initialized) {
      log.debug("连接管理器已初始化，跳过");
      return;
    }

    if (!this.initPromise) {
      this.initPromise = this._doInit().finally(() => {
        this.initPromise = null;
      });
    }

    return this.initPromise;
  }

  /**
   * 执行实际的初始化流程（内部方法，由 init() 调度）。
   */
  private async _doInit(): Promise<void> {
    const dataDir = getDataDir();
    const connectionsPath = path.join(dataDir, CONNECTIONS_FILE);

    try {
      const configs = await readJsonFile<ConnectionConfig[]>(connectionsPath);
      if (configs && Array.isArray(configs)) {
        for (const config of configs) {
          const connection: Connection = {
            config,
            id: config.id,
            lastUsed: new Date(),
            status: "disconnected",
          };
          this.connections.set(config.id, connection);
        }
        log.info(`已加载 ${configs.length} 个连接配置`);
      }
    } catch (error) {
      log.warn("加载连接配置失败，将使用空配置", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    this.initialized = true;
  }

  /**
   * 获取连接配置文件路径。
   */
  private getConnectionsFilePath(): string {
    return path.join(getDataDir(), CONNECTIONS_FILE);
  }

  /**
   * 确保数据目录存在。
   */
  private ensureDataDir(): void {
    const dataDir = getDataDir();
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  /**
   * 保存连接配置到文件。
   *
   * @throws 当文件写入失败时抛出 SystemError
   */
  private async saveConnections(): Promise<void> {
    this.ensureDataDir();
    const configs = [...this.connections.values()].map((c) => c.config);
    const success = await writeJsonFile(this.getConnectionsFilePath(), configs);
    if (!success) {
      throw new SystemError(ERROR_CODES.SYSTEM.FS_WRITE_ERROR.code, "保存连接配置失败", {
        context: { path: this.getConnectionsFilePath() },
      });
    }
  }

  /**
   * 触发连接事件。
   */
  private emitEvent(type: ConnectionEventType, connectionId: string, error?: string): void {
    const event: ConnectionEvent = {
      connectionId,
      error,
      timestamp: new Date(),
      type,
    };

    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        log.error("连接事件监听器执行失败", { error: String(error) });
      }
    }
  }

  /**
   * 添加连接事件监听器。
   */
  addEventListener(listener: (event: ConnectionEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  /**
   * 添加新连接。
   *
   * @param config - 连接配置
   * @returns 创建的连接实例
   * @throws 如果连接 ID 已存在
   */
  async addConnection(config: ConnectionConfig): Promise<Connection> {
    await this.init();

    if (this.connections.has(config.id)) {
      throw new UserError(ERROR_CODES.USER.RESOURCE_EXISTS.code, `连接 ID 已存在: ${config.id}`, {
        context: { connectionId: config.id },
      });
    }

    const connection: Connection = {
      config,
      id: config.id,
      lastUsed: new Date(),
      status: "disconnected",
    };

    this.connections.set(config.id, connection);
    await this.saveConnections();

    this.emitEvent("connection:created", config.id);
    log.info(`连接已创建: ${config.name} (${config.id})`);

    return connection;
  }

  /**
   * 获取指定 ID 的连接。
   *
   * @param id - 连接 ID
   * @returns 连接实例，如果不存在则返回 undefined
   */
  getConnection(id: string): Connection | undefined {
    return this.connections.get(id);
  }

  /**
   * 获取所有连接。
   *
   * @returns 连接实例数组
   */
  getAllConnections(): Connection[] {
    return [...this.connections.values()];
  }

  /**
   * 根据过滤器获取连接。
   *
   * @param filter - 连接过滤器
   * @returns 符合条件的连接实例数组
   */
  getConnections(filter?: ConnectionFilter): Connection[] {
    let connections = this.getAllConnections();

    if (filter) {
      connections = connections.filter((conn) => {
        if (filter.type && conn.config.type !== filter.type) {
          return false;
        }
        if (filter.status && conn.status !== filter.status) {
          return false;
        }
        if (filter.name && !conn.config.name.includes(filter.name)) {
          return false;
        }
        return true;
      });
    }

    return connections;
  }

  /**
   * 更新连接配置。
   *
   * @param id - 连接 ID
   * @param updates - 部分配置更新
   * @returns 更新后的连接实例，如果不存在则返回 null
   */
  async updateConnection(id: string, updates: Partial<ConnectionConfig>): Promise<Connection | null> {
    await this.init();

    const connection = this.connections.get(id);
    if (!connection) {
      return null;
    }

    // 不允许修改 ID
    const { id: _, ...safeUpdates } = updates;

    connection.config = {
      ...connection.config,
      ...safeUpdates,
    };

    await this.saveConnections();
    this.emitEvent("connection:updated", id);
    log.info(`连接已更新: ${connection.config.name} (${id})`);

    return connection;
  }

  /**
   * 删除连接。
   *
   * @param id - 连接 ID
   * @returns 是否成功删除
   */
  async removeConnection(id: string): Promise<boolean> {
    await this.init();

    const connection = this.connections.get(id);
    if (!connection) {
      return false;
    }

    // 如果连接处于连接中或已连接状态，先断开
    if (connection.status === "connected" || connection.status === "connecting") {
      await this.disconnect(id);
    }

    // 如果删除的是当前活动连接，清除活动连接
    if (this.activeConnectionId === id) {
      this.activeConnectionId = null;
    }

    this.connections.delete(id);
    await this.saveConnections();

    this.emitEvent("connection:removed", id);
    log.info(`连接已删除: ${connection.config.name} (${id})`);

    return true;
  }

  /**
   * 建立连接。
   *
   * 通过 in-flight Promise 缓冲防止对同一 ID 并发调用导致重复建立连接。
   *
   * @param id - 连接 ID
   * @returns 连接后的连接实例
   * @throws 如果连接不存在或连接失败
   */
  async connect(id: string): Promise<Connection> {
    await this.init();

    const connection = this.connections.get(id);
    if (!connection) {
      throw new UserError(ERROR_CODES.USER.RESOURCE_NOT_FOUND.code, `连接不存在: ${id}`, {
        context: { connectionId: id },
      });
    }

    if (connection.status === "connected") {
      log.debug(`连接已经是连接状态: ${id}`);
      return connection;
    }

    // 复用已有的 connecting Promise，防止并发 connect() 重复建立连接
    const existing = this.connectingPromises.get(id);
    if (existing) {
      log.debug(`复用进行中的连接 Promise: ${id}`);
      return existing;
    }

    const promise = this._doConnect(connection);
    this.connectingPromises.set(id, promise);
    try {
      return await promise;
    } finally {
      this.connectingPromises.delete(id);
    }
  }

  /**
   * 执行实际的连接流程（内部方法，由 connect() 调度）。
   */
  private async _doConnect(connection: Connection): Promise<Connection> {
    const id = connection.id;

    // 设置连接中状态
    connection.status = "connecting";
    this.emitEvent("connection:connecting", id);
    log.info(`正在连接: ${connection.config.name} (${id})`);

    try {
      await this.performConnect(connection);

      connection.status = "connected";
      connection.connectedAt = new Date();
      connection.lastUsed = new Date();
      connection.error = undefined;

      this.emitEvent("connection:connected", id);
      log.info(`连接成功: ${connection.config.name} (${id})`);

      return connection;
    } catch (error) {
      connection.status = "error";
      connection.error = error instanceof Error ? error.message : String(error);

      this.emitEvent("connection:error", id, connection.error);
      log.error(`连接失败: ${connection.config.name} (${id})`, { error: connection.error });

      throw error;
    }
  }

  /**
   * 执行实际的连接操作。
   *
   * 根据连接类型分发到对应的连接实现:
   *   - local: 验证工作目录存在
   *   - ssh: 通过 SSHConnectionPool 建立连接
   *   - docker/wsl: 验证工作目录(后续集成)
   */
  private async performConnect(connection: Connection): Promise<void> {
    const { type, workingDir, host, port, username, auth, id } = connection.config;

    switch (type) {
      case "local": {
        if (!fs.existsSync(workingDir)) {
          throw new SystemError(ERROR_CODES.SYSTEM.FILE_NOT_FOUND.code, `工作目录不存在: ${workingDir}`, {
            context: { workingDir },
          });
        }
        // Local 连接无网络延迟，仅目录验证
        break;
      }

      case "ssh": {
        if (!host) {
          throw new UserError(ERROR_CODES.USER.MISSING_PARAMETER.code, "SSH 连接缺少主机地址", {
            context: { connectionId: id, type },
          });
        }
        const { sshConnectionPool } = await import("@/server/ssh");
        await sshConnectionPool.getConnection({
          host,
          passphrase: auth?.passphrase,
          password: auth?.password,
          port: port ?? 22,
          privateKey: auth?.privateKey,
          username: username ?? "root",
        });
        log.info(`SSH 连接已建立: ${host}:${port ?? 22}`);
        break;
      }

      case "docker": {
        throw createExperimentalConnectionError("docker");
      }

      case "wsl": {
        throw createExperimentalConnectionError("wsl");
      }

      default: {
        throw new UserError(ERROR_CODES.USER.INVALID_PARAMETER.code, `不支持的连接类型: ${type}`, {
          context: { connectionId: id, type },
        });
      }
    }
  }

  /**
   * 断开连接。
   *
   * @param id - 连接 ID
   */
  async disconnect(id: string): Promise<void> {
    const connection = this.connections.get(id);
    if (!connection) {
      return;
    }

    if (connection.status === "disconnected") {
      return;
    }

    // 如果正在连接中，等待连接完成后再断开，避免状态竞争
    if (connection.status === "connecting") {
      const pending = this.connectingPromises.get(id);
      if (pending) {
        try {
          await pending;
        } catch (error) {
          // 连接已失败，直接清理即可
          log.debug(`连接 ${id} 并发 connect 失败: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    try {
      // TODO: 根据连接类型执行实际的断开逻辑
      await this.performDisconnect(connection);
    } catch (error) {
      log.warn(`断开连接时出错: ${id}`, { error: String(error) });
    }

    connection.status = "disconnected";
    connection.disconnectedAt = new Date();
    connection.error = undefined;

    this.emitEvent("connection:disconnected", id);
    log.info(`连接已断开: ${connection.config.name} (${id})`);
  }

  /**
   * 执行实际的断开操作。
   *
   * 根据连接类型分发到对应的断开实现。
   */
  private async performDisconnect(connection: Connection): Promise<void> {
    const { type, host } = connection.config;

    switch (type) {
      case "ssh": {
        // SSH 连接由连接池管理生命周期，此处记录即可
        log.info(`SSH 断开: ${host}`);
        break;
      }
      default: {
        // Local/docker/wsl 无需主动断开
        break;
      }
    }
  }

  /**
   * 获取当前活动连接。
   *
   * @returns 活动连接实例，如果没有则返回 undefined
   */
  getActiveConnection(): Connection | undefined {
    if (!this.activeConnectionId) {
      return undefined;
    }
    return this.connections.get(this.activeConnectionId);
  }

  /**
   * 设置活动连接。
   *
   * @param id - 连接 ID
   * @throws 如果连接不存在
   */
  async setActiveConnection(id: string): Promise<void> {
    await this.init();

    const connection = this.connections.get(id);
    if (!connection) {
      throw new UserError(ERROR_CODES.USER.RESOURCE_NOT_FOUND.code, `连接不存在: ${id}`, {
        context: { connectionId: id },
      });
    }

    // 如果连接未连接，先建立连接
    if (connection.status !== "connected") {
      await this.connect(id);
    }

    this.activeConnectionId = id;
    connection.lastUsed = new Date();

    log.info(`活动连接已设置: ${connection.config.name} (${id})`);
  }

  /**
   * 清除活动连接。
   */
  clearActiveConnection(): void {
    this.activeConnectionId = null;
    log.info("活动连接已清除");
  }

  /**
   * 获取连接上下文。
   *
   * @param id - 连接 ID
   * @returns 连接上下文，如果连接不存在或未连接则返回 null
   */
  getConnectionContext(id: string): ConnectionContext | null {
    const connection = this.connections.get(id);
    if (!connection || connection.status !== "connected") {
      return null;
    }

    return {
      connectionId: id,
      env: connection.config.env || {},
      host: connection.config.host,
      type: connection.config.type,
      workingDir: connection.config.workingDir,
    };
  }

  /**
   * 获取活动连接的上下文。
   *
   * @returns 活动连接上下文，如果没有活动连接则返回 null
   */
  getActiveConnectionContext(): ConnectionContext | null {
    if (!this.activeConnectionId) {
      return null;
    }
    return this.getConnectionContext(this.activeConnectionId);
  }

  /**
   * 获取连接统计信息。
   *
   * @returns 连接统计
   */
  getStats(): ConnectionStats {
    const connections = this.getAllConnections();
    let connected = 0;
    let connecting = 0;
    let disconnected = 0;
    let error = 0;

    for (const c of connections) {
      switch (c.status) {
        case "connected":
          connected++;
          break;
        case "connecting":
          connecting++;
          break;
        case "disconnected":
          disconnected++;
          break;
        case "error":
          error++;
          break;
      }
    }

    return { total: connections.length, connected, connecting, disconnected, error };
  }

  /**
   * 断开所有连接。
   */
  async disconnectAll(): Promise<void> {
    const promises = this.getAllConnections()
      .filter((c) => c.status === "connected" || c.status === "connecting")
      .map((c) => this.disconnect(c.id));

    await Promise.all(promises);
  }

  /**
   * 检查连接是否存在。
   *
   * @param id - 连接 ID
   * @returns 是否存在
   */
  hasConnection(id: string): boolean {
    return this.connections.has(id);
  }
}

/**
 * 全局连接管理器实例。
 */
export const connectionManager = ConnectionManager.getInstance();
