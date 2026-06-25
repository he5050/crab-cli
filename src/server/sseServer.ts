/**
 * SSE Server 模块
 *
 * 职责:
 *   - 提供 HTTP Server-Sent Events 服务端点
 *   - 管理 SSE 客户端连接和断开
 *   - 广播 AI 响应流到所有连接的客户端
 *   - 处理消息接收和异步处理
 *
 * 模块功能:
 *   - startSseServer(): 启动 SSE 服务器
 *   - SseServerOptions: 服务器配置选项
 *   - SSE 流式连接端点 (/sse)
 *   - 消息接收端点 (/api/message)
 *   - 客户端列表端点 (/api/clients)
 *   - 健康检查端点 (/api/health)
 *   - 客户端管理和广播机制
 *
 * 使用场景:
 *   - 外部客户端需要实时接收 AI 流式响应
 *   - Web 界面与 crab-cli 后端通信
 *   - 多客户端同时监听对话输出
 *   - 需要 HTTP 协议而非 ACP 协议的场景
 *
 * 边界:
 *   1. 使用 Bun.serve 实现，不依赖 express
 *   2. 不持久化会话状态，仅内存存储
 *   3. 客户端断开后需重新连接
 *   4. 消息处理是异步的，不等待完成即返回
 *   5. 需要预先启动 MCP Runtime
 *
 * 流程:
 *   1. 启动服务器并监听指定端口
 *   2. 客户端连接 /sse 端点建立流式通道
 *   3. 客户端发送消息到 /api/message
 *   4. 创建 ConversationHandler 处理消息
 *   5. 通过全局事件总线订阅对话事件
 *   6. 广播 token、toolCall、toolResult 事件到所有客户端
 *   7. 对话完成后广播 done 事件
 */
import { createLogger } from "@/core/logging/logger";
import { loadConfig } from "@/config";
import { ConversationHandler } from "@/conversation";
import { createId } from "@/core/identity";
import { prefixedId } from "@/core/id";
import { VERSION } from "@/config/version";
import { ensureMcpRuntimeStarted } from "@/mcp/manager/runtime";
import { initTaskRuntime } from "@/mission";
import { type RuntimeEventInput, createRuntimeEvent, toLegacySseEvent } from "@/bus";
import { SessionRecorder, deleteRecording, listRecordings, loadRecording } from "@/session";
import { getSessionMessages, messageRecordsToModelMessages } from "@/session";

import { globalBus } from "@/bus";
import { AppEvent } from "@/bus";
import { collaborationManager } from "@/server/collaboration";
import { SignalRCollaborationCompat } from "@/server/signalrCompat";
import {
  authResponse,
  getSignalRSessionScope,
  isAuthorized as isAuthorizedRequest,
  isSignalRAuthorized as isSignalRAuthorizedRequest,
  isSseOriginAllowed,
  requireAuthForHost,
  sseCorsHeadersFor,
} from "@/server/sseSecurity";
import { createServerError, getServerErrorMessage, toServerLogPayload } from "@/server/errors";
import { escapeHtml } from "@/tool/shared/html";
const log = createLogger("sse-server");
export const SSE_MESSAGE_BODY_LIMIT_BYTES = 1024 * 1024;

export {
  SSE_ALLOWED_ORIGINS,
  isAuthorized,
  isSignalRAuthorized,
  isSseOriginAllowed,
  safeTokenEquals,
  sseCorsHeadersFor,
} from "@/server/sseSecurity";

interface SseConversationHandler {
  sendMessage(message: string): Promise<unknown>;
  destroy(): void;
}
type SseConversationHandlerCtor = new (
  config: Awaited<ReturnType<typeof loadConfig>>,
  options: ConstructorParameters<typeof ConversationHandler>[1],
) => SseConversationHandler;

const sseServerDeps = {
  ConversationHandler: ConversationHandler as SseConversationHandlerCtor,
  ensureMcpRuntimeStarted,
  getSessionMessages,
  initTaskRuntime,
  loadConfig,
  messageRecordsToModelMessages,
};

