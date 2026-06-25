/**
 * P2-7: SSE Server API 增强测试
 *
 * 测试范围:
 *   1. matchApiRoute — 会话 CRUD 路由匹配
 *   2. GET /api/sessions — 会话列表
 *   3. POST /api/sessions — 创建会话
 *   4. GET /api/sessions/:id — 会话详情
 *   5. DELETE /api/sessions/:id — 删除会话
 *   6. GET /api/sessions/:id/messages — 消息历史
 *   7. POST /api/sessions/:id/fork — 分叉会话
 *   8. GET /api/rollback-points — 分支点列表
 *   9. GET /api/rollback-points/:id — 分支点详情
 *   10. POST /api/rollback-points/:id/rollback — 执行回滚
 *   11. DELETE /api/rollback-points/:id — 删除分支点
 *   12. GET /api/openapi.json — API 契约
 */
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { API_ERROR_CODES, handleApiRequest, listApiRoutes, matchApiRoute } from "@/server/apiRoutes";
import fs from "fs/promises";
import path from "path";
import { cleanupTestDir, createGlobalTmpTestDir } from "../../helpers/testPaths";
import { createSession, getSession, addTextMessage, getSessionMessages } from "@/session";
import { defaultCompressor } from "@/compress/core/compressor";
import { type CompactionBranchPoint, saveBranchPoint } from "@/tool/rollback/branchPoints";

const TEST_DIR = path.join(process.cwd(), ".crab/branch-points");
const API_TOKEN = "p2-7-test-token";
let testDir: string;
let previousToken: string | undefined;

function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${API_TOKEN}`, "Content-Type": "application/json" };
}

function apiRequest(pathname: string, init?: RequestInit): Request {
  return new Request(`http://localhost${pathname}`, init);
}

function makeBranchPoint(sessionId: string, id = `bp-${sessionId}-api`): CompactionBranchPoint {
  return {
    afterState: {
      messages: [{ content: "[摘要]", role: "user" }],
      summary: "摘要",
    },
    beforeState: {
      messages: [
        { content: "压缩前用户消息", role: "user" },
        { content: "压缩前助手回复", role: "assistant" },
      ],
      rollbackEntries: [],
      splitIndex: 1,
    },
    compactionIndex: 0,
    id,
    metadata: {
      compressionRatio: 0.2,
      originalSessionId: sessionId,
      totalTokensAfter: 20,
      totalTokensBefore: 100,
    },
    sessionId,
    timestamp: Date.now(),
  };
}

