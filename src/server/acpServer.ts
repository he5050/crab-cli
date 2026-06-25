/**
 * ACP Server 模块
 *
 * 职责:
 *   - 提供 Agent Communication Protocol 服务端点
 *   - 管理 ACP 会话生命周期
 *   - 处理客户端消息请求
 *   - 暴露可用工具列表
 *
 * 模块功能:
 *   - startAcpServer(): 启动 ACP 服务器
 *   - AcpServerOptions: 服务器配置选项
 *   - 会话管理端点(创建、列出、查询、关闭)
 *   - 消息发送端点(POST /acp/sessions/:id/msg)
 *   - 工具列表端点(GET /acp/tools)
 *   - 健康检查端点(GET /acp/health)
 *   - ConversationHandler 会话封装
 *
 * 使用场景:
 *   - 外部 Agent 客户端需要与 crab-cli 交互
 *   - 需要会话保持的长时间对话
 *   - RESTful API 风格的通信需求
 *   - 其他 Agent 工具集成
 *
 * 边界:
 *   1. 使用 Bun.serve 实现，不依赖 express
 *   2. 会话仅内存存储，重启后丢失
 *   3. 消息处理是同步阻塞的
 *   4. 需要预先启动 MCP Runtime
 *   5. 每个会话独立创建 ConversationHandler
 *
 * 流程:
 *   1. 启动服务器并监听指定端口
 *   2. 客户端创建会话(POST /acp/sessions)
 *   3. 客户端发送消息到会话(POST /acp/sessions/:id/msg)
 *   4. 使用对应会话的 ConversationHandler 处理消息
 *   5. 返回处理结果给客户端
 *   6. 客户端可关闭会话(DELETE /acp/sessions/:id)
 */
import { createLogger } from "@/core/logging/logger";
import { loadConfig } from "@/config";
import { ConversationHandler } from "@/conversation";
import { VERSION } from "@/config/version";
import { ensureMcpRuntimeStarted } from "@/mcp/manager/runtime";
import { getSessionMessages, messageRecordsToModelMessages } from "@/session";
import { globalBus } from "@/bus";
import { AppEvent } from "@/bus";
import { type RuntimeEventInput, createRuntimeEvent, toAcpSessionUpdate } from "@/bus";
import { safeTokenEquals, requireAuthForHost, authResponse, extractBearerToken } from "@/server/authGuard";
import { prefixedId } from "@/core/id";
const log = createLogger("acp-server");

type AcpConversationHandler = Pick<ConversationHandler, "sendMessage">;
type AcpConversationHandlerCtor = new (
  config: Awaited<ReturnType<typeof loadConfig>>,
  options: ConstructorParameters<typeof ConversationHandler>[1],
) => AcpConversationHandler;

const acpServerDeps = {
  ConversationHandler: ConversationHandler as AcpConversationHandlerCtor,
  ensureMcpRuntimeStarted,
  loadConfig,
};

const ACP_MESSAGE_BODY_LIMIT_BYTES = 1024 * 1024;

class AcpRequestBodyTooLargeError extends Error {
  constructor() {
    super("ACP request body too large");
  }
}

async function readJsonBodyWithLimit<T>(req: Request): Promise<T> {
  const text = await req.text();
  if (text.length > ACP_MESSAGE_BODY_LIMIT_BYTES) {
    throw new AcpRequestBodyTooLargeError();
  }
  if (!text.trim()) {
    return {} as T;
  }
  return JSON.parse(text) as T;
}

export function __setAcpServerDepsForTesting(overrides: Partial<typeof acpServerDeps>): void {
  Object.assign(acpServerDeps, overrides);
}

export function __resetAcpServerDepsForTesting(): void {
  acpServerDeps.loadConfig = loadConfig;
  acpServerDeps.ConversationHandler = ConversationHandler as AcpConversationHandlerCtor;
  acpServerDeps.ensureMcpRuntimeStarted = ensureMcpRuntimeStarted;
  sessions.clear();
}

export interface AcpServerOptions {
  port?: number;
  host?: string;
  /** Test/dev escape hatch. Production defaults to requiring auth for state-changing routes. */
  allowLocalWithoutToken?: boolean;
}

