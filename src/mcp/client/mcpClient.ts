/**
 * MCP 客户端 — 与单个 MCP Server 通信。
 *
 * 职责:
 *   - 管理 MCP 连接生命周期(连接 / 断开 / 重连)
 *   - 发现工具(listTools)
 *   - 调用工具(callTool)
 *   - 连接状态管理与超时控制
 *   - 支持 STDIO / SSE / StreamableHTTP 传输
 *   - 感知 server 崩溃并主动触发状态回调
 *   - 连接级错误重试
 *   - 进度上报(resetTimeoutOnProgress)
 *   - AbortSignal 取消支持
 *
 * 模块功能:
 *   - connect:建立与 MCP Server 的连接
 *   - disconnect:断开与 MCP Server 的连接
 *   - callTool:调用 MCP Server 上的工具
 *   - refreshTools:重新发现工具(工具变更时调用)
 *   - listPrompts:列出可用的 prompts
 *   - listResources:列出可用的 resources
 *   - getPrompt:获取指定 prompt
 *   - readResource:读取指定 resource
 *   - dispose:销毁客户端，释放资源
 *
 * 使用场景:
 *   - 需要与单个 MCP Server 建立通信时
 *   - 需要调用 MCP 工具时
 *   - 需要管理 MCP 连接生命周期时
 *
 * 边界:
 *   1. 只处理单个 MCP Server 的连接
 *   2. 不处理多个 Server 的聚合管理(由 McpManager 负责)
 *   3. 工具调用超时默认为 60 秒
 *   4. 连接超时默认为 30 秒
 *
 * 流程:
 *   1. 创建 McpClient 实例
 *   2. 调用 connect() 建立连接
 *   3. 自动发现可用工具
 *   4. 使用 callTool() 调用工具
 *   5. 使用 disconnect() 或 dispose() 关闭连接
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ListRootsRequestSchema, ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { pathToFileURL } from "node:url";
import { createLogger } from "@/core/logging/logger";
import { withTimeout } from "@/core/concurrency/promiseUtils";
import {
  MCP_CALL_TIMEOUT_MS,
  MCP_CONNECT_TIMEOUT_MS,
  MCP_IDLE_CHECK_INTERVAL_MS,
  MCP_IDLE_TIMEOUT_MS,
  MCP_TOOLS_CACHE_TTL_MS,
} from "@/config";
import type { McpServerConfig } from "@/schema/config";
import type { ToolDefinition } from "@/tool/types";
import { type McpTransport, createTransport, isConnectionError, shouldFallbackToSSE } from "./transport";

export { isConnectionError };
import { mcpToolToToolDefinition } from "../tool/toolConverter";
import { createInternalError } from "@/core/errors/appError";
import { compactId } from "@/core/id";
import { createMcpError, getMcpErrorMessage, toMcpLogPayload } from "../core/errors";

const log = createLogger("mcp:client");

/** 连接状态 */
export type McpConnectionState = "disconnected" | "connecting" | "connected" | "error";

/** MCP 客户端事件回调 */
export interface McpClientCallbacks {
  onStateChange?: (state: McpConnectionState, prev: McpConnectionState) => void;
  onError?: (error: Error) => void;
  /** 工具调用进度回调 */
  onProgress?: (progress: { progress: number; total?: number; message?: string }) => void;
  /** 工具列表变更回调 */
  onToolsChanged?: (tools: readonly ToolDefinition<any>[]) => void;
  /** OAuth 授权 URL 回调 */
  onOAuthRedirect?: (authorizationUrl: string) => void;
}

/** MCP 客户端选项 */
export interface McpClientOptions {
  /** 服务器配置 */
  config: McpServerConfig;
  /** 连接超时(毫秒)，默认 30000 */
  connectTimeout?: number;
  /** 工具调用超时(毫秒)，默认 60000，可被 config.timeout 覆盖 */
  callTimeout?: number;
  /** 事件回调 */
  callbacks?: McpClientCallbacks;
}

/**
 * MCP 客户端 — 与单个 MCP Server 的连接。
 *
 * 每个实例管理一个 MCP Server 的完整生命周期。
 * 支持 STDIO(本地子进程)、SSE(已弃用但兼容)、StreamableHTTP 传输。
 */
