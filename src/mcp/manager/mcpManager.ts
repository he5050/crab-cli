/**
 * MCP 管理器 — 管理多个 MCP Server 的生命周期。
 *
 * 职责:
 *   - 根据配置启动/停止 MCP Server
 *   - 聚合所有 Server 的工具列表
 *   - 自动重连崩溃的 Server
 *   - 与工具注册表联动(注册/注销 MCP 工具)
 *
 * 模块功能:
 *   - startAll:启动所有配置的 MCP Server
 *   - stopAll:停止所有 MCP Server 并清理资源
 *   - restartServer:重启指定 Server
 *   - refreshConfigs:刷新配置，停止已删除的 Server，启动新增的 Server
 *   - connectedClients:获取所有已连接 Server 的客户端
 *   - status:获取所有 Server 的状态摘要
 *   - snapshot:获取所有 Server 的完整状态快照
 *   - getServerConfig:获取指定 Server 的配置
 *   - isStarted:检查管理器是否已启动
 *
 * 使用场景:
 *   - 需要管理多个 MCP Server 时
 *   - 需要在应用启动时初始化所有 MCP 连接
 *   - 需要监控 MCP Server 状态并自动重连时
 *
 * 边界:
 *   1. 管理多个 Server，每个 Server 由独立的 McpClient 处理
 *   2. 默认最大重试次数为 3 次
 *   3. 重连延迟使用指数退避策略
 *   4. 禁用的 Server 会被注册但不连接
 *
 * 流程:
 *   1. 创建 McpManager 实例
 *   2. 调用 startAll() 启动所有配置的 Server
 *   3. 每个 Server 连接成功后自动同步工具到注册表
 *   4. 监控连接状态，自动重连崩溃的 Server
 *   5. 调用 stopAll() 停止所有 Server
 */
import { createLogger } from "@/core/logging/logger";
import { globalBus, type EventBus } from "@/bus";
import { AppEvent } from "@/bus";
import type { McpServerConfig } from "@/schema/config";
import { McpClient, type McpClientCallbacks, type McpConnectionState } from "../client/mcpClient";
import { clearToolsCache, registerTools, unregisterTool } from "@/tool/registry/toolRegistry";
import { loadMcpConfig, resetMcpConfigCache } from "./mcpConfig";
import { classifyMcpToolRisk } from "../tool/riskClassification";
import { createInternalError } from "@/core/errors/appError";
import { createMcpError, toMcpLogPayload } from "../core/errors";

const log = createLogger("mcp:manager");

/** 重连策略 */
export interface ReconnectPolicy {
  /** 最大重试次数，默认 3 */
  maxRetries: number;
  /** 初始延迟(毫秒)，默认 2000 */
  initialDelay: number;
  /** 最大延迟(毫秒)，默认 30000 */
  maxDelay: number;
  /** 延迟倍数，默认 2 */
  backoffMultiplier: number;
}

/** MCP 管理器选项 */
export interface McpManagerOptions {
  /** 获取 MCP Server 配置列表(可选，默认从 mcp.json 加载) */
  getServerConfigs?: () => McpServerConfig[] | Promise<McpServerConfig[]>;
  /** 连接超时(毫秒) */
  connectTimeout?: number;
  /** 工具调用超时(毫秒) */
  callTimeout?: number;
  /** 重连策略 */
  reconnectPolicy?: Partial<ReconnectPolicy>;
  /** 状态变化回调 */
  onStatusChange?: (
    snapshot: {
      name: string;
      state: McpConnectionState | "disabled";
      toolCount: number;
      type: "stdio" | "sse" | "http";
      enabled: boolean;
      error?: string;
    }[],
  ) => void;
}

/** Server 条目 */
interface ServerEntry {
  client: McpClient;
  config: McpServerConfig;
  reconnectCount: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  lastError?: string;
  registeredToolNames: string[];
}

/**
 * MCP 管理器 — 多 Server 生命周期管理。
 */
