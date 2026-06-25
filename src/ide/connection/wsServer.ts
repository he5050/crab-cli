/**
 * IDE WebSocket 服务端 — 接受 VSCode 扩展的入站连接
 *
 * 职责:
 *   - 在指定端口启动 WebSocket 服务端
 *   - 管理多个 IDE 客户端连接
 *   - JSON-RPC 协议消息路由
 *   - 桥接 globalBus 事件(上下文推送、诊断、断连)
 *   - 向连接的 IDE 客户端推送指令(showDiff、goToDefinition 等)
 *
 * 模块功能:
 *   - IDEWebSocketServer: WebSocket 服务端类
 *   - IDEClient: 已连接 IDE 客户端信息接口
 *   - ideWsServer: 全局 IDE WebSocket 服务端实例
 *   - start/stop: 服务端启动和停止
 *   - configureAuth: 配置认证 token
 *   - setAllowedOrigins: 配置允许的 Origin 列表
 *   - sendNotification: 向指定客户端发送 JSON-RPC 通知
 *   - sendRequest: 向指定客户端发送请求并等待响应
 *   - broadcast: 向所有客户端广播通知
 *   - broadcastToWorkspace: 向匹配工作区的客户端广播
 *
 * 使用场景:
 *   - VSCode 扩展与 crab-cli 的通信
 *   - 上下文信息推送
 *   - 诊断信息接收
 *   - 交互指令发送
 *
 * 边界:
 * 1. 使用 Bun 原生 WebSocket，不引入 ws 库
 * 2. 认证为可选功能
 * 3. 心跳间隔 30 秒，超时阈值 120 秒
 * 4. 请求超时默认 5 秒
 *
 * 流程:
 * 1. 启动服务(start)
 * 2. 客户端连接(handleOpen)
 * 3. 认证和注册(ide/connect)
 * 4. 消息路由(handleMessage)
 * 5. 心跳检测(startHeartbeat)
 * 6. 客户端断开(handleClose)
 */

import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@/core/logging/logger";
import { globalBus, type EventBus } from "@/bus/core/eventBus";
import { IdeEvents } from "@/bus/events/ideEvents";
import type { ConnectionStatus } from "@/ide/types";
import { createId } from "@/core/identity";
import { secureId } from "@/core/id";
import { type IdeErrorReason, createIdeError, getIdeErrorMessage, toIdeLogPayload } from "@/ide/errors";
import { WS_TOKEN_FILE } from "@/ide/shared/pathUtils";
import { diagnosticsFromParams, editorContextFromParams, validateSimpleMessageBounds } from "./wsMessageAdapters";

const log = createLogger("ide:ws-server");

/** 默认允许的 Origin(VSCode / Cursor 扩展) */
const DEFAULT_ALLOWED_ORIGINS = ["vscode-file://", "vscode-webview://", "cursor://"];

// ─── 类型定义 ─────────────────────────────────────────────────

/** WebSocket 适配接口(兼容 Bun ServerWebSocket 和浏览器 WebSocket) */
interface WSLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readyState: number;
}

/** 连接的 IDE 客户端信息 */
export interface IDEClient {
  /** 连接 ID */
  id: string;
  /** WebSocket 实例 */
  ws: WSLike;
  /** 工作区路径 */
  workspaceFolder?: string;
  /** 连接时间 */
  connectedAt: number;
  /** 最后活跃时间 */
  lastActiveAt: number;
  /** 上次消息时间(速率限制) */
  lastMessageAt?: number;
  /** 连续超速计数 */
  rateLimitCount?: number;
}