export class McpClient {
  private client: Client | null = null;
  private transport: McpTransport | null = null;
  private _state: McpConnectionState = "disconnected";
  private readonly config: McpServerConfig;
  private readonly connectTimeout: number;
  private readonly callTimeout: number;
  private readonly callbacks: McpClientCallbacks;
  private _tools: ToolDefinition<any>[] = [];
  private disposed = false;
  /** 工具发现的 TTL 时间戳 */
  private toolsDiscoveredAt = 0;
  /** 连接耗时(毫秒)，仅连接成功后有意义 */
  private _connectDurationMs = 0;
  get connectDurationMs(): number {
    return this._connectDurationMs;
  }
  private static readonly TOOLS_CACHE_TTL = MCP_TOOLS_CACHE_TTL_MS;
  /** 空闲超时计时器 */
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  /** 最近一次活跃时间 */
  private lastActiveAt = 0;
  private static readonly IDLE_TIMEOUT = MCP_IDLE_TIMEOUT_MS;
  private pendingAuthTransport: StreamableHTTPClientTransport | SSEClientTransport | null = null;

  constructor(options: McpClientOptions) {
    this.config = options.config;
    this.connectTimeout = options.connectTimeout ?? MCP_CONNECT_TIMEOUT_MS;
    this.callTimeout = options.callTimeout ?? MCP_CALL_TIMEOUT_MS;
    this.callbacks = options.callbacks ?? {};
  }

  /** 当前连接状态 */
  get state(): McpConnectionState {
    return this._state;
  }

  /** 服务器名称 */
  get name(): string {
    return this.config.name;
  }

  /** 已发现的工具列表 */
  get tools(): readonly ToolDefinition<any>[] {
    return this._tools;
  }

  /** 是否已连接 */
  get isConnected(): boolean {
    return this._state === "connected";
  }

  /** 工具缓存是否过期 */
  get toolsCacheExpired(): boolean {
    return Date.now() - this.toolsDiscoveredAt > McpClient.TOOLS_CACHE_TTL;
  }

  /**
   * 连接到 MCP Server。
   * 根据 config.type 选择 STDIO / SSE / StreamableHTTP 传输。
   */
  async connect(): Promise<void> {
    if (this._state === "connected" || this._state === "connecting") {
      log.warn(`${this.name}: already ${this._state}, skipping`);
      return;
    }
    if (this.disposed) {
      throw createInternalError("INTERNAL_ERROR", `McpClient "${this.name}" has been disposed`);
    }

    // 检查是否被禁用
    if (this.config.enabled === false) {
      log.info(`${this.name}: server is disabled, skipping`);
      this.setState("disconnected");
      return;
    }

    this.setState("connecting");
    const connectStart = Date.now();
    const connectId = compactId("-", 7);

    const transportType = this.config.type ?? "stdio";
    log.info(`[${connectId}] 开始连接 MCP 服务器: ${this.name}`);
    log.info(`[${connectId}] 传输类型: ${transportType.toUpperCase()}`);
    log.debug(`[${connectId}] 服务器配置:`, {
      args: this.config.args,
      command: this.config.command,
      timeout: this.config.timeout,
      url: this.config.url,
    });

    try {
      await this.connectWithTransportFallback(transportType);

      // 连接成功后订阅 transport 层的 error/close 事件
      this.wireClientEvents();

      const connectEnd = Date.now();
      this._connectDurationMs = connectEnd - connectStart;
      this.setState("connected");
      this.lastActiveAt = Date.now();
      log.info(`[${connectId}] MCP 服务器连接成功: ${this.name} (${this._connectDurationMs}ms)`);

      // 发现工具
      log.info(`[${connectId}] 开始发现工具...`);
      await this.discoverTools();

      // 启动空闲超时监控
      this.startIdleTimer();
      log.info(`[${connectId}] MCP 服务器初始化完成: ${this.name}`);
    } catch (err) {
      this.setState("error");
      const error = createMcpError(
        err,
        {
          operation: "connect",
          serverName: this.name,
          transportType,
        },
        "runtime",
      );
      log.error(`[${connectId}] MCP 服务器连接失败: ${this.name} — ${error.message}`, toMcpLogPayload(error));
      this.callbacks.onError?.(error);
      this.cleanup();
      throw error;
    }
  }

