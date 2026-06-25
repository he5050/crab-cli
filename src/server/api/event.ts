/**
 * Event API 路由 — SSE 事件流与持久化事件查询。
 *
 * 端点:
 *   GET /api/events          — SSE 事件流(实时推送)
 *   GET /api/events/durable  — 持久化事件查询(按 aggregateId)
 */
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { ErrorSchema } from "./index";
import { VERSION } from "@/config/version";

const DurableEventSchema = z.object({
  id: z.string(),
  seq: z.number(),
  aggregateId: z.string(),
  version: z.number(),
  definition: z.string(),
  data: z.unknown(),
  createdAt: z.number(),
});

const DurableEventListResponseSchema = z.object({
  events: z.array(DurableEventSchema),
  total: z.number(),
});

// ─── 路由定义 ───────────────────────────────────────────────

const sseEventsRoute = createRoute({
  method: "get",
  path: "/events",
  tags: ["Event"],
  summary: "SSE 事件流",
  description: "建立 Server-Sent Events 连接，实时接收事件推送",
  responses: {
    200: {
      description: "SSE 流",
      content: { "text/event-stream": { schema: z.string() } },
    },
  },
});

const getDurableEventsRoute = createRoute({
  method: "get",
  path: "/events/durable",
  tags: ["Event"],
  summary: "持久化事件查询",
  description: "按聚合根 ID 查询持久化事件(用于事件溯源/崩溃恢复)",
  request: {
    query: z.object({
      aggregateId: z.string().describe("聚合根 ID(如 sessionId)"),
      fromSeq: z.coerce.number().min(0).optional().describe("从哪个 seq 开始(默认 0=全部)"),
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: DurableEventListResponseSchema } },
      description: "持久化事件列表",
    },
  },
});

// ─── 路由处理 ───────────────────────────────────────────────

export const eventRoutes = new OpenAPIHono();

eventRoutes.openapi(sseEventsRoute, (c) => {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      // 发送连接事件
      const connectMsg = encoder.encode(`event: connected\ndata: ${JSON.stringify({ version: VERSION })}\n\n`);
      controller.enqueue(connectMsg);

      // 心跳定时器
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`event: heartbeat\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`));
        } catch {
          clearInterval(heartbeat);
        }
      }, 30_000);

      // 清理
      const cleanup = () => {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // 已关闭
        }
      };

      // 客户端断开时清理
      c.req.raw.signal?.addEventListener("abort", cleanup, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
    },
  });
});

eventRoutes.openapi(getDurableEventsRoute, async (c) => {
  const { replayEvents } = await import("@bus");
  const { aggregateId, fromSeq } = c.req.valid("query");
  const events = replayEvents(aggregateId, fromSeq ?? 0);
  return c.json({ events, total: events.length }, 200);
});