/** JSON-RPC 请求消息 */
interface WsRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC 响应消息 */
interface WsResponse {
  jsonrpc: "2.0";
  id?: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** JSON-RPC 通知消息(无需响应) */
interface WsNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

/** sendRequest 返回结果(区分失败原因) */
export interface SendRequestResult<T> {
  data: T | null;
  reason: "ok" | "timeout" | "disconnected" | "error";
}

/** 事件监听器类型 */
type EventListener<T = unknown> = (data: T) => void;

// ─── WebSocket 服务端 ─────────────────────────────────────────

export class IDEWebSocketServer {
  private server: ReturnType<typeof Bun.serve> | null = null;
  private clients = new Map<string, IDEClient>();
  private listeners = new Map<string, Set<EventListener>>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pendingRequests = new Map<string, { resolve: (value: any) => void; timer: ReturnType<typeof setTimeout> }>();
  private _status: ConnectionStatus = "disconnected";
  private _port = 0;
  private _authToken?: string;
  private _allowedOrigins: string[] = [...DEFAULT_ALLOWED_ORIGINS];
  private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private _heartbeatIntervalMs = 30_000;
  private _staleThresholdMs = 120_000;
  private readonly eventBus?: EventBus;

  constructor(eventBus?: EventBus) {
    this.eventBus = eventBus;
  }

  private getEventBus(): EventBus {
    return this.eventBus ?? globalBus;
  }

  private logIdeFailure(
    message: string,
    error: unknown,
    context: { operation: string; clientId?: string; requestType?: string },
    reason: IdeErrorReason = "handler",
  ): void {
    const appError = createIdeError(error, context, reason);
    log.debug(message, toIdeLogPayload(appError));
  }

  private closeSocketSafely(
    ws: WSLike,
    code: number | undefined,
    reasonText: string | undefined,
    context: { operation: string; clientId?: string },
  ): void {
    try {
      ws.close(code, reasonText);
    } catch (error) {
      this.logIdeFailure("关闭 IDE WebSocket 失败", error, context);
    }
  }

  // ─── 生命周期 ─────────────────────────────────────────────

  /** 启动 WebSocket 服务端 */
  start(port: number): void {
    if (this.server) {
      log.warn(`WebSocket 服务端已在端口 ${this._port} 运行`);
      return;
    }

    this._port = port;
    this._status = "connected";

    // 默认生成认证 token，防止开放网络下未授权连接
    if (!this._authToken) {
      const token = secureId();
      this.configureAuth(token);
      log.info(`IDE WebSocket 已启用自动生成的 token 认证`);
    }

    // 将 token 写入文件供 VSCode 扩展读取
    this.writeTokenFile(port, this._authToken);

    this.server = Bun.serve({
      fetch() {
        // 非 WebSocket 请求返回 200
        return new Response("IDE WebSocket Server", { status: 200 });
      },
      port,
      websocket: {
        close: (ws) => this.handleClose(ws as WSLike),
        drain: (ws) => this.handleDrain(ws as WSLike),
        message: (ws, message) => this.handleMessage(ws as WSLike, message),
        open: (ws) => this.handleOpen(ws as WSLike),
      },
    });

    log.info(`IDE WebSocket 服务端已启动，端口 ${port}`);
    this.getEventBus().publish(IdeEvents.IDEConnected, { port });
    this.startHeartbeat();
  }

  /** 停止 WebSocket 服务端 */
  stop(): void {
    if (!this.server) {
      return;
    }

    // 关闭所有客户端连接
    for (const client of this.clients.values()) {
      this.closeSocketSafely(client.ws, 1001, "Server shutting down", {
        clientId: client.id,
        operation: "stop.closeClient",
      });
    }
    this.clients.clear();

    this.server.stop();
    this.server = null;
    this._status = "disconnected";
    this._port = 0;
    this.removeTokenFile();

    log.info("IDE WebSocket 服务端已停止");
    this.getEventBus().publish(IdeEvents.IDEDisconnected, { reason: "server-stopped" });
    this.stopHeartbeat();
  }