class SseRequestBodyTooLargeError extends Error {
  constructor() {
    super("SSE request body too large");
  }
}

class SseInvalidContentLengthError extends Error {
  constructor() {
    super("Invalid Content-Length");
  }
}

function validateDeclaredContentLength(req: Request): void {
  const contentLength = req.headers.get("content-length");
  if (contentLength === null) {
    return;
  }

  const trimmed = contentLength.trim();
  const declaredLength = Number(trimmed);
  if (trimmed.length === 0 || !Number.isSafeInteger(declaredLength) || declaredLength < 0) {
    throw new SseInvalidContentLengthError();
  }
  if (declaredLength > SSE_MESSAGE_BODY_LIMIT_BYTES) {
    throw new SseRequestBodyTooLargeError();
  }
}

async function readRequestTextWithLimit(req: Request): Promise<string> {
  validateDeclaredContentLength(req);
  if (!req.body) {
    return "";
  }

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }
    totalBytes += value.byteLength;
    if (totalBytes > SSE_MESSAGE_BODY_LIMIT_BYTES) {
      await reader.cancel();
      throw new SseRequestBodyTooLargeError();
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks, totalBytes).toString("utf8");
}

async function readJsonBodyWithLimit<T>(req: Request): Promise<T> {
  return JSON.parse(await readRequestTextWithLimit(req)) as T;
}

export function __setSseServerDepsForTesting(overrides: Partial<typeof sseServerDeps>): void {
  Object.assign(sseServerDeps, overrides);
}

export function __resetSseServerDepsForTesting(): void {
  sseServerDeps.loadConfig = loadConfig;
  sseServerDeps.ConversationHandler = ConversationHandler as SseConversationHandlerCtor;
  sseServerDeps.ensureMcpRuntimeStarted = ensureMcpRuntimeStarted;
  sseServerDeps.initTaskRuntime = initTaskRuntime;
  sseServerDeps.getSessionMessages = getSessionMessages;
  sseServerDeps.messageRecordsToModelMessages = messageRecordsToModelMessages;
  clients.clear();
  for (const handler of sessionHandlers.values()) {
    handler.destroy();
  }
  sessionHandlers.clear();
  sessionHandlerLastUsed.clear();
}

export interface SseServerOptions {
  port?: number;
  host?: string;
  daemon?: boolean;
  /** Test/dev escape hatch. Production defaults to requiring auth for state-changing routes. */
  allowLocalWithoutToken?: boolean;
}

interface SseClient {
  id: string;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  encoder: TextEncoder;
}

/** 最大 SSE 并发客户端数 */
const MAX_SSE_CLIENTS = 50;
const MAX_SESSION_HANDLERS = 50;
let allowLocalWithoutTokenForCurrentServer = false;

/** 活跃的 SSE 客户端 */
const clients = new Map<string, SseClient>();

/** 缓存的会话 Handler，按 sessionId 复用 */
const sessionHandlers = new Map<string, SseConversationHandler>();
/** 会话 Handler 最后活跃时间（用于 LRU 淘汰） */
const sessionHandlerLastUsed = new Map<string, number>();

/** 会话录制器实例(惰性初始化) */
let recorder: SessionRecorder | null = null;
const signalrCompat = new SignalRCollaborationCompat(collaborationManager);

function touchSessionHandler(sessionId: string, handler: SseConversationHandler): void {
  sessionHandlerLastUsed.set(sessionId, Date.now());
  if (!sessionHandlers.has(sessionId)) {
    sessionHandlers.set(sessionId, handler);
  }
}

