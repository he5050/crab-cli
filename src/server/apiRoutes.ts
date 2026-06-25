/**
 * API Routes 模块
 *
 * 职责:
 *   - 提供完整的 REST API 路由端点
 *   - 支持健康检查、版本信息查询
 *   - 配置读写和 MCP 服务管理
 *   - 工具列表和 Git 状态查询
 *
 * 模块功能:
 *   - handleApiRequest(): 处理 API 请求入口
 *   - matchApiRoute(): 路由匹配
 *   - listApiRoutes(): 获取所有路由列表(调试)
 *   - RouteHandler: 路由处理器类型
 *   - Route: 路由定义类型
 *   - addRoute(): 注册路由
 *   - corsResponse(): CORS 响应包装
 *
 * 路由端点:
 *   - GET  /api/health              — 健康检查
 *   - GET  /api/version             — 版本信息
 *   - GET  /api/openapi.json        — OpenAPI 契约
 *   - GET  /api/config              — 配置读取
 *   - GET  /api/mcp/servers         — MCP 服务列表
 *   - GET  /api/mcp/servers/:name   — MCP 服务详情
 *   - GET  /api/tools               — 工具列表
 *   - GET  /api/git/status          — Git 状态
 *   - GET  /api/ide/status          — IDE 连接状态
 *   - GET  /api/ide/context         — IDE 编辑器上下文
 *   - GET  /api/ide/clients         — IDE 客户端列表
 *
 * 使用场景:
 *   - 作为 ACP/SSE 服务器的路由扩展
 *   - 外部客户端需要查询系统状态
 *   - Web 界面获取配置和工具信息
 *   - 集成开发环境插件通信
 *
 * 边界:
 *   1. 仅处理 REST API 请求，不处理 SSE 流
 *   2. 配置读取会隐藏敏感信息(如 API Key)
 *   3. 路由匹配使用正则表达式，顺序注册
 *   4. 自动处理 CORS 预检请求
 *   5. 错误统一返回 500 状态码
 *
 * 流程:
 *   1. 注册所有路由到路由表
 *   2. 请求到达时匹配路由
 *   3. 处理 CORS 预检
 *   4. 调用对应处理器
 *   5. 包装 CORS 头并返回响应
 *   6. 异常捕获并返回错误响应
 */
import { createLogger } from "@/core/logging/logger";
import { VERSION } from "@/config/version";
import { loadConfig, getAuthDir } from "@/config";
import { parsePositiveInt } from "@/tool/shared/number";
import { getMcpRuntimeBuiltinSnapshot, getMcpRuntimeSnapshot } from "@/mcp/manager/runtime";
import { renderPrometheusMetrics } from "@monitor";
import { buildApiClientJs, buildApiDocsHtml, buildOpenApiSpec } from "@/server/apiDocs";
import { safeTokenEquals, extractBearerToken } from "@/server/authGuard";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const log = createLogger("server:api-routes");

// ─── API Auth Token ─────────────────────────────────────────

const AUTH_TOKEN_FILE = "api-auth.token";
const AUTH_TOKEN_LENGTH = 32;

function getAuthTokenPath(): string {
  return path.join(getAuthDir(), AUTH_TOKEN_FILE);
}