  /** 将 token 写入文件供 IDE 扩展读取 */
  private writeTokenFile(port: number, token?: string): void {
    try {
      const dir = path.dirname(WS_TOKEN_FILE);
      fs.mkdirSync(dir, { mode: 0o700, recursive: true });
      const content = JSON.stringify({ port, token, version: 2 });
      fs.writeFileSync(WS_TOKEN_FILE, content, "utf8");
      fs.chmodSync(WS_TOKEN_FILE, 0o600);
      log.debug(`token 文件已写入: ${WS_TOKEN_FILE}`);
    } catch (err) {
      const error = createIdeError(
        err,
        {
          operation: "writeTokenFile",
        },
        "handler",
      );
      log.warn("写入 token 文件失败", toIdeLogPayload(error));
    }
  }

  /** 删除 token 文件(停止时清理) */
  private removeTokenFile(): void {
    try {
      if (fs.existsSync(WS_TOKEN_FILE)) {
        fs.unlinkSync(WS_TOKEN_FILE);
      }
    } catch (error) {
      this.logIdeFailure("删除 token 文件失败", error, {
        operation: "removeTokenFile",
      });
    }
  }

  /** 配置认证 token(设置后客户端必须在 ide/connect 时提供) */
  configureAuth(token: string): void {
    this._authToken = token;
    log.info("IDE WebSocket 已启用 token 认证");
  }

  /** 配置允许的 Origin 列表(空列表表示不校验) */
  setAllowedOrigins(origins: string[]): void {
    this._allowedOrigins = origins;
  }

