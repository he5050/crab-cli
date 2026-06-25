/**
 * 声明式 HTTP API — OpenAPI Hono 应用入口。
 *
 * 职责:
 *   - 创建 OpenAPIHono 实例(自动生成 OpenAPI 3.1 规范)
 *   - 挂载所有声明式路由模块
 *   - 提供 /openapi.json 和 /docs (Swagger UI) 端点
 *   - 统一错误响应格式
 *
 * 使用场景:
 *   - SSE 服务器集成声明式 API 路由
 *   - 外部客户端通过 OpenAPI 契约调用 API
 *   - Swagger UI 交互式文档
 *
 * 边界:
 *   1. 仅处理 /api/* 路径下的声明式路由
 *   2. 现有 apiRoutes.ts 的手写路由保持兼容(逐步迁移)
 *   3. SSE 流式端点保留在 sseServer.ts 中
 *   4. 认证复用 authGuard 模块
 */
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { VERSION } from "@/config/version";
import { extractBearerToken, safeTokenEquals } from "@/server/authGuard";
import { createLogger } from "@/core/logging/logger";

import { sessionRoutes } from "./session";
import { messageRoutes } from "./message";
import { agentRoutes } from "./agent";
import { modelRoutes } from "./model";
import { providerRoutes } from "./provider";
import { permissionRoutes } from "./permission";
import { eventRoutes } from "./event";
import { skillRoutes } from "./skill";

const log = createLogger("server:api");

/** 统一错误响应 Schema */
export const ErrorSchema = z.object({
  code: z.string(),
  error: z.string(),
  message: z.string(),
});

/** 创建 401 未授权响应 */
export function unauthorizedResponse() {
  return Response.json({ code: "UNAUTHORIZED", error: "未授权", message: "未授权" }, { status: 401 });
}

/** 创建 404 未找到响应 */
export function notFoundResponse(message = "资源不存在") {
  return Response.json({ code: "NOT_FOUND", error: message, message }, { status: 404 });
}

/** 创建 400 错误请求响应 */
export function badRequestResponse(message = "无效输入") {
  return Response.json({ code: "BAD_REQUEST", error: message, message }, { status: 400 });
}

/** 创建 500 内部错误响应 */
export function internalErrorResponse(message = "内部错误") {
  return Response.json({ code: "INTERNAL_ERROR", error: message, message }, { status: 500 });
}

/** 创建 OpenAPIHono 应用实例 */
export function createOpenApiApp(): OpenAPIHono {
  const app = new OpenAPIHono();

  // ─── 认证中间件(非 GET 请求需要 Bearer Token) ─────────
  app.use("/api/*", async (c, next) => {
    // OPTIONS 预检直接放行
    if (c.req.method === "OPTIONS" || c.req.method === "GET") {
      await next();
      return;
    }
    const expectedToken = process.env.CRAB_API_TOKEN;
    if (!expectedToken) {
      await next();
      return;
    }
    const provided = extractBearerToken(c.req.raw);
    if (!safeTokenEquals(provided, expectedToken)) {
      return unauthorizedResponse();
    }
    await next();
  });

  // ─── 挂载路由模块 ───────────────────────────────────────
  app.route("/api", sessionRoutes);
  app.route("/api", messageRoutes);
  app.route("/api", agentRoutes);
  app.route("/api", modelRoutes);
  app.route("/api", providerRoutes);
  app.route("/api", permissionRoutes);
  app.route("/api", eventRoutes);
  app.route("/api", skillRoutes);

  // ─── OpenAPI 文档端点 ───────────────────────────────────
  app.doc("/openapi.json", {
    info: {
      title: "Crab CLI API",
      version: VERSION,
    },
    openapi: "3.1.0",
  });

  app.get("/docs", swaggerUI({ url: "/openapi.json" }));

  log.debug("声明式 API 应用已创建");
  return app;
}

export { createRoute, z };
