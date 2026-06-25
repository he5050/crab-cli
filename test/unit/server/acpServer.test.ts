/**
 * ACP 服务器测试。
 *
 * 测试目标:
 *   - 验证 startAcpServer 初始化与事件流
 *   - 验证依赖注入(MCP 运行时、handler)正确连接
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { globalBus } from "@/bus";
import { AppEvent } from "@/bus";
import { __resetAcpServerDepsForTesting, __setAcpServerDepsForTesting, startAcpServer } from "@/server/acpServer";
import { DEFAULT_CONFIG } from "@/config";

const DEFAULT_TEST_CONFIG = {
  ...DEFAULT_CONFIG,
  defaultProvider: { model: "m1", provider: "test" },
  providerConfig: { test: { apiKey: "x", requestMethod: "chat" as const } },
};

class EchoConversationHandler {
  async sendMessage(message: string) {
    return { ok: true, text: `echo:${message}` };
  }
}

function setBaseAcpDeps(overrides: Parameters<typeof __setAcpServerDepsForTesting>[0] = {}) {
  __setAcpServerDepsForTesting({
    ConversationHandler: EchoConversationHandler as any,
    ensureMcpRuntimeStarted: async () => ({}) as any,
    loadConfig: async () => DEFAULT_TEST_CONFIG,
    ...overrides,
  });
}

async function bootAcpServer(options: Parameters<typeof startAcpServer>[0] = {}) {
  let servedOptions: any;
  const originalServe = Bun.serve;
  Bun.serve = ((serverOptions: any) => {
    servedOptions = serverOptions;
    return { stop: () => {} };
  }) as typeof Bun.serve;

  try {
    await startAcpServer({ allowLocalWithoutToken: true, ...options });
  } finally {
    Bun.serve = originalServe;
  }

  return servedOptions;
}

async function bootAcpServerRequiringAuth(options: Parameters<typeof startAcpServer>[0] = {}) {
  let servedOptions: any;
  const originalServe = Bun.serve;
  Bun.serve = ((serverOptions: any) => {
    servedOptions = serverOptions;
    return { stop: () => {} };
  }) as typeof Bun.serve;

  try {
    await startAcpServer(options);
  } finally {
    Bun.serve = originalServe;
  }

  return servedOptions;
}

describe("ACP 服务器", () => {
  beforeEach(() => {
    __resetAcpServerDepsForTesting();
    globalBus.clearHistory();
  });

  afterEach(() => {
    __resetAcpServerDepsForTesting();
  });

  test("启动后注册 health/tools/sessions 路由", async () => {
    setBaseAcpDeps();
    const servedOptions = await bootAcpServer({ host: "127.0.0.1", port: 9001 });

    expect(servedOptions.port).toBe(9001);
    expect(servedOptions.hostname).toBe("127.0.0.1");
    expect(servedOptions.routes["/acp/health"]).toBeDefined();
    expect(servedOptions.routes["/acp/tools"]).toBeDefined();
    expect(servedOptions.routes["/acp/sessions"]).toBeDefined();

    const health = await servedOptions.routes["/acp/health"].GET().json();
    expect(health.status).toBe("ok");

    const tools = await servedOptions.routes["/acp/tools"].GET().json();
    expect(Array.isArray(tools.tools)).toBe(true);
    expect(tools.tools.some((tool: { name: string }) => tool.name === "bash")).toBe(true);
  });

  test("会话创建、查询、关闭的 fetch 路径正确", async () => {
    setBaseAcpDeps();
    const servedOptions = await bootAcpServer();

    const createResp = await servedOptions.routes["/acp/sessions"].POST(
      new Request("http://localhost/acp/sessions", { method: "POST" }),
    );
    expect(createResp.status).toBe(201);
    const created = await createResp.json();
    expect(created.status).toBe("active");

    const listResp = await servedOptions.routes["/acp/sessions"].GET();
    const listBody = await listResp.json();
    expect(listBody.sessions.length).toBe(1);

    const getResp = await servedOptions.fetch(
      new Request(`http://localhost/acp/sessions/${created.id}`, { method: "GET" }),
    );
    expect(getResp.status).toBe(200);

    const msgResp = await servedOptions.fetch(
      new Request(`http://localhost/acp/sessions/${created.id}/msg`, {
        body: JSON.stringify({ message: "hi" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    const msgBody = await msgResp.json();
    expect(msgBody.result).toContain("echo:hi");

    const closeResp = await servedOptions.fetch(
      new Request(`http://localhost/acp/sessions/${created.id}`, { method: "DELETE" }),
    );
    expect(closeResp.status).toBe(200);

    const missingResp = await servedOptions.fetch(
      new Request(`http://localhost/acp/sessions/${created.id}`, { method: "GET" }),
    );
    expect(missingResp.status).toBe(404);
  });

  test("无效 message 请求返回 400", async () => {
    setBaseAcpDeps({
      ConversationHandler: class {
        async sendMessage() {
          return { ok: true, text: "ok" };
        }
      } as any,
    });
    const servedOptions = await bootAcpServer();

    const createResp = await servedOptions.routes["/acp/sessions"].POST(
      new Request("http://localhost/acp/sessions", { method: "POST" }),
    );
    const created = await createResp.json();

    const invalidResp = await servedOptions.fetch(
      new Request(`http://localhost/acp/sessions/${created.id}/msg`, {
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    expect(invalidResp.status).toBe(400);
  });

  test("创建会话默认无 token 时返回 401", async () => {
    const originalToken = process.env.CRAB_API_TOKEN;
    delete process.env.CRAB_API_TOKEN;
    try {
      setBaseAcpDeps();
      const servedOptions = await bootAcpServerRequiringAuth();
      const createResp = await servedOptions.routes["/acp/sessions"].POST(
        new Request("http://localhost/acp/sessions", { method: "POST" }),
      );
      expect(createResp.status).toBe(401);
    } finally {
      if (originalToken === undefined) {
        delete process.env.CRAB_API_TOKEN;
      } else {
        process.env.CRAB_API_TOKEN = originalToken;
      }
    }
  });

  test("创建会话要求 bearer token 精确匹配", async () => {
    const originalToken = process.env.CRAB_API_TOKEN;
    process.env.CRAB_API_TOKEN = "acp-token-1234567890";
    try {
      setBaseAcpDeps();
      const servedOptions = await bootAcpServerRequiringAuth();

      const missingResp = await servedOptions.routes["/acp/sessions"].POST(
        new Request("http://localhost/acp/sessions", { method: "POST" }),
      );
      const wrongResp = await servedOptions.routes["/acp/sessions"].POST(
        new Request("http://localhost/acp/sessions", {
          headers: { authorization: "Bearer acp-token-1234567890x" },
          method: "POST",
        }),
      );
      const okResp = await servedOptions.routes["/acp/sessions"].POST(
        new Request("http://localhost/acp/sessions", {
          headers: { authorization: "Bearer acp-token-1234567890" },
          method: "POST",
        }),
      );

      expect(missingResp.status).toBe(401);
      expect(wrongResp.status).toBe(401);
      expect(okResp.status).toBe(201);
    } finally {
      if (originalToken === undefined) {
        delete process.env.CRAB_API_TOKEN;
      } else {
        process.env.CRAB_API_TOKEN = originalToken;
      }
    }
  });

  test("HTTP API 提供 ping/load 并在 msg 响应中返回 runtime updates", async () => {
    setBaseAcpDeps({
      ConversationHandler: class {
        private sessionId?: string;

        constructor(_config: unknown, options?: { sessionId?: string }) {
          this.sessionId = options?.sessionId;
        }

        async sendMessage(message: string) {
          globalBus.publish(AppEvent.ConversationToolCall, {
            args: { path: "README.md" },
            callId: "http-call-1",
            sessionId: this.sessionId,
            tool: "filesystem-read",
          });
          globalBus.publish(
            AppEvent.ToolResult,
            {
              callId: "http-call-1",
              result: `read:${message}`,
              sessionId: this.sessionId,
              success: true,
              tool: "filesystem-read",
            },
            { throttle: false },
          );
          return { ok: true, text: `echo:${message}` };
        }
      } as any,
    });

    const servedOptions = await bootAcpServer();

    const pingResp = await servedOptions.fetch(new Request("http://localhost/acp/ping", { method: "GET" }));
    expect(await pingResp.json()).toEqual({ ok: true, version: expect.any(String) });

    const createResp = await servedOptions.routes["/acp/sessions"].POST(
      new Request("http://localhost/acp/sessions", { method: "POST" }),
    );
    const created = await createResp.json();

    const loadResp = await servedOptions.fetch(
      new Request(`http://localhost/acp/sessions/${created.id}/load`, { method: "POST" }),
    );
    expect(await loadResp.json()).toMatchObject({
      id: created.id,
      status: "active",
      updates: [{ sessionUpdate: "session_info_update", updatedAt: expect.any(String) }],
    });

    const msgResp = await servedOptions.fetch(
      new Request(`http://localhost/acp/sessions/${created.id}/msg`, {
        body: JSON.stringify({ message: "hi" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    const msgBody = await msgResp.json();
    expect(msgBody.result).toContain("echo:hi");
    expect(msgBody.updates).toContainEqual({
      rawInput: { path: "README.md" },
      sessionUpdate: "tool_call_update",
      status: "in_progress",
      title: "filesystem-read",
      toolCallId: "http-call-1",
    });
    expect(msgBody.updates).toContainEqual({
      rawOutput: "read:hi",
      sessionUpdate: "tool_call_update",
      status: "completed",
      title: "filesystem-read",
      toolCallId: "http-call-1",
    });
  });
});