  /** 启动心跳检测 */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this._heartbeatTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, client] of this.clients) {
        if (now - client.lastActiveAt > this._staleThresholdMs) {
          log.info(`心跳超时，断开客户端: ${id}`);
          this.closeSocketSafely(client.ws, 4000, "Heartbeat timeout", {
            clientId: id,
            operation: "heartbeat.closeStaleClient",
          });
          this.clients.delete(id);
        } else {
          client.rateLimitCount = 0;
          try {
            client.ws.send(JSON.stringify({ jsonrpc: "2.0", method: "ping" }));
          } catch (error) {
            this.logIdeFailure("发送 IDE 心跳失败，移除客户端", error, {
              clientId: id,
              operation: "heartbeat.sendPing",
            });
            this.clients.delete(id);
          }
        }
      }
    }, this._heartbeatIntervalMs);
  }

  /** 停止心跳检测 */
  private stopHeartbeat(): void {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  // ─── 状态查询 ─────────────────────────────────────────────

  get status(): ConnectionStatus {
    return this._status;
  }
  get port(): number {
    return this._port;
  }
  get clientCount(): number {
    return this.clients.size;
  }
  get authToken(): string | undefined {
    return this._authToken;
  }

  /** 获取所有已连接客户端的只读快照 */
  getClients(): readonly Readonly<IDEClient>[] {
    return [...this.clients.values()];
  }

  /** 按工作区查找客户端 */
  getClientByWorkspace(workspace: string): IDEClient | undefined {
    for (const client of this.clients.values()) {
      if (client.workspaceFolder === workspace) {
        return client;
      }
    }
    return;
  }

  // ─── 事件系统 ─────────────────────────────────────────────

  /** 注册事件监听器 */
  on<T = unknown>(event: string, listener: EventListener<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener as EventListener);
    return () => {
      this.listeners.get(event)?.delete(listener as EventListener);
    };
  }

  private emit(event: string, data: unknown): void {
    this.listeners.get(event)?.forEach((listener) => {
      try {
        listener(data);
      } catch (error) {
        this.logIdeFailure(
          `事件监听器异常: ${event}`,
          error,
          {
            operation: "emit",
            requestType: event,
          },
          "callback",
        );
      }
    });
  }

  // ─── 客户端通信 ───────────────────────────────────────────

  /** 向指定客户端发送 JSON-RPC 通知 */
  sendNotification(clientId: string, method: string, params?: Record<string, unknown>): boolean {
    const client = this.clients.get(clientId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    const msg: WsNotification = { jsonrpc: "2.0", method, params };
    try {
      client.ws.send(JSON.stringify(msg));
      client.lastActiveAt = Date.now();
      return true;
    } catch (error) {
      this.logIdeFailure("发送 IDE 通知失败", error, {
        clientId,
        operation: "sendNotification",
        requestType: method,
      });
      return false;
    }
  }

  /** 向指定客户端发送请求并等待响应 */
  async sendRequest<T = unknown>(
    clientId: string,
    method: string,
    params?: Record<string, unknown>,
    timeoutMs = 5000,
  ): Promise<SendRequestResult<T>> {
    const client = this.clients.get(clientId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) {
      return { data: null, reason: "disconnected" };
    }

    const requestId = createId("req");
    return new Promise<SendRequestResult<T>>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        resolve({ data: null, reason: "timeout" });
      }, timeoutMs);

      this.pendingRequests.set(requestId, { resolve, timer });

      const msg: WsRequest = { id: requestId, jsonrpc: "2.0", method, params };
      try {
        client.ws.send(JSON.stringify(msg));
        client.lastActiveAt = Date.now();
      } catch (error) {
        clearTimeout(timer);
        this.pendingRequests.delete(requestId);
        this.logIdeFailure("发送 IDE 请求失败", error, {
          clientId,
          operation: "sendRequest",
          requestType: method,
        });
        resolve({ data: null, reason: "error" });
      }
    });
  }

  /** 向所有客户端广播通知 */
  broadcast(method: string, params?: Record<string, unknown>): void {
    for (const client of this.clients.values()) {
      this.sendNotification(client.id, method, params);
    }
  }

  /** 向匹配工作区的客户端广播 */
  broadcastToWorkspace(workspace: string, method: string, params?: Record<string, unknown>): void {
    for (const client of this.clients.values()) {
      if (client.workspaceFolder === workspace || !client.workspaceFolder) {
        this.sendNotification(client.id, method, params);
      }
    }
  }

  // ─── 内部处理 ─────────────────────────────────────────────

  private handleOpen(ws: WSLike): void {
    // 连接数上限
    if (this.clients.size >= 10) {
      log.warn(`连接数已达上限 (${this.clients.size})，拒绝新连接`);
      this.closeSocketSafely(ws, undefined, undefined, {
        operation: "handleOpen.rejectConnectionLimit",
      });
      return;
    }

    const clientId = createId("con");
    const client: IDEClient = {
      connectedAt: Date.now(),
      id: clientId,
      lastActiveAt: Date.now(),
      ws,
    };
    this.clients.set(clientId, client);

    log.info(`IDE 客户端已连接: ${clientId} (共 ${this.clients.size} 个)`);
    this.emit("client-connected", client);
  }

  private handleMessage(ws: WSLike, message: string | Buffer): void {
    const client = this.findClientByWs(ws);
    if (!client) {
      return;
    }

    // 消息大小限制:1MB
    const raw = typeof message === "string" ? message : message.toString();
    if (raw.length > 1024 * 1024) {
      log.warn(`消息超限 (${raw.length} > 1MB)，断开客户端 ${client.id}`);
      this.closeSocketSafely(ws, undefined, undefined, {
        clientId: client.id,
        operation: "handleMessage.rejectOversizedMessage",
      });
      return;
    }

    // 速率限制:间隔 < 100ms 丢弃，连续超限 50 次断开
    const now = Date.now();
    if (client.lastMessageAt && now - client.lastMessageAt < 100) {
      client.rateLimitCount = (client.rateLimitCount ?? 0) + 1;
      if (client.rateLimitCount >= 50) {
        log.warn(`客户端 ${client.id} 速率超限，断开连接`);
        this.closeSocketSafely(ws, undefined, undefined, {
          clientId: client.id,
          operation: "handleMessage.rejectRateLimit",
        });
        return;
      }
      return;
    }
    client.lastMessageAt = now;
    client.rateLimitCount = 0;

    client.lastActiveAt = Date.now();

    try {
      const data = JSON.parse(typeof message === "string" ? message : message.toString());

      // JSON-RPC 响应(匹配 pending request)
      if (data.jsonrpc === "2.0" && data.id && !data.method) {
        const pending = this.pendingRequests.get(String(data.id));
        if (pending) {
          this.pendingRequests.delete(String(data.id));
          clearTimeout(pending.timer);
          pending.resolve(data.result ?? data.error ?? null);
          return;
        }
      }

      // JSON-RPC 请求(有 method)
      if (data.jsonrpc === "2.0" && data.method) {
        if (data.method === "pong") {
          client.lastActiveAt = Date.now();
          return;
        }
        this.handleRpcRequest(client, data);
        return;
      }

      // 简单消息格式(兼容现有 VSCode 扩展协议)
      if (data.type) {
        this.handleSimpleMessage(client, data);
        return;
      }

      log.debug(`未知消息格式: ${typeof data}`);
    } catch (error) {
      log.debug("无效 JSON 消息", {
        clientId: client.id,
        error: getIdeErrorMessage(error),
      });
    }
  }

  private handleClose(ws: WSLike): void {
    const client = this.findClientByWs(ws);
    if (!client) {
      return;
    }

    this.clients.delete(client.id);
    log.info(`IDE 客户端已断开: ${client.id} (剩余 ${this.clients.size} 个)`);

    this.getEventBus().publish(IdeEvents.IDEDisconnected, {
      reason: "client-disconnected",
    });
    this.emit("client-disconnected", client);
  }

  private handleDrain(ws: WSLike): void {
    // 背压释放，可用于统计
    const client = this.findClientByWs(ws);
    if (client) {
      client.lastActiveAt = Date.now();
    }
  }

  private findClientByWs(ws: WSLike): IDEClient | undefined {
    for (const client of this.clients.values()) {
      if (client.ws === ws) {
        return client;
      }
    }
    return;
  }

  /** 处理 JSON-RPC 请求 */
  private handleRpcRequest(client: IDEClient, data: WsRequest): void {
    const { method, params = {}, id } = data;

    // 连接注册
    if (method === "ide/connect") {
      // Token 认证
      if (this._authToken) {
        const token = params.token as string | undefined;
        if (token !== this._authToken) {
          if (id !== undefined) {
            this.sendRpcError(client, id, -32001, "Authentication failed: invalid token");
          }
          this.closeSocketSafely(client.ws, 4001, "Auth failed", {
            clientId: client.id,
            operation: "handleRpcRequest.authFailed",
          });
          this.clients.delete(client.id);
          return;
        }
      }
      // Origin 校验
      const origin = params.origin as string | undefined;
      if (this._allowedOrigins.length > 0 && origin && !this._allowedOrigins.includes(origin)) {
        if (id !== undefined) {
          this.sendRpcError(client, id, -32002, `Origin not allowed: ${origin}`);
        }
        this.closeSocketSafely(client.ws, 4003, "Origin not allowed", {
          clientId: client.id,
          operation: "handleRpcRequest.originDenied",
        });
        this.clients.delete(client.id);
        return;
      }

      client.workspaceFolder = params.workspaceFolder as string | undefined;
      log.info(`IDE 已注册工作区: ${client.workspaceFolder ?? "unknown"} (${client.id})`);
      this.emit("ide-registered", client);

      // 如果是请求，返回成功
      if (id !== undefined) {
        this.sendRpcResponse(client, id, { clientId: client.id, status: "connected" });
      }
      return;
    }

    // 上下文推送
    if (method === "context") {
      const context = editorContextFromParams(params);
      this.getEventBus().publish(IdeEvents.EditorContextChanged, context);
      this.emit("context-update", { clientId: client.id, context });

      if (id !== undefined) {
        this.sendRpcResponse(client, id, { received: true });
      }
      return;
    }

    // 诊断推送
    if (method === "diagnostics") {
      const rawDiag = params.diagnostics as Record<string, unknown>[] | undefined;
      const diagnostics = diagnosticsFromParams(rawDiag);
      if (diagnostics) {
        this.getEventBus().publish(IdeEvents.IDEDiagnostics, {
          diagnostics,
          filePath: params.filePath as string,
        });
      }
      this.emit("diagnostics-update", {
        clientId: client.id,
        diagnostics: rawDiag,
        filePath: params.filePath as string,
      });

      if (id !== undefined) {
        this.sendRpcResponse(client, id, { received: true });
      }
      return;
    }

    // 交互结果
    if (method === "interaction/result") {
      this.emit("interaction-result", { clientId: client.id, ...params });
      if (id !== undefined) {
        this.sendRpcResponse(client, id, { received: true });
      }
      return;
    }

    // ACE 相关结果
    if (method.startsWith("ace")) {
      this.emit(method, { clientId: client.id, requestId: id, ...params });
      if (id !== undefined) {
        this.sendRpcResponse(client, id, { received: true });
      }
      return;
    }

    // 交互请求(代理到 interactionManager)
    const interactionTypes = [
      "showDiff",
      "closeDiff",
      "showGitDiff",
      "aceGoToDefinition",
      "aceFindReferences",
      "aceGetSymbols",
    ];
    if (interactionTypes.includes(method)) {
      this.emit("interaction-request", { clientId: client.id, params, requestId: id, type: method });
      return;
    }

    log.debug(`未知 RPC 方法: ${method}`);
    if (id !== undefined) {
      this.sendRpcError(client, id, -32_601, `Method not found: ${method}`);
    }
  }

  /** 处理简单消息格式(兼容现有 VSCode 扩展) */
  private handleSimpleMessage(client: IDEClient, data: Record<string, unknown>): void {
    const type = data.type as string;

    // 对 context / diagnostics 简单消息检查 token(warn-then-discard)
    if ((type === "context" || type === "diagnostics") && this._authToken) {
      const token = data.token as string | undefined;
      if (token !== this._authToken) {
        log.warn(`简单消息缺少有效 token，已丢弃 (type=${type})`);
        return;
      }
    }

    const boundsError = validateSimpleMessageBounds(data);
    if (boundsError) {
      log.warn(boundsError);
      return;
    }

    if (type === "context") {
      const context = editorContextFromParams(data);
      this.getEventBus().publish(IdeEvents.EditorContextChanged, context);
      this.emit("context-update", { clientId: client.id, context });
      return;
    }

    if (type === "diagnostics") {
      const rawDiag = data.diagnostics as Record<string, unknown>[] | undefined;
      const diagnostics = diagnosticsFromParams(rawDiag);
      if (diagnostics) {
        this.getEventBus().publish(IdeEvents.IDEDiagnostics, {
          diagnostics,
          filePath: data.filePath as string,
        });
      }
      this.emit("diagnostics-update", {
        clientId: client.id,
        diagnostics: rawDiag,
        filePath: data.filePath as string,
      });
      return;
    }

    log.debug(`未知简单消息类型: ${type}`);
  }

  private sendRpcResponse(client: IDEClient, id: string | number, result: unknown): void {
    if (client.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    const resp: WsResponse = { id, jsonrpc: "2.0", result };
    client.ws.send(JSON.stringify(resp));
  }

  private sendRpcError(client: IDEClient, id: string | number, code: number, message: string): void {
    if (client.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    const resp: WsResponse = { error: { code, message }, id, jsonrpc: "2.0" };
    client.ws.send(JSON.stringify(resp));
  }
}

/** 全局 IDE WebSocket 服务端实例 */
export const ideWsServer = new IDEWebSocketServer();