interface AcpSession {
  id: string;
  handler: AcpConversationHandler;
  createdAt: number;
  status: "active" | "closed";
}

function buildHandlerForSession(
  config: Awaited<ReturnType<typeof loadConfig>>,
  sessionId: string,
): ConversationHandler {
  return new acpServerDeps.ConversationHandler(config, {
    initialMessages: messageRecordsToModelMessages(getSessionMessages(sessionId)),
    sessionId,
  }) as ConversationHandler;
}

function collectAcpUpdatesForSession(sessionId: string): {
  updates: Record<string, unknown>[];
  unsubscribe: () => void;
} {
  const updates: Record<string, unknown>[] = [];
  const pushRuntimeUpdate = (input: RuntimeEventInput) => {
    const mapped = toAcpSessionUpdate(createRuntimeEvent(input));
    if (mapped) {
      updates.push(mapped.update);
    }
  };
  const unsubscribers = [
    globalBus.subscribe(AppEvent.ConversationStreamToken, (evt) => {
      if (evt.properties.sessionId !== sessionId) {
        return;
      }
      pushRuntimeUpdate({
        messageId: sessionId,
        sessionId,
        text: evt.properties.content,
        type: "assistant.delta",
      });
    }),
    globalBus.subscribe(AppEvent.ConversationToolCall, (evt) => {
      if (evt.properties.sessionId !== sessionId) {
        return;
      }
      pushRuntimeUpdate({
        input: evt.properties.args,
        name: evt.properties.tool,
        sessionId,
        toolCallId: evt.properties.callId,
        type: "tool.call.started",
      });
    }),
    globalBus.subscribe(AppEvent.ToolResult, (evt) => {
      if (evt.properties.sessionId !== sessionId) {
        return;
      }
      pushRuntimeUpdate({
        name: evt.properties.tool,
        result: evt.properties.result,
        sessionId,
        success: evt.properties.success,
        toolCallId: evt.properties.callId,
        type: "tool.call.completed",
      });
    }),
  ];
  return {
    unsubscribe: () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    },
    updates,
  };
}

/** 活跃的 ACP 会话 */
const sessions = new Map<string, AcpSession>();
let allowLocalWithoutTokenForCurrentServer = false;

function isAuthorized(req: Request): boolean {
  const token = process.env.CRAB_API_TOKEN;
  if (!token) {
    return allowLocalWithoutTokenForCurrentServer;
  }
  return safeTokenEquals(extractBearerToken(req), token);
}

/**
 * 启动 ACP 服务器。
 */