export class McpManager {
  private servers = new Map<string, ServerEntry>();
  private readonly options: McpManagerOptions;
  private readonly reconnectPolicy: ReconnectPolicy;
  private readonly eventBus: EventBus;
  private started = false;

  constructor(options: McpManagerOptions, eventBus: EventBus = globalBus) {
    this.options = options;
    this.eventBus = eventBus;
    this.reconnectPolicy = {
      backoffMultiplier: options.reconnectPolicy?.backoffMultiplier ?? 2,
      initialDelay: options.reconnectPolicy?.initialDelay ?? 2_000,
      maxDelay: options.reconnectPolicy?.maxDelay ?? 30_000,
      maxRetries: options.reconnectPolicy?.maxRetries ?? 3,
    };
  }

  /** 获取所有已连接 Server 的客户端 */
  get connectedClients(): readonly McpClient[] {
    return [...this.servers.values()].map((e) => e.client).filter((c) => c.isConnected);
  }

  /** 获取所有 Server 的状态摘要 */
  get status(): { name: string; state: McpConnectionState; toolCount: number }[] {
    return [...this.servers.values()].map((e) => ({
      name: e.client.name,
      state: e.client.state,
      toolCount: e.client.tools.length,
    }));
  }

  get snapshot(): {
    name: string;
    state: McpConnectionState | "disabled";
    toolCount: number;
    type: "stdio" | "sse" | "http";
    enabled: boolean;
    error?: string;
    connectDurationMs?: number;
  }[] {
    return [...this.servers.values()].map((e) => ({
      connectDurationMs: e.client.connectDurationMs,
      enabled: e.config.enabled !== false,
      error: e.lastError,
      name: e.client.name,
      state: e.config.enabled === false ? "disabled" : e.client.state,
      toolCount: e.client.tools.length,
      type: e.config.type ?? "stdio",
    }));
  }

  getServerConfig(name: string): McpServerConfig | undefined {
    return this.servers.get(name)?.config;
  }

  /** 是否已启动 */
  get isStarted(): boolean {
    return this.started;
  }

  /**
   * 启动所有配置的 MCP Server。
   * 并行连接，单个失败不影响其他。
   */
  async startAll(): Promise<void> {
    if (this.started) {
      log.warn("MCP Manager 已启动，跳过");
      return;
    }

    this.started = true;
    let configs: McpServerConfig[];
    if (this.options.getServerConfigs) {
      configs = await Promise.resolve(this.options.getServerConfigs());
    } else {
      configs = await loadMcpConfig();
    }

    if (configs.length === 0) {
      log.info("未配置 MCP 服务器");
      return;
    }

    log.info(`启动 ${configs.length} 个 MCP 服务器`);
    this.emitStatus();

    // 并行连接所有 Server
    const results = await Promise.allSettled(configs.map((config) => this.startServer(config)));

    // 汇总结果
    let connected = 0;
    let failed = 0;
    for (const result of results) {
      if (result.status === "fulfilled") {
        connected++;
      } else {
        failed++;
      }
    }

    log.info(`MCP 启动完成: ${connected} 个已连接, ${failed} 个失败`);

    if (failed > 0) {
      log.warn(`${failed} 个服务器连接失败，将重试`);
    }
    this.emitStatus();
  }

  /**
   * 停止所有 MCP Server 并清理资源。
   */
  async stopAll(): Promise<void> {
    if (!this.started) {
      return;
    }
    this.started = false;

    log.info("停止所有 MCP 服务器");

    const disconnects: Promise<void>[] = [];
    for (const [name, entry] of this.servers) {
      this.cancelReconnect(entry);
      unregisterServerTools(entry.client, this.eventBus);
      disconnects.push(entry.client.disconnect());
    }

    await Promise.allSettled(disconnects);
    this.servers.clear();
    log.info("所有 MCP 服务器已停止");
    this.emitStatus();
  }