describe("P2-7: SSE Server API 增强", () => {
  beforeEach(async () => {
    testDir = createGlobalTmpTestDir("crab-sse-api-");
    const db = require("@/db") as typeof import("@/db");
    db.resetDb();
    db.initDb(path.join(testDir, "test.db"));
    previousToken = process.env.CRAB_API_TOKEN;
    process.env.CRAB_API_TOKEN = API_TOKEN;
    try {
      await fs.rm(TEST_DIR, { force: true, recursive: true });
    } catch {}
  });

  afterEach(async () => {
    mock.restore();
    const db = require("@/db") as typeof import("@/db");
    db.closeDb();
    if (previousToken === undefined) {
      delete process.env.CRAB_API_TOKEN;
    } else {
      process.env.CRAB_API_TOKEN = previousToken;
    }
    try {
      await fs.rm(TEST_DIR, { force: true, recursive: true });
    } catch {}
    cleanupTestDir(testDir);
  });

  // ── 路由匹配测试 ──────────────────────────────────────

  test("matchApiRoute 匹配 GET /api/sessions", () => {
    const matched = matchApiRoute("GET", "/api/sessions");
    expect(matched).not.toBeNull();
    expect(matched?.handler).toBeDefined();
  });

  test("matchApiRoute 匹配 POST /api/sessions", () => {
    const matched = matchApiRoute("POST", "/api/sessions");
    expect(matched).not.toBeNull();
  });

  test("matchApiRoute 匹配 GET /api/sessions/:id", () => {
    const matched = matchApiRoute("GET", "/api/sessions/ses-123");
    expect(matched).not.toBeNull();
    expect(matched?.params["0"]).toBe("ses-123");
  });

  test("matchApiRoute 匹配 DELETE /api/sessions/:id", () => {
    const matched = matchApiRoute("DELETE", "/api/sessions/ses-456");
    expect(matched).not.toBeNull();
    expect(matched?.params["0"]).toBe("ses-456");
  });

  test("matchApiRoute 匹配 GET /api/sessions/:id/messages", () => {
    const matched = matchApiRoute("GET", "/api/sessions/ses-789/messages");
    expect(matched).not.toBeNull();
    expect(matched?.params["0"]).toBe("ses-789");
  });

  test("matchApiRoute 匹配 POST /api/sessions/:id/compress", () => {
    const matched = matchApiRoute("POST", "/api/sessions/ses-111/compress");
    expect(matched).not.toBeNull();
    expect(matched?.params["0"]).toBe("ses-111");
  });

  test("matchApiRoute 匹配 POST /api/sessions/:id/fork", () => {
    const matched = matchApiRoute("POST", "/api/sessions/ses-222/fork");
    expect(matched).not.toBeNull();
    expect(matched?.params["0"]).toBe("ses-222");
  });

  test("matchApiRoute 匹配 GET /api/rollback-points", () => {
    const matched = matchApiRoute("GET", "/api/rollback-points");
    expect(matched).not.toBeNull();
  });

  test("matchApiRoute 匹配 GET /api/openapi.json", () => {
    const matched = matchApiRoute("GET", "/api/openapi.json");
    expect(matched).not.toBeNull();
  });

  test("matchApiRoute 匹配 API 文档、Web client 和 Prometheus metrics", () => {
    expect(matchApiRoute("GET", "/api/docs")).not.toBeNull();
    expect(matchApiRoute("GET", "/api/client.js")).not.toBeNull();
    expect(matchApiRoute("GET", "/api/metrics")).not.toBeNull();
  });

  test("matchApiRoute 匹配 GET /api/rollback-points/:id", () => {
    const matched = matchApiRoute("GET", "/api/rollback-points/bp-test-0");
    expect(matched).not.toBeNull();
    expect(matched?.params["0"]).toBe("bp-test-0");
  });

  test("matchApiRoute 匹配 POST /api/rollback-points/:id/rollback", () => {
    const matched = matchApiRoute("POST", "/api/rollback-points/bp-test-0/rollback");
    expect(matched).not.toBeNull();
    expect(matched?.params["0"]).toBe("bp-test-0");
  });

  test("matchApiRoute 匹配 DELETE /api/rollback-points/:id", () => {
    const matched = matchApiRoute("DELETE", "/api/rollback-points/bp-test-0");
    expect(matched).not.toBeNull();
    expect(matched?.params["0"]).toBe("bp-test-0");
  });

  // ── listApiRoutes 包含新路由 ──────────────────────────

  test("listApiRoutes 包含新增路由", () => {
    const routes = listApiRoutes();
    // 会话 CRUD
    expect(routes.some((r) => r.pattern.includes("sessions") && r.method === "GET")).toBe(true);
    expect(routes.some((r) => r.pattern.includes("sessions") && r.method === "POST")).toBe(true);
    expect(routes.some((r) => r.pattern.includes("sessions") && r.method === "DELETE")).toBe(true);
    expect(routes.some((r) => r.pattern.includes("messages"))).toBe(true);
    expect(routes.some((r) => r.pattern.includes("compress"))).toBe(true);
    expect(routes.some((r) => r.pattern.includes("fork"))).toBe(true);
    expect(routes.some((r) => r.pattern.includes("openapi") && r.method === "GET")).toBe(true);
    expect(routes.some((r) => r.pattern.includes("docs") && r.method === "GET")).toBe(true);
    expect(routes.some((r) => r.pattern.includes("client") && r.method === "GET")).toBe(true);
    expect(routes.some((r) => r.pattern.includes("metrics") && r.method === "GET")).toBe(true);

    // 分支点
    expect(routes.some((r) => r.pattern.includes("rollback-points") && r.method === "GET")).toBe(true);
    expect(routes.some((r) => r.pattern.includes("rollback") && r.method === "POST")).toBe(true);
    expect(routes.some((r) => r.pattern.includes("rollback-points") && r.method === "DELETE")).toBe(true);
  });

  // ── 路由不冲突 ──────────────────────────────────────

  test("现有路由未被覆盖", () => {
    const routes = listApiRoutes();
    // 确认原有路由仍在(使用精确匹配避免子串误判)
    const patterns = routes.map((r) => r.pattern);
    expect(patterns.some((p) => p === String.raw`^\/api\/health$`)).toBe(true);
    expect(patterns.some((p) => p === String.raw`^\/api\/version$`)).toBe(true);
    expect(patterns.some((p) => p === String.raw`^\/api\/config$`)).toBe(true);
    expect(patterns.some((p) => p === String.raw`^\/api\/tools$`)).toBe(true);
    expect(patterns.some((p) => p === String.raw`^\/api\/ide\/status$`)).toBe(true);
    expect(patterns.length).toBeGreaterThanOrEqual(20);
  });

  // ── 行为级 API 闭环 ──────────────────────────────────

  test("GET /api/sessions 支持持久化会话分页和搜索", async () => {
    createSession({ id: "ses_alpha", model: "gpt-4.1", title: "Alpha Plan" });
    createSession({ id: "ses_beta", model: "gpt-4.1", title: "Beta Build" });

    const res = await handleApiRequest(apiRequest("/api/sessions?q=alpha&limit=1&offset=0"));
    expect(res?.status).toBe(200);
    const body = (await res!.json()) as {
      sessions: { id: string; title: string }[];
      total: number;
      limit: number;
      offset: number;
    };
    expect(body.total).toBe(1);
    expect(body.limit).toBe(1);
    expect(body.offset).toBe(0);
    expect(body.sessions[0]?.id).toBe("ses_alpha");
  });

  test("GET /api/openapi.json 返回核心 API 契约并标记写入接口鉴权", async () => {
    const res = await handleApiRequest(apiRequest("/api/openapi.json"));
    expect(res?.status).toBe(200);
    const spec = (await res!.json()) as {
      openapi: string;
      info: { title: string; version: string };
      paths: Record<string, Record<string, { security?: Record<string, string[]>[] }>>;
      components: {
        securitySchemes: Record<string, { type: string; scheme: string }>;
        schemas: Record<string, unknown>;
      };
    };

    expect(spec.openapi).toBe("3.0.3");
    expect(spec.info.title).toBe("Crab CLI API");
    expect(spec.components.securitySchemes.bearerAuth).toEqual({ scheme: "bearer", type: "http" });
    expect(spec.components.schemas.ApiError).toBeDefined();
    expect(spec.paths["/api/sessions"]?.get).toBeDefined();
    expect(spec.paths["/api/sessions"]?.post?.security).toEqual([{ bearerAuth: [] }]);
    expect(spec.paths["/api/sessions/{sessionId}/compress"]?.post?.security).toEqual([{ bearerAuth: [] }]);
    expect(spec.paths["/api/rollback-points/{branchPointId}/rollback"]?.post?.security).toEqual([{ bearerAuth: [] }]);
    expect(spec.paths["/api/docs"]?.get).toBeDefined();
    expect(spec.paths["/api/client.js"]?.get).toBeDefined();
    expect(spec.paths["/api/metrics"]?.get).toBeDefined();
  });

  test("GET /api/docs 和 /api/client.js 提供 Web UI 调用入口", async () => {
    const docsRes = await handleApiRequest(apiRequest("/api/docs"));
    expect(docsRes?.status).toBe(200);
    expect(docsRes?.headers.get("content-type")).toContain("text/html");
    const docs = await docsRes!.text();
    expect(docs).toContain("Crab CLI API");
    expect(docs).toContain("/api/openapi.json");

    const clientRes = await handleApiRequest(apiRequest("/api/client.js"));
    expect(clientRes?.status).toBe(200);
    expect(clientRes?.headers.get("content-type")).toContain("application/javascript");
    const client = await clientRes!.text();
    expect(client).toContain("class CrabApiClient");
    expect(client).toContain("rollback(branchPointId");
  });

  test("GET /api/metrics 返回 Prometheus 文本格式", async () => {
    const res = await handleApiRequest(apiRequest("/api/metrics"));
    expect(res?.status).toBe(200);
    expect(res?.headers.get("content-type")).toContain("text/plain");
    const body = await res!.text();
    expect(body).toContain("# TYPE crab_build_info gauge");
    expect(body).toContain("crab_build_info");
  });

  test("POST /api/sessions 创建持久化会话，GET detail 和 messages 可读取", async () => {
    const createdRes = await handleApiRequest(
      apiRequest("/api/sessions", {
        body: JSON.stringify({ model: "gpt-4.1", title: "API Session" }),
        headers: authHeaders(),
        method: "POST",
      }),
    );
    expect(createdRes?.status).toBe(201);
    const created = (await createdRes!.json()) as { id: string; title: string; model: string };
    expect(created.title).toBe("API Session");
    expect(getSession(created.id)?.model).toBe("gpt-4.1");

    addTextMessage(created.id, "user", "hello");
    const detailRes = await handleApiRequest(apiRequest(`/api/sessions/${created.id}`));
    expect(detailRes?.status).toBe(200);
    const detail = (await detailRes!.json()) as { id: string };
    expect(detail.id).toBe(created.id);

    const messagesRes = await handleApiRequest(apiRequest(`/api/sessions/${created.id}/messages`));
    const messagesBody = (await messagesRes!.json()) as { total: number; messages: unknown[] };
    expect(messagesBody.total).toBe(1);
    expect(messagesBody.messages).toHaveLength(1);
  });

  test("POST /api/sessions/:id/fork 会复制父会话消息", async () => {
    const parent = createSession({ id: "ses_parent", title: "Parent" });
    addTextMessage(parent.id, "user", "父会话消息");

    const res = await handleApiRequest(
      apiRequest(`/api/sessions/${parent.id}/fork`, {
        body: JSON.stringify({ title: "Forked" }),
        headers: authHeaders(),
        method: "POST",
      }),
    );

    expect(res?.status).toBe(200);
    const body = (await res!.json()) as { parentId: string; newSessionId: string; title: string };
    expect(body.parentId).toBe(parent.id);
    expect(body.title).toBe("Forked");
    expect(getSession(body.newSessionId)?.parentId).toBe(parent.id);
    expect(getSessionMessages(body.newSessionId)).toHaveLength(1);
  });

  test("POST /api/sessions/:id/compress 调用真实压缩服务并返回 checkpoint", async () => {
    const session = createSession({ id: "ses_compress", title: "Compress" });
    addTextMessage(session.id, "user", "消息1");
    addTextMessage(session.id, "assistant", "回复1");
    addTextMessage(session.id, "user", "消息2");
    addTextMessage(session.id, "assistant", "回复2");
    spyOn(defaultCompressor, "compressWithAI").mockResolvedValue({
      compressedTokens: 20,
      compressionRatio: 0.2,
      messagesRemoved: 2,
      originalTokens: 100,
      summary: "压缩摘要",
    } as any);

    const res = await handleApiRequest(
      apiRequest(`/api/sessions/${session.id}/compress`, {
        body: JSON.stringify({ mode: "compact" }),
        headers: authHeaders(),
        method: "POST",
      }),
    );

    expect(res?.status).toBe(200);
    const body = (await res!.json()) as { ok: boolean; sessionId: string; preCompressionCheckpointId?: string };
    expect(body.ok).toBe(true);
    expect(body.sessionId).toBe(session.id);
    expect(body.preCompressionCheckpointId).toMatch(/^chk_/);
  });

  test("rollback-points API 支持列表、详情、回滚和删除", async () => {
    const session = createSession({ id: "ses_rollback_api", title: "Rollback API" });
    addTextMessage(session.id, "user", "[摘要]");
    const bp = makeBranchPoint(session.id, "bp-api-test");
    await saveBranchPoint(bp);

    const listRes = await handleApiRequest(apiRequest(`/api/rollback-points?sessionId=${session.id}`));
    expect(listRes?.status).toBe(200);
    const listBody = (await listRes!.json()) as { points: { id: string }[]; total: number };
    expect(listBody.total).toBe(1);
    expect(listBody.points[0]?.id).toBe(bp.id);

    const detailRes = await handleApiRequest(apiRequest(`/api/rollback-points/${bp.id}`));
    const detail = (await detailRes!.json()) as { id: string; beforeState: { messageCount: number } };
    expect(detail.id).toBe(bp.id);
    expect(detail.beforeState.messageCount).toBe(2);

    const rollbackRes = await handleApiRequest(
      apiRequest(`/api/rollback-points/${bp.id}/rollback`, {
        body: JSON.stringify({ strategy: "replace" }),
        headers: authHeaders(),
        method: "POST",
      }),
    );
    expect(rollbackRes?.status).toBe(200);
    const rollbackBody = (await rollbackRes!.json()) as { success: boolean; targetSessionId: string };
    expect(rollbackBody.success).toBe(true);
    expect(rollbackBody.targetSessionId).toBe(session.id);
    expect(getSessionMessages(session.id)).toHaveLength(2);

    const deleteRes = await handleApiRequest(
      apiRequest(`/api/rollback-points/${bp.id}`, {
        headers: authHeaders(),
        method: "DELETE",
      }),
    );
    expect(deleteRes?.status).toBe(200);
  });

  test("POST /api/sessions 未授权时返回 401", async () => {
    const res = await handleApiRequest(
      apiRequest("/api/sessions", {
        body: JSON.stringify({ title: "No Auth" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    expect(res?.status).toBe(401);
    const body = (await res!.json()) as { error: string; code: string; message: string };
    expect(body).toEqual({
      code: API_ERROR_CODES.UNAUTHORIZED,
      error: "Unauthorized",
      message: "Unauthorized",
    });
  });

  test("错误响应包含稳定 error code 且兼容 error 字段", async () => {
    const res = await handleApiRequest(apiRequest("/api/sessions/not-exists"));
    expect(res?.status).toBe(404);
    const body = (await res!.json()) as { error: string; code: string; message: string };
    expect(body.error).toBe("会话不存在");
    expect(body.message).toBe("会话不存在");
    expect(body.code).toBe(API_ERROR_CODES.SESSION_NOT_FOUND);
  });
});
