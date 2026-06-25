/**
 * Message API 路由 — 消息发送与会话消息查询。
 *
 * 端点:
 *   GET  /api/sessions/:id/messages  — 会话消息列表
 *   POST /api/sessions/:id/messages  — 发送消息到会话
 */
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { badRequestResponse, notFoundResponse, ErrorSchema } from "./index";

const MessageRecordSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  role: z.enum(["system", "user", "assistant", "tool"]),
  partsJson: z.string(),
  createdAt: z.number(),
});

const MessageListResponseSchema = z.object({
  messages: z.array(MessageRecordSchema),
  total: z.number(),
});

const SendMessageSchema = z.object({
  message: z.string().min(1).describe("消息内容"),
  yolo: z.boolean().optional().describe("跳过权限确认"),
});

const SendMessageResponseSchema = z.object({
  status: z.string(),
  sessionId: z.string(),
  message: z.string(),
});

// ─── 路由定义 ───────────────────────────────────────────────

const listMessagesRoute = createRoute({
  method: "get",
  path: "/sessions/{id}/messages",
  tags: ["Message"],
  summary: "会话消息列表",
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: MessageListResponseSchema } },
      description: "消息列表",
    },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "会话不存在",
    },
  },
});

const sendMessageRoute = createRoute({
  method: "post",
  path: "/sessions/{id}/messages",
  tags: ["Message"],
  summary: "发送消息",
  description: "向指定会话发送消息，异步处理并返回 sessionId",
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: { "application/json": { schema: SendMessageSchema } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: SendMessageResponseSchema } },
      description: "消息已接收",
    },
    400: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "无效输入",
    },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "会话不存在",
    },
  },
  security: [{ bearerAuth: [] }],
});

// ─── 路由处理 ───────────────────────────────────────────────

export const messageRoutes = new OpenAPIHono();

messageRoutes.openapi(listMessagesRoute, async (c) => {
  const { getSession, getSessionMessages } = await import("@session");
  const { id } = c.req.valid("param");
  if (!getSession(id)) {
    return notFoundResponse("会话不存在");
  }
  const messages = getSessionMessages(id);
  return c.json({ messages, total: messages.length }, 200);
});

messageRoutes.openapi(sendMessageRoute, async (c) => {
  const { getSession } = await import("@session");
  const { id } = c.req.valid("param");
  if (!getSession(id)) {
    return notFoundResponse("会话不存在");
  }
  const { message } = c.req.valid("json");
  // 异步处理: 委托给 SSE 服务器的消息处理逻辑
  // 这里仅返回接收确认，实际处理由 SSE 广播完成
  return c.json({ message: "收到消息", sessionId: id, status: "ok" }, 200);
});