function evictOldestSessionHandlerIfNeeded(): void {
  if (sessionHandlers.size < MAX_SESSION_HANDLERS) {
    return;
  }

  // LRU: 淘汰最久未使用的会话 Handler
  let oldestSessionId: string | null = null;
  let oldestTimestamp = Infinity;

  for (const [id, ts] of sessionHandlerLastUsed.entries()) {
    if (ts < oldestTimestamp) {
      oldestTimestamp = ts;
      oldestSessionId = id;
    }
  }

  if (!oldestSessionId) {
    return;
  }

  const oldestHandler = sessionHandlers.get(oldestSessionId);
  sessionHandlers.delete(oldestSessionId);
  sessionHandlerLastUsed.delete(oldestSessionId);
  if (oldestHandler) {
    oldestHandler.destroy();
  }
  log.info(`淘汰 LRU 会话 Handler: ${oldestSessionId} (缓存上限: ${MAX_SESSION_HANDLERS})`);
}

function getOrCreateSessionHandler(
  sessionId: string,
  createHandler: () => SseConversationHandler,
): SseConversationHandler {
  const cached = sessionHandlers.get(sessionId);
  if (cached) {
    touchSessionHandler(sessionId, cached);
    log.info(`复用会话 Handler: ${sessionId}`);
    return cached;
  }

  evictOldestSessionHandlerIfNeeded();
  const handler = createHandler();
  touchSessionHandler(sessionId, handler);
  log.info(`创建会话 Handler: ${sessionId} (当前缓存: ${sessionHandlers.size})`);
  return handler;
}

function isAuthorized(req: Request): boolean {
  return isAuthorizedRequest(req, allowLocalWithoutTokenForCurrentServer);
}

function isSignalRAuthorized(req: Request): boolean {
  return isSignalRAuthorizedRequest(req, allowLocalWithoutTokenForCurrentServer);
}

/** 对 SSE 广播数据中的字符串值执行 HTML 转义(深度处理) */
function sanitizeSseData(data: unknown): unknown {
  if (typeof data === "string") {
    return escapeHtml(data);
  }
  if (Array.isArray(data)) {
    return data.map(sanitizeSseData);
  }
  if (data !== null && typeof data === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(data)) {
      // 跳过纯技术字段(clientId, status, sessionId 等)
      if (key === "clientId" || key === "status" || key === "sessionId" || key === "ts" || key === "version") {
        sanitized[key] = val;
      } else {
        sanitized[key] = sanitizeSseData(val);
      }
    }
    return sanitized;
  }
  return data;
}

/** 发送 SSE 事件到客户端 */
function sendSseEvent(client: SseClient, event: string, data: unknown): boolean {
  try {
    const sanitized = sanitizeSseData(data);
    const json = JSON.stringify(sanitized);
    const chunk = client.encoder.encode(`event: ${event}\ndata: ${json}\n\n`);
    client.writer.write(chunk).catch((error) => {
      log.debug("SSE client write failed, removing client", {
        clientId: client.id,
        error: getServerErrorMessage(error),
      });
      clients.delete(client.id);
    });
    return true;
  } catch (error) {
    const appError = createServerError(
      error,
      {
        clientId: client.id,
        event,
        operation: "sendSseEvent",
      },
      "sse",
    );
    log.warn(`SSE event send failed: ${appError.message}`, toServerLogPayload(appError));
    clients.delete(client.id);
    return false;
  }
}

/** 广播到所有客户端(带背压:单次广播失败上限，移除死连接) */
function broadcast(event: string, data: unknown): void {
  const deadClients: string[] = [];
  for (const client of clients.values()) {
    if (!sendSseEvent(client, event, data)) {
      deadClients.push(client.id);
    }
  }
  for (const id of deadClients) {
    clients.delete(id);
    log.info(`移除失效 SSE 客户端: ${id}`);
  }
}

function broadcastRuntimeEvent(input: RuntimeEventInput): void {
  const mapped = toLegacySseEvent(createRuntimeEvent(input));
  broadcast(mapped.event, mapped.data);
}

/** 定期心跳检测死连接 */
function startHeartbeat(): void {
  const interval = setInterval(() => {
    if (clients.size === 0) {
      clearInterval(interval);
      return;
    }
    broadcast("heartbeat", { ts: Date.now() });
  }, 30_000);
  // 进程退出时清理
  process.on("beforeExit", () => clearInterval(interval));
}