  /**
   * 重启指定 Server。
   */
  async restartServer(name: string): Promise<void> {
    const entry = this.servers.get(name);
    if (!entry) {
      throw createInternalError("INTERNAL_ERROR", `MCP server "${name}" not found`);
    }

    log.info(`Restarting server: ${name}`);
    this.cancelReconnect(entry);
    unregisterServerTools(entry.client, this.eventBus);
    await entry.client.disconnect();

    // 重置重连计数
    entry.reconnectCount = 0;

    try {
      await entry.client.connect();
      entry.lastError = undefined;
      syncServerTools(entry, this.eventBus);
      this.emitStatus();
    } catch (err) {
      const error = createMcpError(
        err,
        {
          operation: "restartServer",
          serverName: name,
        },
        "runtime",
      );
      entry.lastError = error.message;
      log.error(`Failed to restart server "${name}": ${error.message}`, toMcpLogPayload(error));
      this.emitStatus();
      this.scheduleReconnect(name, entry);
      throw error;
    }
  }

  /**
   * 刷新配置 — 停止已删除的 Server，启动新增的 Server。
   */
  async refreshConfigs(): Promise<void> {
    let configs: McpServerConfig[];
    if (this.options.getServerConfigs) {
      configs = await Promise.resolve(this.options.getServerConfigs());
    } else {
      configs = await loadMcpConfig();
    }
    const configNames = new Set(configs.map((c) => c.name));

    // 停止已删除的 Server
    for (const [name, entry] of this.servers) {
      if (!configNames.has(name)) {
        log.info(`Removing server (no longer in config): ${name}`);
        this.cancelReconnect(entry);
        unregisterServerTools(entry.client, this.eventBus);
        await entry.client.disconnect();
        this.servers.delete(name);
      }
    }

    // 启动新增的 Server，或重新处理 enabled 状态变化的 Server
    for (const config of configs) {
      const existing = this.servers.get(config.name);
      if (!existing) {
        log.info(`Adding new server: ${config.name}`);
        this.startServer(config).catch((error) => {
          log.error(`Failed to start new server "${config.name}": ${error}`);
        });
      } else {
        // 检测 enabled 状态变化:配置与内存不一致时重新处理
        const wasEnabled = existing.config.enabled !== false;
        const nowEnabled = config.enabled !== false;
        if (wasEnabled !== nowEnabled) {
          log.info(`Server "${config.name}" enabled 变化: ${wasEnabled} → ${nowEnabled}，重新加载`);
          this.startServer(config).catch((error) => {
            log.error(`Failed to restart server "${config.name}": ${error}`);
          });
        } else {
          // 即使 enabled 没变，也更新 config(可能有其他字段变化)
          existing.config = config;
        }
      }
    }

    resetMcpConfigCache();
    clearToolsCache();
    this.emitStatus();
  }

  // ── 私有方法 ──────────────────────────────────────────

