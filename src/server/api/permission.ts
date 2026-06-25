/**
 * Permission API 路由 — 权限请求与审批。
 *
 * 端点:
 *   GET  /api/permissions/pending  — 待审批权限请求列表
 *   POST /api/permissions/ask      — 请求权限审批
 *   POST /api/permissions/resolve  — 解决权限请求(allow/deny)
 */
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { badRequestResponse, notFoundResponse, ErrorSchema } from "./index";

const PermissionRequestSchema = z.object({
  permission: z.string().describe("权限类型(如 bash、fs.write)"),
  patterns: z.array(z.string()).describe("操作模式数组"),
  tool: z.string().describe("触发的工具名称"),
  sessionId: z.string().optional().describe("所属会话 ID"),
  description: z.string().optional().describe("附加描述"),
});

const PermissionResponseSchema = z.object({
  id: z.string(),
  status: z.enum(["pending", "allowed", "denied"]),
  permission: z.string(),
  patterns: z.array(z.string()),
});

const PendingPermissionSchema = z.object({
  id: z.string(),
  permission: z.string(),
  patterns: z.array(z.string()),
  tool: z.string(),
  sessionId: z.string().optional(),
  description: z.string().optional(),
  createdAt: z.number(),
});

const PendingListResponseSchema = z.object({
  pending: z.array(PendingPermissionSchema),
  total: z.number(),
});

const ResolvePermissionSchema = z.object({
  id: z.string().describe("权限请求 ID"),
  decision: z.enum(["allow", "deny"]).describe("审批决定"),
  scope: z.enum(["once", "session", "persistent"]).optional().describe("审批范围"),
});

// ─── 路由定义 ───────────────────────────────────────────────

const listPendingRoute = createRoute({
  method: "get",
  path: "/permissions/pending",
  tags: ["Permission"],
  summary: "待审批权限列表",
  description: "获取所有待审批的权限请求",
  responses: {
    200: {
      content: { "application/json": { schema: PendingListResponseSchema } },
      description: "待审批列表",
    },
  },
});

const askPermissionRoute = createRoute({
  method: "post",
  path: "/permissions/ask",
  tags: ["Permission"],
  summary: "请求权限审批",
  description: "提交权限审批请求，等待用户或外部系统决定",
  request: {
    body: {
      content: { "application/json": { schema: PermissionRequestSchema } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: PermissionResponseSchema } },
      description: "权限请求已提交",
    },
    400: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "无效输入",
    },
  },
  security: [{ bearerAuth: [] }],
});

const resolvePermissionRoute = createRoute({
  method: "post",
  path: "/permissions/resolve",
  tags: ["Permission"],
  summary: "解决权限请求",
  description: "对待审批的权限请求做出 allow/deny 决定",
  request: {
    body: {
      content: { "application/json": { schema: ResolvePermissionSchema } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ status: z.string() }) } },
      description: "已解决",
    },
    400: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "无效输入",
    },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "权限请求不存在",
    },
  },
  security: [{ bearerAuth: [] }],
});

// ─── 路由处理 ───────────────────────────────────────────────

export const permissionRoutes = new OpenAPIHono();

permissionRoutes.openapi(listPendingRoute, async (c) => {
  const { listPendingExternalPermissionRequests } = await import("@/permission/store/approvalBridge");
  const pending = listPendingExternalPermissionRequests();
  return c.json({ pending, total: pending.length }, 200);
});

permissionRoutes.openapi(askPermissionRoute, async (c) => {
  const body = c.req.valid("json");
  // 权限请求通过 EventBus 异步处理，这里返回请求 ID
  const { createId } = await import("@/core/identity");
  const requestId = createId("perm");
  return c.json(
    {
      id: requestId,
      patterns: body.patterns,
      permission: body.permission,
      status: "pending" as const,
    },
    200,
  );
});

permissionRoutes.openapi(resolvePermissionRoute, async (c) => {
  const { resolveExternalPermissionRequest } = await import("@/permission/store/approvalBridge");
  const { id, decision } = c.req.valid("json");
  const resolved = resolveExternalPermissionRequest(id, decision);
  if (!resolved) {
    return notFoundResponse("权限请求不存在");
  }
  return c.json({ status: "ok" }, 200);
});