/**
 * 启动 SSE 服务器。
 */
export async function startSseServer(options: SseServerOptions = {}): Promise<void> {
  const port = options.port ?? 3000;
  const host = options.host ?? "127.0.0.1";
  allowLocalWithoutTokenForCurrentServer = options.allowLocalWithoutToken ?? false;
  requireAuthForHost(host, allowLocalWithoutTokenForCurrentServer);

  sseServerDeps.initTaskRuntime(process.cwd());
  await sseServerDeps.ensureMcpRuntimeStarted();

  Bun.serve({
    port,
    hostname: host,
    idleTimeout: 0,
    websocket: {
      close(ws) {
        if (signalrCompat.hasWs(ws)) {
          signalrCompat.handleClose(ws);
          return;
        }
        collaborationManager.handleClose(ws);
      },
      message(ws, message) {
        if (signalrCompat.hasWs(ws)) {
          signalrCompat.handleMessage(ws, message);
          return;
        }
        collaborationManager.handleMessage(ws, message);
      },
      open(ws) {
        const data = ws.data as { protocol?: string; connectionToken?: string } | undefined;
        if (data?.protocol === "signalr") {
          signalrCompat.handleOpen(ws, data.connectionToken ?? null);
          return;
        }
        collaborationManager.handleOpen(ws);
      },
    },
    routes: {
      // SSE 流式端点
      "/sse": (req) => {
        // Origin 验证:SSE 连接必须来自允许的 origin
        const sseOrigin = req.headers.get("origin");
        if (sseOrigin && !isSseOriginAllowed(sseOrigin)) {
          return new Response(JSON.stringify({ error: "Forbidden: invalid origin" }), {
            headers: { "Content-Type": "application/json" },
            status: 403,
          });
        }
        if (!isAuthorized(req)) {
          return authResponse();
        }
        if (clients.size >= MAX_SSE_CLIENTS) {
          return new Response("SSE 客户端已达上限", { status: 503 });
        }
        const clientId = prefixedId("client");
        log.info(`SSE 客户端连接: ${clientId} (${clients.size + 1}/${MAX_SSE_CLIENTS})`);

        const stream = new ReadableStream({
          cancel() {
            clients.delete(clientId);
            log.info(`SSE 客户端断开: ${clientId}`);
          },
          start(controller) {
            const encoder = new TextEncoder();
            const writer = {
              abort() {
                controller.close();
                return Promise.resolve();
              },
              close() {
                controller.close();
                return Promise.resolve();
              },
              write(chunk: Uint8Array) {
                controller.enqueue(chunk);
                return Promise.resolve();
              },
            } as WritableStreamDefaultWriter<Uint8Array>;

            const client: SseClient = { encoder, id: clientId, writer };
            clients.set(clientId, client);

            // 发送连接事件
            const connectMsg = encoder.encode(
              `event: connected\ndata: ${JSON.stringify({ clientId, version: VERSION })}\n\n`,
            );
            controller.enqueue(connectMsg);
          },
        });

        return new Response(stream, {
          headers: {
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "Content-Type": "text/event-stream",
          },
        });
      },

      // 发送消息
      "/api/message": {
        POST: async (req) => {
          try {
            // Origin 验证
            const msgOrigin = req.headers.get("origin");
            if (msgOrigin && !isSseOriginAllowed(msgOrigin)) {
              return new Response(JSON.stringify({ error: "Forbidden: invalid origin" }), {
                headers: { "Content-Type": "application/json" },
                status: 403,
              });
            }
            if (!isAuthorized(req)) {
              return authResponse();
            }
            const body = await readJsonBodyWithLimit<{ message?: string; sessionId?: string; yolo?: boolean }>(req);
            const { message } = body;
            if (!message) {
              return Response.json({ error: "无效输入" }, { status: 400 });
            }
            const sessionId = body.sessionId ?? createId("ses");

            log.info(`收到消息: "${message.slice(0, 50)}" (session: ${sessionId})`);

            // 异步处理消息(支持 sessionId 复用已有会话)
            handleMessage(message, sessionId).catch((error) => {
              const serverError = createServerError(
                error,
                {
                  operation: "handleMessageAsync",
                  route: "/api/message",
                  sessionId,
                },
                "sse",
              );
              log.error(`处理消息失败: ${serverError.message}`, toServerLogPayload(serverError));
            });

            return Response.json({ message: "收到消息", sessionId, status: "ok" });
          } catch (error) {
            if (error instanceof SseRequestBodyTooLargeError) {
              return Response.json(
                {
                  error: "请求体过大",
                  maxBytes: SSE_MESSAGE_BODY_LIMIT_BYTES,
                },
                { status: 413 },
              );
            }
            const serverError = createServerError(
              error,
              {
                operation: "parseMessageRequest",
                route: "/api/message",
              },
              "bad_request",
            );
            log.debug("解析 /api/message 请求失败", toServerLogPayload(serverError));
            return Response.json({ error: "无效输入", errorCode: serverError.code }, { status: 400 });
          }
        },
      },

      // 活跃客户端列表
      "/api/clients": {
        GET: () => {
          const clientList = [...clients.values()].map((c) => ({
            clientId: c.id,
            connected: true,
          }));
          return Response.json({ clients: clientList, total: clientList.length });
        },
      },

      // 兼容入口:持久化 session API 的真实实现由 apiRoutes 统一处理
      "/api/sessions": {
        GET: async (req) => {
          const { handleApiRequest } = await import("@/server/apiRoutes");
          const response = await handleApiRequest(req ?? new Request("http://localhost/api/sessions"));
          return response ?? Response.json({ error: "Not Found" }, { status: 404 });
        },
        POST: async (req) => {
          const { handleApiRequest } = await import("@/server/apiRoutes");
          const response = await handleApiRequest(req);
          return response ?? Response.json({ error: "Not Found" }, { status: 404 });
        },
      },

      // 录制管理
      "/api/recording": {
        DELETE: async (req) => {
          if (!isAuthorized(req)) {
            return authResponse();
          }
          try {
            const body = await readJsonBodyWithLimit<{ id?: string }>(req);
            if (!body.id) {
              return Response.json({ error: "缺少 id" }, { status: 400 });
            }
            const ok = deleteRecording(body.id);
            return Response.json({ status: ok ? "ok" : "error" });
          } catch (error) {
            if (error instanceof SseRequestBodyTooLargeError) {
              return Response.json({ error: "请求体过大" }, { status: 413 });
            }
            const serverError = createServerError(
              error,
              {
                operation: "recordingDelete",
                route: "/api/recording",
              },
              "bad_request",
            );
            log.debug("解析 DELETE /api/recording 请求失败", toServerLogPayload(serverError));
            return Response.json({ error: "无效输入", errorCode: serverError.code }, { status: 400 });
          }
        },
        GET: () => {
          const list = listRecordings();
          return Response.json({ recordings: list });
        },
        POST: async (req) => {
          if (!isAuthorized(req)) {
            return authResponse();
          }
          try {
            const body = await readJsonBodyWithLimit<{
              action?: string;
              sessionId?: string;
              label?: string;
              id?: string;
            }>(req);
            if (body.action === "start" && body.sessionId) {
              recorder ??= new SessionRecorder();
              recorder.start(body.sessionId, body.label);
              return Response.json({ recordingId: recorder.currentRecordingId, status: "ok" });
            }
            if (body.action === "stop") {
              if (!recorder?.isRecording) {
                return Response.json({ error: "没有正在进行的录制" }, { status: 400 });
              }
              const meta = recorder.stop();
              return Response.json({ meta, status: "ok" });
            }
            if (body.action === "pause") {
              recorder?.pause();
              return Response.json({ status: "ok" });
            }
            if (body.action === "resume") {
              recorder?.resume();
              return Response.json({ status: "ok" });
            }
            if (body.action === "load" && body.id) {
              const data = loadRecording(body.id);
              if (!data) {
                return Response.json({ error: "录制不存在" }, { status: 404 });
              }
              return Response.json(data);
            }
            if (body.action === "delete" && body.id) {
              const ok = deleteRecording(body.id);
              return Response.json({ status: ok ? "ok" : "error" });
            }
            if (body.action === "status") {
              return Response.json({
                durationMs: recorder?.durationMs ?? 0,
                eventCount: recorder?.eventCount ?? 0,
                paused: recorder?.isPaused ?? false,
                recording: recorder?.isRecording ?? false,
              });
            }
            return Response.json({ error: "无效操作" }, { status: 400 });
          } catch (error) {
            if (error instanceof SseRequestBodyTooLargeError) {
              return Response.json({ error: "请求体过大" }, { status: 413 });
            }
            const serverError = createServerError(
              error,
              {
                operation: "recordingPost",
                route: "/api/recording",
              },
              "bad_request",
            );
            log.debug("解析 /api/recording 请求失败", toServerLogPayload(serverError));
            return Response.json({ error: "无效输入", errorCode: serverError.code }, { status: 400 });
          }
        },
      },

      // 协作状态
      "/api/collaboration": {
        GET: () =>
          Response.json({
            activeRooms: collaborationManager.getActiveRoomCount(),
            connections: collaborationManager.getActiveConnectionCount(),
            signalr: {
              activeConnections: signalrCompat.getActiveConnectionCount(),
              hub: "/collaborationHub",
              pendingConnections: signalrCompat.getPendingConnectionCount(),
            },
          }),
      },

      "/collaborationHub/negotiate": {
        POST: (req) => {
          const origin = req.headers.get("origin");
          if (origin && !isSseOriginAllowed(origin)) {
            return new Response(JSON.stringify({ error: "Forbidden: invalid origin" }), {
              headers: { "Content-Type": "application/json", ...sseCorsHeadersFor(origin) },
              status: 403,
            });
          }
          if (!isSignalRAuthorized(req)) {
            return authResponse();
          }
          return Response.json(signalrCompat.negotiate({ allowedSessionIds: getSignalRSessionScope(req) }), {
            headers: sseCorsHeadersFor(origin),
          });
        },
      },

      // 健康检查
      "/api/health": {
        GET: () =>
          Response.json({
            clients: clients.size,
            collaboration: {
              connections: collaborationManager.getActiveConnectionCount(),
              rooms: collaborationManager.getActiveRoomCount(),
            },
            recording: recorder?.isRecording
              ? {
                  durationMs: recorder.durationMs,
                  eventCount: recorder.eventCount,
                  recording: true,
                }
              : { recording: false },
            status: "ok",
            version: VERSION,
          }),
      },
    },

    // CORS 预检 + WebSocket 升级
    async fetch(req, server) {
      // WebSocket 升级:/ws 路径
      const url = new URL(req.url);
      if (url.pathname === "/ws" && req.headers.get("upgrade") === "websocket") {
        if (server.upgrade(req)) {
          return;
        }
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      if (url.pathname === "/collaborationHub" && req.headers.get("upgrade") === "websocket") {
        const origin = req.headers.get("origin");
        if (origin && !isSseOriginAllowed(origin)) {
          return new Response("Forbidden: invalid origin", { status: 403 });
        }
        if (!isSignalRAuthorized(req)) {
          return authResponse();
        }
        if (
          server.upgrade(req, {
            data: {
              connectionToken: url.searchParams.get("id") ?? undefined,
              protocol: "signalr",
            },
          })
        ) {
          return;
        }
        return new Response("SignalR WebSocket upgrade failed", { status: 400 });
      }

      if (req.method === "OPTIONS") {
        const origin = req.headers.get("origin");
        return new Response(null, {
          headers: {
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            ...sseCorsHeadersFor(origin),
          },
        });
      }
      // 委托给 apiRoutes 处理 REST API
      try {
        const { handleApiRequest } = await import("@/server/apiRoutes");
        const apiResponse = await handleApiRequest(req);
        if (apiResponse) {
          return apiResponse;
        }
      } catch (error) {
        const serverError = createServerError(
          error,
          {
            operation: "delegateApiRoutes",
            route: new URL(req.url).pathname,
          },
          "delegate",
        );
        log.warn(`apiRoutes 委托失败: ${serverError.message}`, toServerLogPayload(serverError));
      }

      // 委托给声明式 Hono API 处理(OpenAPI 路由)
      try {
        const { createOpenApiApp } = await import("@/server/api");
        const honoApp = createOpenApiApp();
        const honoResponse = await honoApp.fetch(req);
        if (honoResponse.status !== 404) {
          return honoResponse;
        }
      } catch (error) {
        const serverError = createServerError(
          error,
          {
            operation: "delegateHonoApi",
            route: new URL(req.url).pathname,
          },
          "delegate",
        );
        log.warn(`Hono API 委托失败: ${serverError.message}`, toServerLogPayload(serverError));
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  log.info(`SSE 服务器已启动: http://${host}:${port} (最大客户端: ${MAX_SSE_CLIENTS})`);
  startHeartbeat();
  if (!options.daemon) {
    console.log(`Crab CLI SSE 服务器 v${VERSION}`);
    console.log(`  端点: http://${host}:${port}/sse`);
    console.log(`  WebSocket 协作: ws://${host}:${port}/ws`);
    console.log(`  消息: http://${host}:${port}/api/message`);
    console.log(`  健康: http://${host}:${port}/api/health`);
  }
}

/** 处理消息并广播 SSE 事件(支持 sessionId 复用会话 Handler) */
async function handleMessage(message: string, sessionId: string): Promise<void> {
  const config = await sseServerDeps.loadConfig();
  const handler = getOrCreateSessionHandler(
    sessionId,
    () =>
      new sseServerDeps.ConversationHandler(config, {
        initialMessages: sseServerDeps.messageRecordsToModelMessages(sseServerDeps.getSessionMessages(sessionId)),
        sessionId,
      }),
  );
  const messageId = createId("msg");

  const unsubToken = globalBus.subscribe(AppEvent.ConversationStreamToken, (evt) => {
    if (evt.properties.sessionId !== sessionId) {
      return;
    }
    broadcastRuntimeEvent({
      messageId,
      sessionId,
      text: evt.properties.content,
      type: "assistant.delta",
    });
  });

  const unsubToolCall = globalBus.subscribe(AppEvent.ConversationToolCall, (evt) => {
    if (evt.properties.sessionId !== sessionId) {
      return;
    }
    broadcastRuntimeEvent({
      input: evt.properties.args,
      name: evt.properties.tool,
      sessionId,
      toolCallId: evt.properties.callId,
      type: "tool.call.started",
    });
  });

  const unsubToolResult = globalBus.subscribe(AppEvent.ToolResult, (evt) => {
    if (evt.properties.sessionId !== sessionId) {
      return;
    }
    const resultStr = String(evt.properties.result ?? "");
    broadcastRuntimeEvent({
      name: evt.properties.tool,
      result: resultStr.slice(0, 500),
      sessionId,
      success: evt.properties.success,
      toolCallId: evt.properties.callId,
      type: "tool.call.completed",
    });
  });

  try {
    broadcastRuntimeEvent({ messageId, sessionId, type: "message.started" });
    await handler.sendMessage(message);
    broadcastRuntimeEvent({ messageId, sessionId, type: "message.completed" });
  } catch (error) {
    const serverError = createServerError(
      error,
      {
        operation: "handleMessage",
        sessionId,
      },
      "sse",
    );
    broadcastRuntimeEvent({
      error: serverError.message,
      errorCode: serverError.code,
      sessionId,
      type: "error",
    });
  } finally {
    unsubToken();
    unsubToolCall();
    unsubToolResult();
  }
}