export async function startAcpServer(options: AcpServerOptions = {}): Promise<void> {
  const port = options.port ?? 3001;
  const host = options.host ?? "127.0.0.1";
  allowLocalWithoutTokenForCurrentServer = options.allowLocalWithoutToken ?? false;
  requireAuthForHost(host, allowLocalWithoutTokenForCurrentServer);

  await acpServerDeps.ensureMcpRuntimeStarted();

  const server = Bun.serve({
    fetch: async (req) => {
      const url = new URL(req.url);

      // CORS 预检
      if (req.method === "OPTIONS") {
        return new Response(null, {
          headers: {
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          },
        });
      }

      if (url.pathname === "/acp/ping" && req.method === "GET") {
        return Response.json({ ok: true, version: VERSION });
      }

      const loadMatch = url.pathname.match(/^\/acp\/sessions\/([^/]+)\/load$/);
      if (loadMatch && req.method === "POST") {
        if (!isAuthorized(req)) {
          return authResponse();
        }
        const sessionId = loadMatch[1]!;
        const config = await acpServerDeps.loadConfig();
        const session: AcpSession = {
          createdAt: Date.now(),
          handler: buildHandlerForSession(config, sessionId),
          id: sessionId,
          status: "active",
        };
        sessions.set(sessionId, session);
        const loadedUpdate = toAcpSessionUpdate(createRuntimeEvent({ sessionId, type: "session.loaded" }));
        return Response.json({ id: sessionId, status: "active", updates: loadedUpdate ? [loadedUpdate.update] : [] });
      }

      // 发送消息到会话:POST /acp/sessions/:id/msg
      const msgMatch = url.pathname.match(/^\/acp\/sessions\/([^/]+)\/msg$/);
      if (msgMatch && req.method === "POST") {
        if (!isAuthorized(req)) {
          return authResponse();
        }
        const sessionId = msgMatch[1]!;
        const session = sessions.get(sessionId);
        if (!session || session.status === "closed") {
          return Response.json({ error: "会话未找到" }, { status: 404 });
        }
        try {
          const body = await readJsonBodyWithLimit<{ message?: string }>(req);
          if (!body.message) {
            return Response.json({ error: "无效输入" }, { status: 400 });
          }

          // 异步处理
          const collector = collectAcpUpdatesForSession(sessionId);
          const result = await session.handler.sendMessage(body.message).finally(collector.unsubscribe);
          const preview = result.text.slice(0, 1000);
          return Response.json({ result: preview, status: "ok", updates: collector.updates });
        } catch (error) {
          if (error instanceof AcpRequestBodyTooLargeError) {
            return Response.json({ error: "请求体过大" }, { status: 413 });
          }
          return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
        }
      }

      // 获取会话状态:GET /acp/sessions/:id
      const sessionMatch = url.pathname.match(/^\/acp\/sessions\/([^/]+)$/);
      if (sessionMatch && req.method === "GET") {
        const sessionId = sessionMatch[1]!;
        const session = sessions.get(sessionId);
        if (!session) {
          return Response.json({ error: "会话未找到" }, { status: 404 });
        }
        return Response.json({ createdAt: session.createdAt, id: session.id, status: session.status });
      }

      // 关闭会话:DELETE /acp/sessions/:id
      if (sessionMatch && req.method === "DELETE") {
        if (!isAuthorized(req)) {
          return authResponse();
        }
        const sessionId = sessionMatch[1]!;
        const session = sessions.get(sessionId);
        if (session) {
          session.status = "closed";
          sessions.delete(sessionId);
          log.info(`ACP 会话关闭: ${sessionId}`);
        }
        return Response.json({ status: "closed" });
      }

      return new Response("未找到", { status: 404 });
    },
    hostname: host,
    port,
    routes: {
      // 健康检查
      "/acp/health": {
        GET: () => Response.json({ sessions: sessions.size, status: "ok", version: VERSION }),
      },

      // 列出可用工具
      "/acp/tools": {
        GET: () => {
          const tools = [
            { description: "执行 Shell 命令", name: "bash" },
            { description: "编辑文件", name: "edit" },
            { description: "读取文件", name: "read" },
            { description: "写入文件", name: "write" },
            { description: "搜索文件内容", name: "grep" },
            { description: "搜索文件名", name: "glob" },
            { description: "网络搜索", name: "websearch" },
          ];
          return Response.json({ tools });
        },
      },

      // 列出会话
      "/acp/sessions": {
        GET: () => {
          const list = [...sessions.values()].map((s) => ({
            createdAt: s.createdAt,
            id: s.id,
            status: s.status,
          }));
          return Response.json({ sessions: list });
        },
        // 创建会话
        POST: async (req) => {
          if (!isAuthorized(req)) {
            return authResponse();
          }
          const config = await acpServerDeps.loadConfig();
          const id = prefixedId("session");
          const handler = buildHandlerForSession(config, id);
          const session: AcpSession = {
            createdAt: Date.now(),
            handler,
            id,
            status: "active",
          };
          sessions.set(id, session);
          log.info(`ACP 会话创建: ${id}`);
          return Response.json({ id, status: "active" }, { status: 201 });
        },
      },
    },
  });

  log.info(`ACP 服务器已启动: http://${host}:${port}`);
  console.log(`Crab CLI ACP 服务 v${VERSION}`);
  console.log(`  端点: http://${host}:${port}/acp/sessions`);
  console.log(`  工具: http://${host}:${port}/acp/tools`);
  console.log(`  健康: http://${host}:${port}/acp/health`);
}