  async finishAuth(authorizationCode: string): Promise<void> {
    if (!this.pendingAuthTransport) {
      throw new UnauthorizedError(`No pending OAuth transport for ${this.name}`);
    }
    await this.pendingAuthTransport.finishAuth(authorizationCode);
    this.pendingAuthTransport = null;
  }

  /**
   * 断开与 MCP Server 的连接。
   */
  async disconnect(): Promise<void> {
    if (this._state === "disconnected") {
      return;
    }
    log.info(`${this.name}: disconnecting`);
    this.stopIdleTimer();
    this.cleanup();
    this.setState("disconnected");
  }

  /**
   * 调用 MCP Server 上的工具。
   * 支持连接错误自动重试(一次)，支持进度上报和 AbortSignal。
   */
  async callTool(
    name: string,
    args: Record<string, unknown>,
    options?: { abortSignal?: AbortSignal },
  ): Promise<unknown> {
    if (!this.client || !this.isConnected) {
      throw createInternalError("INTERNAL_ERROR", `McpClient "${this.name}" is not connected`);
    }

    this.lastActiveAt = Date.now();
    const callId = compactId("-", 7);
    log.info(`[${callId}] 开始调用 MCP 工具: ${this.name}/${name}`);
    log.debug(`[${callId}] 工具参数:`, args);

    const serverTimeout = this.config.timeout;
    const effectiveTimeout = serverTimeout ?? this.callTimeout;
    log.debug(`[${callId}] 超时设置: ${effectiveTimeout}ms`);

    try {
      const result = await withTimeout(
        this.client.callTool({ arguments: args, name }, undefined, {
          // 进度上报时重置超时
          onprogress: (progress: { progress: number; total?: number; message?: string }) => {
            const percent = progress.total ? Math.round((progress.progress / progress.total) * 100) : progress.progress;
            const message = progress.message ? ` - ${progress.message}` : "";
            log.info(`[${callId}] 进度: ${percent}%${message}`);
            this.callbacks.onProgress?.(progress);
          },
          timeout: effectiveTimeout,
          resetTimeoutOnProgress: true,
          signal: options?.abortSignal,
        }),
        effectiveTimeout,
        `${this.name}: tool "${name}" timed out after ${effectiveTimeout}ms`,
      );

      log.info(`[${callId}] MCP 工具调用完成: ${this.name}/${name}`);
      log.debug(`[${callId}] 返回结果:`, result);
      return result;
    } catch (err) {
      const error = createMcpError(
        err,
        {
          operation: "callTool",
          serverName: this.name,
          toolName: name,
        },
        "runtime",
      );

      // 连接级错误:尝试一次重连后重试
      if (isConnectionError(error)) {
        log.warn(`${this.name}: connection error during tool call, retrying once — ${error.message}`);
        try {
          this.cleanup();
          await this.connect();
          const retryResult = await withTimeout(
            this.client!.callTool({ arguments: args, name }, undefined, {
              resetTimeoutOnProgress: true,
              signal: options?.abortSignal,
              timeout: effectiveTimeout,
            }),
            effectiveTimeout,
            `${this.name}: tool "${name}" retry timed out after ${effectiveTimeout}ms`,
          );
          log.debug(`${this.name}: tool "${name}" retry succeeded`);
          return retryResult;
        } catch (error) {
          const retryError = createMcpError(
            error,
            {
              operation: "callToolRetry",
              serverName: this.name,
              toolName: name,
            },
            "runtime",
          );
          log.error(
            `${this.name}: tool "${name}" retry also failed — ${retryError.message}`,
            toMcpLogPayload(retryError),
          );
          throw retryError;
        }
      }

      log.error(`${this.name}: tool "${name}" failed — ${error.message}`, toMcpLogPayload(error));
      throw error;
    }
  }

