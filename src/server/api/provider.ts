/**
 * Provider API 路由 — AI 提供商管理。
 *
 * 端点:
 *   GET /api/providers           — 所有提供商列表
 *   GET /api/providers/:id       — 提供商详情
 */
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { notFoundResponse, ErrorSchema } from "./index";

const ProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
  defaultModel: z.string(),
  models: z.array(z.string()),
  envKey: z.string(),
  baseUrl: z.string().optional(),
});

const ProviderListResponseSchema = z.object({
  providers: z.array(ProviderSchema),
  total: z.number(),
});

// ─── 路由定义 ───────────────────────────────────────────────

const listProvidersRoute = createRoute({
  method: "get",
  path: "/providers",
  tags: ["Provider"],
  summary: "提供商列表",
  description: "获取所有已注册的 AI 提供商列表",
  responses: {
    200: {
      content: { "application/json": { schema: ProviderListResponseSchema } },
      description: "提供商列表",
    },
  },
});

const getProviderRoute = createRoute({
  method: "get",
  path: "/providers/{id}",
  tags: ["Provider"],
  summary: "提供商详情",
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: ProviderSchema } },
      description: "提供商详情",
    },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "提供商不存在",
    },
  },
});

// ─── 路由处理 ───────────────────────────────────────────────

export const providerRoutes = new OpenAPIHono();

providerRoutes.openapi(listProvidersRoute, async (c) => {
  const { listProviders } = await import("@/config/features/apiConfig");
  const providers = listProviders();
  return c.json({ providers, total: providers.length }, 200);
});

providerRoutes.openapi(getProviderRoute, async (c) => {
  const { getProvider } = await import("@/config/features/apiConfig");
  const { id } = c.req.valid("param");
  const provider = getProvider(id);
  if (!provider) {
    return notFoundResponse("提供商不存在");
  }
  return c.json(provider, 200);
});
