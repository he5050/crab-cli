/**
 * Agent API 路由 — Agent 列表查询。
 *
 * 端点:
 *   GET /api/agents       — 所有已注册 Agent 列表
 *   GET /api/agents/:name — Agent 详情
 */
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { notFoundResponse, ErrorSchema } from "./index";

const AgentSchema = z.object({
  name: z.string(),
  label: z.string(),
  description: z.string(),
  mode: z.enum(["primary", "subagent", "all"]),
  model: z
    .object({
      providerID: z.string(),
      modelID: z.string(),
    })
    .optional(),
  hidden: z.boolean().optional(),
  native: z.boolean().optional(),
  color: z.string().optional(),
  icon: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const AgentListResponseSchema = z.object({
  agents: z.array(AgentSchema),
  total: z.number(),
});

// ─── 路由定义 ───────────────────────────────────────────────

const listAgentsRoute = createRoute({
  method: "get",
  path: "/agents",
  tags: ["Agent"],
  summary: "Agent 列表",
  description: "获取所有已注册的 Agent 列表",
  responses: {
    200: {
      content: { "application/json": { schema: AgentListResponseSchema } },
      description: "Agent 列表",
    },
  },
});

const getAgentRoute = createRoute({
  method: "get",
  path: "/agents/{name}",
  tags: ["Agent"],
  summary: "Agent 详情",
  request: {
    params: z.object({ name: z.string() }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: AgentSchema } },
      description: "Agent 详情",
    },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Agent 不存在",
    },
  },
});

// ─── 路由处理 ───────────────────────────────────────────────

export const agentRoutes = new OpenAPIHono();

agentRoutes.openapi(listAgentsRoute, async (c) => {
  const { listAgents } = await import("@/agent/core/manager");
  const agents = listAgents();
  return c.json({ agents, total: agents.length }, 200);
});

agentRoutes.openapi(getAgentRoute, async (c) => {
  const { getAgent } = await import("@/agent/core/manager");
  const { name } = c.req.valid("param");
  const agent = getAgent(name);
  if (!agent) {
    return notFoundResponse("Agent 不存在");
  }
  return c.json(agent, 200);
});