  /** 启动单个 Server */
  private async startServer(config: McpServerConfig): Promise<void> {
    const { name } = config;

    // 如果已有同名 Server，先清理
    const existing = this.servers.get(name);
    if (existing) {
      this.cancelReconnect(existing);
      unregisterServerTools(existing.client, this.eventBus);
      await existing.client.disconnect().catch((error: unknown) => {
        log.warn(`MCP 客户端 ${name} 断开失败`, { error: error instanceof Error ? error.message : String(error) });
      });
    }

    // 禁用的 server:注册到列表但不连接，UI 可显示状态
    if (config.enabled === false) {
      log.info(`Server "${name}" 已禁用，跳过连接`);
      const disabledClient = new McpClient({
        callbacks: { onError: () => {}, onStateChange: () => {}, onToolsChanged: () => {} },
        config,
      });
      this.servers.set(name, {
        client: disabledClient,
        config,
        reconnectCount: 0,
        reconnectTimer: null,
        registeredToolNames: [],
      });
      this.emitStatus();
      return;
    }

    const callbacks: McpClientCallbacks = {
      onError: (error) => {
        entry.lastError = error.message;
        log.error(`Server "${name}" error: ${error.message}`);
        this.emitStatus();
      },
      onStateChange: (state, prev) => {
        log.info(`Server "${name}": ${prev} → ${state}`);
        if (state === "connected") {
          entry.lastError = undefined;
        }
        if (state === "disconnected" && this.started) {
          // 非主动断开(server 崩溃 / 空闲超时)，尝试重连
          const currentEntry = this.servers.get(name);
          if (currentEntry) {
            unregisterServerTools(currentEntry.client);
            // 重置重连计数(让崩溃/空闲断开有充足重试机会)
            currentEntry.reconnectCount = 0;
            this.scheduleReconnect(name, currentEntry);
          }
        }
        this.emitStatus();
      },
      onToolsChanged: () => {
        entry.lastError = undefined;
        const prevNames = [...entry.registeredToolNames];
        syncServerTools(entry, this.eventBus);
        const newNames = entry.registeredToolNames;
        const added = newNames.filter((n) => !prevNames.includes(n));
        const removed = prevNames.filter((n) => !newNames.includes(n));
        if (added.length > 0 || removed.length > 0) {
          this.eventBus.publish(AppEvent.ToolsListChanged, {
            serverName: name,
            toolCount: newNames.length,
            added,
            removed,
          });
        }
        this.emitStatus();
      },
    };

    const client = new McpClient({
      callTimeout: config.timeout ?? this.options.callTimeout,
      callbacks,
      config,
      connectTimeout: this.options.connectTimeout,
    });

    const entry: ServerEntry = {
      client,
      config,
      reconnectCount: 0,
      reconnectTimer: null,
      registeredToolNames: [],
    };

    this.servers.set(name, entry);

    try {
      log.info(`[MCP管理器] 正在连接服务器: ${name}`);
      await client.connect();
      entry.lastError = undefined;
      log.info(`[MCP管理器] 服务器连接成功，正在同步工具: ${name}`);
      syncServerTools(entry, this.eventBus);
      log.info(`[MCP管理器] 服务器工具同步完成: ${name}, 共 ${entry.registeredToolNames.length} 个工具`);
      this.emitStatus();
    } catch (err) {
      const error = createMcpError(
        err,
        {
          operation: "connectServer",
          serverName: name,
        },
        "runtime",
      );
      entry.lastError = error.message;
      log.error(`[MCP管理器] 服务器连接失败: ${name} — ${error.message}`, toMcpLogPayload(error));
      this.emitStatus();
      this.scheduleReconnect(name, entry);
      throw error;
    }
  }

  /** 安排重连 */
  private scheduleReconnect(name: string, entry: ServerEntry): void {
    if (!this.started) {
      return;
    }
    if (entry.reconnectCount >= this.reconnectPolicy.maxRetries) {
      log.error(`[MCP管理器] 服务器 "${name}" 重连次数已达上限 (${this.reconnectPolicy.maxRetries})，放弃重连`);
      return;
    }

    const delay = Math.min(
      this.reconnectPolicy.initialDelay * this.reconnectPolicy.backoffMultiplier ** entry.reconnectCount,
      this.reconnectPolicy.maxDelay,
    );

    entry.reconnectCount++;
    log.info(
      `[MCP管理器] 服务器 "${name}" 将在 ${delay}ms 后重连 (第 ${entry.reconnectCount}/${this.reconnectPolicy.maxRetries} 次)`,
    );

    entry.reconnectTimer = setTimeout(async () => {
      entry.reconnectTimer = null;
      if (!this.started) {
        return;
      } // 防止已停止后仍执行重连
      log.info(`[MCP管理器] 服务器 "${name}" 开始第 ${entry.reconnectCount} 次重连...`);
      try {
        await entry.client.connect();
        entry.reconnectCount = 0;
        entry.lastError = undefined;
        syncServerTools(entry, this.eventBus);
        log.info(`[MCP管理器] 服务器 "${name}" 重连成功`);
        this.emitStatus();
      } catch (err) {
        const error = createMcpError(
          err,
          {
            operation: "reconnectServer",
            serverName: name,
          },
          "runtime",
        );
        entry.lastError = error.message;
        log.error(`[MCP管理器] 服务器 "${name}" 重连失败 — ${error.message}`, toMcpLogPayload(error));
        this.emitStatus();
        this.scheduleReconnect(name, entry);
      }
    }, delay);
  }