/** 读取或生成 API auth token。首次启动自动创建 ~/.crab/api-auth.token (0600) */
function ensureAuthToken(): string | null {
  // 1. 显式环境变量优先
  const envToken = process.env.CRAB_API_TOKEN;
  if (envToken) {
    return envToken;
  }

  // 2. 读取已有 token 文件
  const tokenPath = getAuthTokenPath();
  try {
    if (fs.existsSync(tokenPath)) {
      return fs.readFileSync(tokenPath, "utf8").trim();
    }
  } catch (error) {
    log.warn(`读取 auth token 失败: ${error instanceof Error ? error.message : String(error)}`);
  }

  // 3. 首次启动:生成随机 token 并写入文件(0600 权限)
  try {
    const token = crypto.randomBytes(AUTH_TOKEN_LENGTH).toString("hex");
    const dir = path.dirname(tokenPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(tokenPath, token, { mode: 0o600 });
    log.info(`已生成 API auth token: ${tokenPath}`);
    return token;
  } catch (error) {
    log.error(`生成 auth token 失败: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** 读取当前生效的 auth token(不创建) */
export function getActiveAuthToken(): string | null {
  const envToken = process.env.CRAB_API_TOKEN;
  if (envToken) {
    return envToken;
  }
  const tokenPath = getAuthTokenPath();
  try {
    if (fs.existsSync(tokenPath)) {
      return fs.readFileSync(tokenPath, "utf8").trim();
    }
  } catch (error) {
    log.warn(`读取 auth token 失败: ${error instanceof Error ? error.message : String(error)}`);
  }
  return null;
}

// ─── CORS 头 ──────────────────────────────────────────────

const ALLOWED_ORIGINS = new Set(["http://127.0.0.1", "http://localhost", "http://[::1]"]);
const SENSITIVE_KEY_NAMES = new Set([
  "authorization",
  "apikey",
  "token",
  "accesstoken",
  "refreshtoken",
  "clientsecret",
  "codeverifier",
  "cookie",
  "secret",
]);

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return SENSITIVE_KEY_NAMES.has(normalized) || [...SENSITIVE_KEY_NAMES].some((name) => normalized.endsWith(name));
}

function corsHeadersFor(requestOrigin: string | null): Record<string, string> {
  if (requestOrigin && ALLOWED_ORIGINS.has(requestOrigin)) {
    return { "Access-Control-Allow-Origin": requestOrigin, Vary: "Origin" };
  }
  return {};
}

function corsResponse(
  body: string,
  status = 200,
  contentType = "application/json",
  requestOrigin: string | null = null,
) {
  return new Response(body, {
    headers: {
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Content-Type": contentType,
      ...corsHeadersFor(requestOrigin),
    },
    status,
  });
}

export const API_ERROR_CODES = {
  BAD_REQUEST: "BAD_REQUEST",
  GIT_NOT_AVAILABLE: "GIT_NOT_AVAILABLE",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  NOT_FOUND: "NOT_FOUND",
  ROLLBACK_POINT_NOT_FOUND: "ROLLBACK_POINT_NOT_FOUND",
  SESSION_NOT_FOUND: "SESSION_NOT_FOUND",
  UNAUTHORIZED: "UNAUTHORIZED",
} as const;

type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

function apiErrorResponse(
  code: ApiErrorCode,
  message: string,
  status: number,
  requestOrigin: string | null = null,
): Response {
  return corsResponse(
    JSON.stringify({
      code,
      error: message,
      message,
    }),
    status,
    "application/json",
    requestOrigin,
  );
}

export function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSensitive);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const redacted: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    redacted[key] = isSensitiveKey(key) ? "***" : redactSensitive(child);
  }
  return redacted;
}

// ─── 路由处理器 ────────────────────────────────────────────

type RouteHandler = (req: Request, params: Record<string, string>) => Promise<Response> | Response;

interface Route {
  method: string;
  pattern: RegExp;
  handler: RouteHandler;
}

const routes: Route[] = [];

function addRoute(method: string, pattern: string, handler: RouteHandler) {
  routes.push({ handler, method, pattern: new RegExp(`^${pattern}$`) });
}

// ─── 健康检查 ──────────────────────────────────────────────

addRoute("GET", "/api/health", () =>
  corsResponse(
    JSON.stringify({
      memory: process.memoryUsage(),
      status: "ok",
      uptime: process.uptime(),
      version: VERSION,
    }),
  ),
);

// ─── 版本信息 ──────────────────────────────────────────────

addRoute("GET", "/api/version", () => corsResponse(JSON.stringify({ name: "crab-cli", version: VERSION })));

// ─── OpenAPI 契约 ──────────────────────────────────────────

addRoute("GET", String.raw`/api/openapi\.json`, () => corsResponse(JSON.stringify(buildOpenApiSpec(API_ERROR_CODES))));

addRoute("GET", "/api/docs", () =>
  corsResponse(buildApiDocsHtml(buildOpenApiSpec(API_ERROR_CODES)), 200, "text/html; charset=utf-8"),
);

addRoute("GET", String.raw`/api/client\.js`, () =>
  corsResponse(buildApiClientJs(), 200, "application/javascript; charset=utf-8"),
);

addRoute("GET", "/api/metrics", () =>
  corsResponse(renderPrometheusMetrics(), 200, "text/plain; version=0.0.4; charset=utf-8"),
);

// ─── 配置读写 ──────────────────────────────────────────────

addRoute("GET", "/api/config", async () => {
  const config = await loadConfig();
  const safe = redactSensitive(JSON.parse(JSON.stringify(config)));
  return corsResponse(JSON.stringify(safe));
});

// ─── MCP 服务管理 ──────────────────────────────────────────

addRoute("GET", "/api/mcp/servers", () => {
  const servers = getMcpRuntimeSnapshot();
  const builtinGroups = getMcpRuntimeBuiltinSnapshot();
  return corsResponse(JSON.stringify({ builtinGroups, servers }));
});

addRoute("GET", "/api/mcp/servers/([^/]+)", (_req, params) => {
  const name = params["0"];
  const servers = getMcpRuntimeSnapshot();
  const server = servers.find((s) => s.name === name);
  if (!server) {
    return apiErrorResponse(API_ERROR_CODES.NOT_FOUND, "Server not found", 404);
  }
  return corsResponse(JSON.stringify(server));
});

// ─── 工具列表 ──────────────────────────────────────────────

addRoute("GET", "/api/tools", () => {
  const tools = [
    { category: "core", description: "执行 Shell 命令", name: "bash" },
    { category: "core", description: "读取文件", name: "read" },
    { category: "core", description: "写入文件", name: "write" },
    { category: "core", description: "编辑文件", name: "edit" },
    { category: "core", description: "搜索文件内容", name: "grep" },
    { category: "core", description: "搜索文件名", name: "glob" },
    { category: "code", description: "代码格式化", name: "format" },
    { category: "vcs", description: "Git 操作", name: "git" },
    { category: "web", description: "网络搜索", name: "websearch" },
    { category: "web", description: "获取网页内容", name: "webfetch" },
    { category: "session", description: "会话分享", name: "share" },
    { category: "search", description: "代码库搜索", name: "codebase-search" },
  ];
  return corsResponse(JSON.stringify({ tools }));
});

// ─── Git 状态 ──────────────────────────────────────────────

addRoute("GET", "/api/git/status", async () => {
  try {
    const proc = Bun.spawn(["git", "status", "--short", "--branch"], {
      stderr: "pipe",
      stdout: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    return corsResponse(JSON.stringify({ status: stdout.trim() }));
  } catch {
    return apiErrorResponse(API_ERROR_CODES.GIT_NOT_AVAILABLE, "Not a git repository", 400);
  }
});

// ─── IDE 连接状态 ──────────────────────────────────────────

addRoute("GET", "/api/ide/status", async () => {
  const { ideStateManager } = await import("@/ide/connection/stateManager");
  const state = ideStateManager.getState();
  return corsResponse(JSON.stringify(state));
});

addRoute("GET", "/api/ide/context", async () => {
  const { getAggregatedContextPrompt } = await import("@/ide/connection/contextManager");
  const prompt = getAggregatedContextPrompt();
  return corsResponse(JSON.stringify({ hasContext: prompt.length > 0, prompt }));
});

addRoute("GET", "/api/ide/clients", async () => {
  const { ideWsServer } = await import("@/ide/connection/wsServer");
  const clients = ideWsServer.getClients().map((c) => ({
    connectedAt: c.connectedAt,
    id: c.id,
    lastActiveAt: c.lastActiveAt,
    workspaceFolder: c.workspaceFolder,
  }));
  return corsResponse(JSON.stringify({ clients, serverPort: ideWsServer.port }));
});

addRoute("GET", "/api/ide/vsix/surface", async () => {
  const { getVsixSurface } = await import("@/ide/vsix");
  return corsResponse(JSON.stringify(getVsixSurface()));
});

// ─── 会话 CRUD ──────────────────────────────────────────────

addRoute("GET", "/api/sessions", async (req) => {
  const { listSessions } = await import("@session");
  const url = new URL(req.url);
  const query = (url.searchParams.get("q") ?? url.searchParams.get("search") ?? "").trim().toLowerCase();
  const status = url.searchParams.get("status");
  const limit = parsePositiveInt(url.searchParams.get("limit"), 50);
  const offset = parseNonNegativeInt(url.searchParams.get("offset"), 0);
  const all = listSessions()
    .filter(
      (session) => !query || session.id.toLowerCase().includes(query) || session.title.toLowerCase().includes(query),
    )
    .filter((session) => !status || session.status === status);
  const sessions = all.slice(offset, offset + limit);
  return corsResponse(JSON.stringify({ limit, offset, sessions, total: all.length }));
});

addRoute("POST", "/api/sessions", async (req) => {
  const { createSessionAsync } = await import("@session");
  try {
    const body = await readJsonBody<{ title?: string; model?: string; projectDir?: string }>(req);
    const session = await createSessionAsync(body);
    return corsResponse(JSON.stringify(session), 201);
  } catch (error) {
    return apiErrorResponse(API_ERROR_CODES.BAD_REQUEST, error instanceof Error ? error.message : "创建失败", 400);
  }
});

addRoute("GET", "/api/sessions/([^/]+)", async (_req, params) => {
  const { getSession } = await import("@session");
  const session = getSession(params["0"]!);
  if (!session) {
    return apiErrorResponse(API_ERROR_CODES.SESSION_NOT_FOUND, "会话不存在", 404);
  }
  return corsResponse(JSON.stringify(session));
});

addRoute("DELETE", "/api/sessions/([^/]+)", async (_req, params) => {
  const { deleteSession } = await import("@session");
  const deleted = deleteSession(params["0"]!);
  if (!deleted) {
    return apiErrorResponse(API_ERROR_CODES.SESSION_NOT_FOUND, "会话不存在", 404);
  }
  return corsResponse(JSON.stringify({ status: "ok" }));
});

// ─── 会话消息 ──────────────────────────────────────────────

addRoute("GET", "/api/sessions/([^/]+)/messages", async (_req, params) => {
  const { getSession, getSessionMessages } = await import("@session");
  const sessionId = params["0"]!;
  if (!getSession(sessionId)) {
    return apiErrorResponse(API_ERROR_CODES.SESSION_NOT_FOUND, "会话不存在", 404);
  }
  const messages = getSessionMessages(sessionId);
  return corsResponse(JSON.stringify({ messages, total: messages.length }));
});

// ─── 会话压缩 ──────────────────────────────────────────────

addRoute("POST", "/api/sessions/([^/]+)/compress", async (req, params) => {
  const { getSession, getSessionMessages } = await import("@session");
  const sessionId = params["0"]!;
  if (!getSession(sessionId)) {
    return apiErrorResponse(API_ERROR_CODES.SESSION_NOT_FOUND, "会话不存在", 404);
  }
  const messages = getSessionMessages(sessionId);
  if (messages.length === 0) {
    return apiErrorResponse(API_ERROR_CODES.BAD_REQUEST, "会话无消息", 400);
  }
  const body = await readJsonBody<{ mode?: "compact" | "hybrid" }>(req);
  const config = await loadConfig();
  const { compactSession, hybridCompactSession } = await import("@compress");
  const result =
    body.mode === "hybrid" ? await hybridCompactSession(sessionId, config) : await compactSession(sessionId, config);
  return corsResponse(JSON.stringify({ mode: body.mode ?? "compact", sessionId, ...result }), result.ok ? 200 : 400);
});

// ─── 会话分叉 ──────────────────────────────────────────────

addRoute("POST", "/api/sessions/([^/]+)/fork", async (req, params) => {
  const { forkSession } = await import("@session");
  const sessionId = params["0"]!;
  try {
    const body = await readJsonBody<{ title?: string }>(req);
    const forked = forkSession(sessionId, body?.title);
    if (!forked) {
      return apiErrorResponse(API_ERROR_CODES.SESSION_NOT_FOUND, "源会话不存在", 404);
    }
    return corsResponse(JSON.stringify({ newSessionId: forked.id, parentId: sessionId, title: forked.title }));
  } catch (error) {
    return apiErrorResponse(API_ERROR_CODES.BAD_REQUEST, error instanceof Error ? error.message : "分叉失败", 400);
  }
});

// ─── 分支点管理 ────────────────────────────────────────────

addRoute("GET", "/api/rollback-points", async (req) => {
  const { listBranchPoints } = await import("@/tool/rollback/branchPoints");
  const url = new URL(req.url);
  const points = await listBranchPoints(url.searchParams.get("sessionId") ?? undefined);
  const summary = points.map((bp: any) => ({
    compactionIndex: bp.compactionIndex,
    compressionRatio: bp.metadata.compressionRatio,
    id: bp.id,
    sessionId: bp.sessionId,
    timestamp: bp.timestamp,
    tokensAfter: bp.metadata.totalTokensAfter,
    tokensBefore: bp.metadata.totalTokensBefore,
  }));
  return corsResponse(JSON.stringify({ points: summary, total: summary.length }));
});

addRoute("GET", "/api/rollback-points/([^/]+)", async (_req, params) => {
  const { loadBranchPoint } = await import("@/tool/rollback/branchPoints");
  const bp = await loadBranchPoint(params["0"]!);
  if (!bp) {
    return apiErrorResponse(API_ERROR_CODES.ROLLBACK_POINT_NOT_FOUND, "分支点不存在", 404);
  }
  return corsResponse(
    JSON.stringify({
      afterState: {
        messageCount: bp.afterState.messages.length,
        summary: bp.afterState.summary,
      },
      beforeState: {
        messageCount: bp.beforeState.messages.length,
        splitIndex: bp.beforeState.splitIndex,
      },
      compactionIndex: bp.compactionIndex,
      id: bp.id,
      metadata: bp.metadata,
      sessionId: bp.sessionId,
      timestamp: bp.timestamp,
    }),
  );
});

addRoute("POST", "/api/rollback-points/([^/]+)/rollback", async (req, params) => {
  const { rollbackToBranchPoint } = await import("@/tool/rollback/crossSession");
  const branchPointId = params["0"]!;
  try {
    const body = await readJsonBody<{ strategy?: "fork" | "replace" }>(req);
    const result = await rollbackToBranchPoint(branchPointId, body?.strategy ?? "fork");
    return corsResponse(JSON.stringify(result));
  } catch (error) {
    return apiErrorResponse(API_ERROR_CODES.BAD_REQUEST, error instanceof Error ? error.message : "回滚失败", 400);
  }
});

addRoute("DELETE", "/api/rollback-points/([^/]+)", async (_req, params) => {
  const { deleteBranchPoint } = await import("@/tool/rollback/branchPoints");
  const deleted = await deleteBranchPoint(params["0"]!);
  if (!deleted) {
    return apiErrorResponse(API_ERROR_CODES.ROLLBACK_POINT_NOT_FOUND, "分支点不存在", 404);
  }
  return corsResponse(JSON.stringify({ status: "ok" }));
});

/** API 请求体最大字节数（1MB），防止恶意大 body 导致内存耗尽 */
const MAX_BODY_BYTES = 1024 * 1024;

async function readJsonBody<T extends object>(req: Request): Promise<T> {
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) {
    throw new Error("请求体过大");
  }
  if (!text.trim()) {
    return {} as T;
  }
  return JSON.parse(text) as T;
}

function parseNonNegativeInt(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

// ─── 路由匹配 ──────────────────────────────────────────────

export function matchApiRoute(
  method: string,
  pathname: string,
): { handler: RouteHandler; params: Record<string, string> } | null {
  for (const route of routes) {
    if (route.method !== method) {
      continue;
    }
    const match = pathname.match(route.pattern);
    if (match) {
      const params: Record<string, string> = {};
      match.slice(1).forEach((v, i) => {
        params[String(i)] = v;
      });
      return { handler: route.handler, params };
    }
  }
  return null;
}

/** 处理 API 请求 */
export async function handleApiRequest(req: Request): Promise<Response | null> {
  const origin = req.headers.get("origin");

  // CORS 预检
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        ...corsHeadersFor(origin),
      },
      status: 204,
    });
  }

  // Token 认证:默认启用(GET 只读端点豁免)
  const authToken = ensureAuthToken();
  if (authToken && req.method !== "GET") {
    if (!safeTokenEquals(extractBearerToken(req), authToken)) {
      return apiErrorResponse(API_ERROR_CODES.UNAUTHORIZED, "Unauthorized", 401, origin);
    }
  }

  const url = new URL(req.url);
  const matched = matchApiRoute(req.method, url.pathname);
  if (!matched) {
    return null;
  }

  try {
    let res = await matched.handler(req, matched.params);
    // 注入 CORS 头
    const cors = corsHeadersFor(origin);
    if (Object.keys(cors).length > 0) {
      const newHeaders = new Headers(res.headers);
      for (const [k, v] of Object.entries(cors)) {
        if (!newHeaders.has(k)) {
          newHeaders.set(k, v);
        }
      }
      res = new Response(res.body, { headers: newHeaders, status: res.status });
    }
    return res;
  } catch (error) {
    log.error(`API 错误 ${req.method} ${url.pathname}: ${error instanceof Error ? error.message : String(error)}`);
    return apiErrorResponse(API_ERROR_CODES.INTERNAL_ERROR, "Internal server error", 500, origin);
  }
}

/** 获取所有已注册路由的列表(调试用) */
export function listApiRoutes(): { method: string; pattern: string }[] {
  return routes.map((r) => ({ method: r.method, pattern: r.pattern.source }));
}
