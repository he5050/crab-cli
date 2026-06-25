/**
 * Model API 路由 — 模型列表查询。
 *
 * 端点:
 *   GET /api/models              — 所有模型列表(按 Provider 分组)
 *   GET /api/models/:provider    — 指定 Provider 的模型列表
 */
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { notFoundResponse, ErrorSchema } from "./index";

const ModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
});

const ModelListResponseSchema = z.object({
  models: z.array(ModelSchema),
  total: z.number(),
});

const ProviderModelListResponseSchema = z.object({
  provider: z.string(),
  models: z.array(z.string()),
  defaultModel: z.string(),
});

// ─── 路由定义 ───────────────────────────────────────────────

const listModelsRoute = createRoute({
  method: "get",
  path: "/models",
  tags: ["Model"],
  summary: "模型列表",
  description: "获取所有提供商的模型列表(按 Provider 分组)",
  responses: {
    200: {
      content: { "application/json": { schema: ModelListResponseSchema } },
      description: "模型列表",
    },
  },
});

const getProviderModelsRoute = createRoute({
  method: "get",
  path: "/models/{provider}",
  tags: ["Model"],
  summary: "Provider 模型列表",
  description: "获取指定提供商的模型列表",
  request: {
    params: z.object({ provider: z.string() }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: ProviderModelListResponseSchema } },
      description: "Provider 模型列表",
    },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Provider 不存在",
    },
  },
});

// ─── 路由处理 ───────────────────────────────────────────────

export const modelRoutes = new OpenAPIHono();

modelRoutes.openapi(listModelsRoute, async (c) => {
  const { listProviders } = await import("@/config/features/apiConfig");
  const providers = listProviders();
  const models = providers.flatMap((p) => p.models.map((m) => ({ id: m, name: m, provider: p.id })));
  return c.json({ models, total: models.length }, 200);
});

modelRoutes.openapi(getProviderModelsRoute, async (c) => {
  const { getProvider } = await import("@/config/features/apiConfig");
  const { provider } = c.req.valid("param");
  const meta = getProvider(provider);
  if (!meta) {
    return notFoundResponse("Provider 不存在");
  }
  return c.json({ defaultModel: meta.defaultModel, models: meta.models, provider: meta.id }, 200);
});