  /**
   * 重新发现工具(工具变更时调用)。
   * 如果缓存未过期，跳过重新发现。
   */
  async refreshTools(force = false): Promise<void> {
    if (!this.client || !this.isConnected) {
      throw createInternalError("INTERNAL_ERROR", `McpClient "${this.name}" is not connected`);
    }
    if (!force && !this.toolsCacheExpired) {
      log.debug(`${this.name}: tools cache still valid, skipping refresh`);
      return;
    }
    await this.discoverTools();
  }

  async listPrompts(): Promise<{ name: string; description?: string }[]> {
    if (!this.client || !this.isConnected) {
      throw createInternalError("INTERNAL_ERROR", `McpClient "${this.name}" is not connected`);
    }
    const result = await this.client.listPrompts();
    return result.prompts ?? [];
  }

  async listResources(): Promise<{ name: string; uri: string; description?: string; mimeType?: string }[]> {
    if (!this.client || !this.isConnected) {
      throw createInternalError("INTERNAL_ERROR", `McpClient "${this.name}" is not connected`);
    }
    const result = await this.client.listResources();
    return result.resources ?? [];
  }

  async getPrompt(name: string, args?: Record<string, string>): Promise<unknown> {
    if (!this.client || !this.isConnected) {
      throw createInternalError("INTERNAL_ERROR", `McpClient "${this.name}" is not connected`);
    }
    return this.client.getPrompt({ arguments: args, name });
  }

  async readResource(uri: string): Promise<unknown> {
    if (!this.client || !this.isConnected) {
      throw createInternalError("INTERNAL_ERROR", `McpClient "${this.name}" is not connected`);
    }
    return this.client.readResource({ uri });
  }

  /** 销毁客户端，不可重用 */
  async dispose(): Promise<void> {
    this.disposed = true;
    await this.disconnect();
  }

  // ── 私有方法 ──────────────────────────────────────────

  private async connectWithTransportFallback(type: string): Promise<void> {
    const transportTypes = type === "http" ? ["http", "sse"] : [type];
    let lastError: Error | null = null;

    for (const currentType of transportTypes) {
      this.cleanup();
      this.transport = createTransport(this.config, currentType as "stdio" | "sse" | "http");
      this.client = new Client(
        { name: `crab-cli-mcp-${this.name}`, version: "0.5.0" },
        { capabilities: { roots: { listChanged: true } } },
      );

      try {
        await withTimeout(
          this.client.connect(this.transport),
          this.connectTimeout,
          `${this.name}: connection timed out after ${this.connectTimeout}ms`,
        );
        this.pendingAuthTransport = null;
        return;
      } catch (error) {
        const err =
          error instanceof UnauthorizedError
            ? error
            : createMcpError(
                error,
                {
                  operation: "connectWithTransportFallback",
                  serverName: this.name,
                  transportType: currentType,
                },
                "runtime",
              );
        lastError = err;
        if (
          err instanceof UnauthorizedError &&
          (this.transport instanceof StreamableHTTPClientTransport || this.transport instanceof SSEClientTransport)
        ) {
          this.pendingAuthTransport = this.transport;
          throw err;
        }
        const canFallback = currentType === "http" && shouldFallbackToSSE(err);
        if (!canFallback) {
          throw err;
        }
        log.warn(`${this.name}: StreamableHTTP unavailable, falling back to SSE — ${err.message}`);
      }
    }

    throw lastError ?? new Error(`${this.name}: failed to connect`);
  }

