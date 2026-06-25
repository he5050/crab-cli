/**
 * Session API 路由 — 会话 CRUD。
 *
 * 端点:
 *   GET    /api/sessions          — 会话列表(支持搜索/分页)
 *   POST   /api/sessions          — 创建会话
 *   GET    /api/sessions/:id      — 会话详情
 *   DELETE /api/sessions/:id      — 删除会话
 */
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { badRequestResponse, notFoundResponse, ErrorSchema } from "./index";

const SessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(["active", "paused", "completed", "error"]),
  model: z.string().nullable(),
  parentId: z.string().nullable(),
  projectDir: z.string().nullable(),
  tokensInput: z.number(),
  tokensOutput: z.number(),
  tokensReasoning: z.number(),
  cost: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const SessionListItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(["active", "paused", "completed", "error"]),
  model: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  messageCount: z.number(),
});

const SessionListResponseSchema = z.object({
  sessions: z.array(SessionListItemSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

const CreateSessionSchema = z.object({
  title: z.string().optional(),
  model: z.string().optional(),
  projectDir: z.string().optional(),
});

// ─── 路由定义 ───────────────────────────────────────────────

const listSessionsRoute = createRoute({
  method: "get",
  path: "/sessions",
  tags: ["Session"],
  summary: "会话列表",
  description: "获取会话列表，支持搜索和分页",
  request: {
    query: z.object({
      q: z.string().optional().describe("按 id/title 搜索"),
      status: z.string().optional().describe("会话状态过滤"),
      limit: z.coerce.number().min(1).optional().describe("分页大小"),
      offset: z.coerce.number().min(0).optional().describe("分页偏移"),
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: SessionListResponseSchema } },
      description: "会话列表",
    },
  },
});

const createSessionRoute = createRoute({
  method: "post",
  path: "/sessions",
  tags: ["Session"],
  summary: "创建会话",
  description: "创建新的 AI 对话会话",
  request: {
    body: {
      content: { "application/json": { schema: CreateSessionSchema } },
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: SessionSchema } },
      description: "创建成功",
    },
    400: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "无效输入",
    },
  },
  security: [{ bearerAuth: [] }],
});

const getSessionRoute = createRoute({
  method: "get",
  path: "/sessions/{id}",
  tags: ["Session"],
  summary: "会话详情",
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: SessionSchema } },
      description: "会话详情",
    },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "会话不存在",
    },
  },
});

const deleteSessionRoute = createRoute({
  method: "delete",
  path: "/sessions/{id}",
  tags: ["Session"],
  summary: "删除会话",
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ status: z.string() }) } },
      description: "删除成功",
    },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "会话不存在",
    },
  },
  security: [{ bearerAuth: [] }],
});

// ─── 路由处理 ───────────────────────────────────────────────

export const sessionRoutes = new OpenAPIHono();

sessionRoutes.openapi(listSessionsRoute, async (c) => {
  const { listSessions } = await import("@session");
  const { q, status, limit, offset } = c.req.valid("query");
  const query = (q ?? "").trim().toLowerCase();
  const all = listSessions()
    .filter(
      (session) => !query || session.id.toLowerCase().includes(query) || session.title.toLowerCase().includes(query),
    )
    .filter((session) => !status || session.status === status);
  const sessions = all.slice(offset ?? 0, (offset ?? 0) + (limit ?? 50));
  return c.json({ sessions, total: all.length, limit: limit ?? 50, offset: offset ?? 0 }, 200);
});

sessionRoutes.openapi(createSessionRoute, async (c) => {
  const { createSessionAsync } = await import("@session");
  try {
    const body = c.req.valid("json");
    const session = await createSessionAsync(body);
    return c.json(session, 201);
  } catch (error) {
    return badRequestResponse(error instanceof Error ? error.message : "创建失败");
  }
});

sessionRoutes.openapi(getSessionRoute, async (c) => {
  const { getSession } = await import("@session");
  const { id } = c.req.valid("param");
  const session = getSession(id);
  if (!session) {
    return notFoundResponse("会话不存在");
  }
  return c.json(session, 200);
});

sessionRoutes.openapi(deleteSessionRoute, async (c) => {
  const { deleteSession } = await import("@session");
  const { id } = c.req.valid("param");
  const deleted = deleteSession(id);
  if (!deleted) {
    return notFoundResponse("会话不存在");
  }
  return c.json({ status: "ok" }, 200);
});