  /** 取消重连定时器 */
  private cancelReconnect(entry: ServerEntry): void {
    if (entry.reconnectTimer) {
      clearTimeout(entry.reconnectTimer);
      entry.reconnectTimer = null;
    }
    entry.reconnectCount = 0;
  }

  private emitStatus(): void {
    this.options.onStatusChange?.(this.snapshot);
  }
}

// ── 工具函数 ────────────────────────────────────────────

function syncServerTools(entry: ServerEntry, eventBus: EventBus = globalBus): void {
  unregisterServerTools(entry, eventBus);
  const disabled = new Set(entry.config.disabledTools ?? []);
  const nextTools = entry.client.tools.filter((tool) => {
    const rawName = tool.name.startsWith(`${entry.client.name}_`)
      ? tool.name.slice(entry.client.name.length + 1)
      : tool.name;
    return !disabled.has(rawName);
  });
  if (nextTools.length === 0) {
    entry.registeredToolNames = [];
    return;
  }
  // 信任边界审计:标记高风险 MCP 工具
  for (const tool of nextTools) {
    const rawName = tool.name.startsWith(`${entry.client.name}_`)
      ? tool.name.slice(entry.client.name.length + 1)
      : tool.name;
    const risk = classifyMcpToolRisk(rawName);
    if (risk === "high") {
      log.warn(`[MCP 信任边界] 高风险工具 "${rawName}" 来自 "${entry.client.name}" — 建议在配置中添加 disabledTools`);
    } else if (risk === "medium") {
      log.info(`[MCP 信任边界] 中风险工具 "${rawName}" 来自 "${entry.client.name}"`);
    }
  }

  registerTools([...nextTools]);
  const newToolNames = nextTools.map((tool) => tool.name);
  const added = newToolNames.filter((n) => !entry.registeredToolNames.includes(n));
  const removed = entry.registeredToolNames.filter((n) => !newToolNames.includes(n));
  entry.registeredToolNames = newToolNames;
  log.info(`Registered ${nextTools.length} tools from "${entry.client.name}"`);
  // 发布工具列表变更事件，便于 UI 和 ConversationHandler 响应
  if (added.length > 0 || removed.length > 0) {
    eventBus.publish(AppEvent.ToolsListChanged, {
      added,
      removed,
      serverName: entry.client.name,
      toolCount: nextTools.length,
    });
  }
}

/** 从全局工具注册表注销 Server 的工具 */
function unregisterServerTools(entry: ServerEntry | McpClient, eventBus: EventBus = globalBus): void {
  if (entry instanceof McpClient) {
    const count = entry.tools.length;
    const removed = entry.tools.map((t) => t.name);
    for (const tool of entry.tools) {
      unregisterTool(tool.name);
    }
    if (count > 0) {
      log.debug(`Unregistered ${count} tools from "${entry.name}"`);
      eventBus.publish(AppEvent.ToolsListChanged, {
        added: [],
        removed,
        serverName: entry.name,
        toolCount: 0,
      });
    }
    return;
  }
  const count = entry.registeredToolNames.length;
  const removed = [...entry.registeredToolNames];
  for (const toolName of entry.registeredToolNames) {
    unregisterTool(toolName);
  }
  entry.registeredToolNames = [];
  if (count > 0) {
    log.debug(`Unregistered ${count} tools from "${entry.client.name}"`);
    eventBus.publish(AppEvent.ToolsListChanged, {
      added: [],
      removed,
      serverName: entry.client.name,
      toolCount: 0,
    });
  }
}