  /** 订阅 SDK Client 的 error/close 事件，主动感知 server 崩溃 */
  private wireClientEvents(): void {
    if (!this.client) {
      return;
    }

    // SDK Protocol 基类提供 onclose/onerror 回调
    this.client.onclose = () => {
      if (this._state === "connected") {
        log.warn(`${this.name}: server disconnected unexpectedly`);
        this.stopIdleTimer();
        this.setState("disconnected");
        this._tools = [];
        this.toolsDiscoveredAt = 0;
      }
    };

    this.client.onerror = (error: Error) => {
      log.error(`${this.name}: transport error — ${error.message}`);
      this.callbacks.onError?.(error);
    };

    this.client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
      log.info(`${this.name}: received tools/list_changed notification`);
      try {
        await this.discoverTools();
        this.callbacks.onToolsChanged?.(this.tools);
      } catch (error) {
        const err = createMcpError(
          error,
          {
            operation: "refreshToolsAfterNotification",
            serverName: this.name,
          },
          "runtime",
        );
        log.error(`${this.name}: failed to refresh tools after notification — ${err.message}`, toMcpLogPayload(err));
        this.callbacks.onError?.(err);
      }
    });

    // MCP Roots 协议 — 返回当前工作目录作为 root
    this.client.setRequestHandler(ListRootsRequestSchema, async () => {
      const rootUri = pathToFileURL(process.cwd()).href;
      log.debug(`${this.name}: responding to roots/list — ${rootUri}`);
      return {
        roots: [{ uri: rootUri, name: "cwd" }],
      };
    });
  }

  /** 启动空闲超时监控 */
  private startIdleTimer(): void {
    this.stopIdleTimer();
    this.idleTimer = setInterval(() => {
      if (this._state !== "connected") {
        this.stopIdleTimer();
        return;
      }
      const idleMs = Date.now() - this.lastActiveAt;
      if (idleMs >= McpClient.IDLE_TIMEOUT) {
        log.info(`${this.name}: idle timeout (${McpClient.IDLE_TIMEOUT}ms), disconnecting`);
        this.stopIdleTimer();
        this.cleanup();
        this.setState("disconnected");
        this._tools = [];
        this.toolsDiscoveredAt = 0;
      }
    }, MCP_IDLE_CHECK_INTERVAL_MS);
  }

  /** 停止空闲超时监控 */
  private stopIdleTimer(): void {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /** 发现并缓存工具列表 */
  private async discoverTools(): Promise<void> {
    if (!this.client) {
      return;
    }

    try {
      const response = await this.client.listTools();
      const prefix = this.config.name;

      this._tools = (response.tools ?? []).map((tool) => mcpToolToToolDefinition(prefix, tool, this));

      this.toolsDiscoveredAt = Date.now();
      log.info(`${this.name}: discovered ${this._tools.length} tools`);
    } catch (err) {
      const error = createMcpError(
        err,
        {
          operation: "discoverTools",
          serverName: this.name,
        },
        "runtime",
      );
      // 区分传输层错误和协议层错误
      // 传输层错误(连接断开)不应导致连接成功但工具为空
      const isTransportError = isConnectionError(error);
      if (isTransportError) {
        log.error(`${this.name}: tool discovery transport error — ${error.message}`, toMcpLogPayload(error));
        throw error; // 传播传输错误，让 connect() 的 catch 处理
      }
      // 协议层错误(如 listTools 不支持)允许降级为空工具列表
      log.warn(`${this.name}: tool discovery failed (non-fatal) — ${error.message}`, toMcpLogPayload(error));
      this._tools = [];
    }
  }

  /** 更新状态并触发回调 */
  private setState(state: McpConnectionState): void {
    const prev = this._state;
    this._state = state;
    if (prev !== state) {
      this.callbacks.onStateChange?.(state, prev);
    }
  }

  /** 清理连接资源 */
  private cleanup(): void {
    this.stopIdleTimer();
    this._tools = [];
    this.toolsDiscoveredAt = 0;

    // 立即 SIGKILL 子进程，防止退出时 traceback 污染终端。
    // Ctrl+C 时终端向整个前台进程组发送 SIGINT，Python MCP 进程
    // 收到后会在 async cleanup 中打印大量 traceback。直接 SIGKILL
    // 可以避免这些输出。
    try {
      const pid = this.transport instanceof StdioClientTransport ? this.transport.pid : undefined;
      if (pid && typeof pid === "number") {
        process.kill(pid, "SIGKILL");
      }
    } catch (error) {
      log.debug(`终止进程失败: ${getMcpErrorMessage(error)}`);
    }

    try {
      this.client?.close?.();
    } catch (error) {
      log.debug(`关闭客户端失败: ${getMcpErrorMessage(error)}`);
    }
    try {
      this.transport?.close?.();
    } catch (error) {
      log.debug(`关闭传输层失败: ${getMcpErrorMessage(error)}`);
    }
    this.client = null;
    this.transport = null;
  }
}

// 重新导出传输层工具函数
export { shouldFallbackToSSE } from "./transport";
