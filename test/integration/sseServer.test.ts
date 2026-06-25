/**
 * SSE 服务集成测试。
 *
 * 测试目标:
 *   - 验证 SSE 服务在多组件(globalBus / AppEvent / 业务模块)下的集成
 *
 * 测试用例:
 *   - 事件通过 SSE 正常推送
 *   - 连接生命周期与错误处理
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { globalBus } from "@/bus/core/eventBus";
import { AppEvent } from "@/bus/events";
import {
  SSE_MESSAGE_BODY_LIMIT_BYTES,
  __resetSseServerDepsForTesting,
  __setSseServerDepsForTesting,
  startSseServer,
} from "@/server/sseServer";
import { DEFAULT_CONFIG } from "@/config/loader/config";

function mockBaseModules() {
  __setSseServerDepsForTesting({
    ensureMcpRuntimeStarted: async () => ({}) as any,
    initTaskRuntime: () => {},
  });
}

async function bootSseServer(_query: string) {
  let servedOptions: any;
  const originalServe = Bun.serve;
  Bun.serve = ((options: any) => {
    servedOptions = options;
    return { stop: () => {} };
  }) as typeof Bun.serve;

  try {
    await startSseServer({ allowLocalWithoutToken: true, daemon: true, host: "127.0.0.1", port: 4321 });
  } finally {
    Bun.serve = originalServe;
  }

  return servedOptions;
}

async function bootSseServerRequiringAuth() {
  let servedOptions: any;
  const originalServe = Bun.serve;
  Bun.serve = ((options: any) => {
    servedOptions = options;
    return { stop: () => {} };
  }) as typeof Bun.serve;

  try {
    await startSseServer({ daemon: true, host: "127.0.0.1", port: 4321 });
  } finally {
    Bun.serve = originalServe;
  }

  return servedOptions;
}

async function collectSseOutput(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  stopWhen: (text: string) => boolean,
  timeoutMs: number = 150,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";

  const readLoop = (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      text += decoder.decode(value);
      if (stopWhen(text)) {
        break;
      }
    }
  })();

  await Promise.race([readLoop, Bun.sleep(timeoutMs)]);
  await reader.cancel();
  return text;
}

function countEvents(text: string, eventName: string): number {
  return text.split(`event: ${eventName}`).length - 1;
}

describe("SSE 服务器", () => {
  beforeEach(() => {
    __resetSseServerDepsForTesting();
    globalBus.clearHistory();
  });

  afterEach(() => {
    __resetSseServerDepsForTesting();
  });

  test("启动时注册路由并暴露 health / sessions / message / SignalR negotiate", async () => {
    mockBaseModules();
    const servedOptions = await bootSseServer("sse-routes");

    expect(servedOptions.port).toBe(4321);
    expect(servedOptions.hostname).toBe("127.0.0.1");
    expect(servedOptions.idleTimeout).toBe(0);
    expect(servedOptions.routes["/api/health"]).toBeDefined();
    expect(servedOptions.routes["/api/sessions"]).toBeDefined();
    expect(servedOptions.routes["/api/message"]).toBeDefined();
    expect(servedOptions.routes["/collaborationHub/negotiate"]).toBeDefined();

    const healthResp = servedOptions.routes["/api/health"].GET();
    const healthBody = await healthResp.json();
    expect(healthBody.status).toBe("ok");
    expect(healthBody.clients).toBe(0);

    const sessionsResp = await servedOptions.routes["/api/sessions"].GET();
    const sessionsBody = await sessionsResp.json();
    expect(sessionsBody.sessions).toEqual([]);
  });

  test("POST /collaborationHub/negotiate 返回 SignalR WebSockets transport", async () => {
    mockBaseModules();
    const servedOptions = await bootSseServer("signalr-negotiate");
    const req = new Request(
      "http://localhost/collaborationHub/negotiate?negotiateVersion=1&sessionId=ses_a&sessions=ses_b,ses_c",
      {
        headers: { origin: "http://localhost:3000" },
        method: "POST",
      },
    );

    const resp = await servedOptions.routes["/collaborationHub/negotiate"].POST(req);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.connectionId).toStartWith("con_");
    expect(body.connectionToken).toStartWith("con_");
    expect(body.negotiateVersion).toBe(1);
    expect(body.sessionScope).toEqual(["ses_a", "ses_b", "ses_c"]);
    expect(body.availableTransports).toEqual([{ transferFormats: ["Text"], transport: "WebSockets" }]);
  });

  test("POST /collaborationHub/negotiate 校验 origin 和 auth", async () => {
    const originalToken = process.env.CRAB_API_TOKEN;
    process.env.CRAB_API_TOKEN = "signalr-token";
    try {
      mockBaseModules();
      const servedOptions = await bootSseServer("signalr-negotiate-auth");
      const noAuth = new Request("http://localhost/collaborationHub/negotiate", {
        headers: { origin: "http://localhost:3000" },
        method: "POST",
      });
      const badOrigin = new Request("http://localhost/collaborationHub/negotiate", {
        headers: { authorization: "Bearer signalr-token", origin: "https://evil.example" },
        method: "POST",
      });
      const queryToken = new Request("http://localhost/collaborationHub/negotiate?access_token=signalr-token", {
        headers: { origin: "http://localhost:3000" },
        method: "POST",
      });

      expect((await servedOptions.routes["/collaborationHub/negotiate"].POST(noAuth)).status).toBe(401);
      expect((await servedOptions.routes["/collaborationHub/negotiate"].POST(badOrigin)).status).toBe(403);
      expect((await servedOptions.routes["/collaborationHub/negotiate"].POST(queryToken)).status).toBe(200);
    } finally {
      if (originalToken === undefined) {
        delete process.env.CRAB_API_TOKEN;
      } else {
        process.env.CRAB_API_TOKEN = originalToken;
      }
    }
  });

  test("POST /api/message 缺少 message 时返回 400", async () => {
    mockBaseModules();
    const servedOptions = await bootSseServer("sse-post");

    const req = new Request("http://localhost/api/message", {
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const resp = await servedOptions.routes["/api/message"].POST(req);
    expect(resp.status).toBe(400);
  });

  test("POST /api/message JSON 无效时返回稳定错误码", async () => {
    mockBaseModules();
    const servedOptions = await bootSseServer("sse-bad-json");

    const req = new Request("http://localhost/api/message", {
      body: "{bad json",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const resp = await servedOptions.routes["/api/message"].POST(req);
    const body = await resp.json();

    expect(resp.status).toBe(400);
    expect(body).toEqual({ error: "无效输入", errorCode: "USER-200" });
  });

  test("POST /api/message 请求体超过上限时返回 413", async () => {
    mockBaseModules();
    const servedOptions = await bootSseServer("sse-body-limit");

    const req = new Request("http://localhost/api/message", {
      body: JSON.stringify({ message: "hello" }),
      headers: {
        "Content-Length": String(SSE_MESSAGE_BODY_LIMIT_BYTES + 1),
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const resp = await servedOptions.routes["/api/message"].POST(req);
    const body = await resp.json();

    expect(resp.status).toBe(413);
    expect(body).toEqual({
      error: "请求体过大",
      maxBytes: SSE_MESSAGE_BODY_LIMIT_BYTES,
    });
  });

  test("POST /api/message 默认无 token 时返回 401", async () => {
    const originalToken = process.env.CRAB_API_TOKEN;
    delete process.env.CRAB_API_TOKEN;
    try {
      mockBaseModules();
      const servedOptions = await bootSseServerRequiringAuth();
      const req = new Request("http://localhost/api/message", {
        body: JSON.stringify({ message: "hello" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const resp = await servedOptions.routes["/api/message"].POST(req);
      expect(resp.status).toBe(401);
    } finally {
      if (originalToken === undefined) {
        delete process.env.CRAB_API_TOKEN;
      } else {
        process.env.CRAB_API_TOKEN = originalToken;
      }
    }
  });

  test("/sse 连接返回 connected 事件头", async () => {
    mockBaseModules();
    const servedOptions = await bootSseServer("sse-connect");

    const resp = servedOptions.routes["/sse"](new Request("http://localhost/sse"));
    expect(resp.headers.get("Content-Type")).toBe("text/event-stream");

    const reader = resp.body!.getReader();
    const { value, done } = await reader.read();
    expect(done).toBe(false);
    const text = new TextDecoder().decode(value);
    expect(text).toContain("event: connected");
    expect(text).toContain("clientId");
    await reader.cancel();
  });

  test("POST /api/message 未提供 sessionId 时返回新 sessionId 并传给 handler", async () => {
    mockBaseModules();

    const seenSessionIds: (string | undefined)[] = [];
    class MockConversationHandler {
      constructor(_config: unknown, options?: { sessionId?: string }) {
        seenSessionIds.push(options?.sessionId);
      }

      async sendMessage() {
        return { ok: true, text: "ok", toolRounds: 0 };
      }

      destroy() {}
    }

    __setSseServerDepsForTesting({
      ConversationHandler: MockConversationHandler,
      loadConfig: async () => DEFAULT_CONFIG,
    });

    const servedOptions = await bootSseServer("sse-auto-session");
    const req = new Request("http://localhost/api/message", {
      body: JSON.stringify({ message: "hello" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const resp = await servedOptions.routes["/api/message"].POST(req);
    const body = await resp.json();

    expect(resp.status).toBe(200);
    expect(typeof body.sessionId).toBe("string");
    expect(body.sessionId.length).toBeGreaterThan(0);
    expect(seenSessionIds).toEqual([body.sessionId]);
  });

  test("POST /api/message 复用 sessionId 时注入历史 initialMessages", async () => {
    mockBaseModules();

    const handlerOptions: any[] = [];
    class MockConversationHandler {
      constructor(_config: unknown, options?: unknown) {
        handlerOptions.push(options);
      }

      async sendMessage() {
        return { ok: true, text: "ok", toolRounds: 0 };
      }

      destroy() {}
    }

    __setSseServerDepsForTesting({
      ConversationHandler: MockConversationHandler,
      getSessionMessages: (sessionId: string) =>
        [
          {
            createdAt: 1,
            id: "msg-sse-1",
            parts: [{ content: "历史 SSE 用户消息", type: "text" }],
            role: "user",
            sessionId,
          },
          {
            createdAt: 2,
            id: "msg-sse-2",
            parts: [{ content: "历史 SSE 助手回复", type: "text" }],
            role: "assistant",
            sessionId,
          },
        ] as any,
      loadConfig: async () => DEFAULT_CONFIG,
    });

    const servedOptions = await bootSseServer("sse-initial-messages");
    const req = new Request("http://localhost/api/message", {
      body: JSON.stringify({ message: "继续", sessionId: "ses_sse_resume" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const resp = await servedOptions.routes["/api/message"].POST(req);

    expect(resp.status).toBe(200);
    expect(handlerOptions[0]).toMatchObject({
      initialMessages: [
        { content: "历史 SSE 用户消息", role: "user" },
        { content: "历史 SSE 助手回复", role: "assistant" },
      ],
      sessionId: "ses_sse_resume",
    });
  });

  test("并发消息只广播各自会话事件一次", async () => {
    mockBaseModules();

    let started = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });

    class MockConversationHandler {
      private sessionId?: string;

      constructor(_config: unknown, options?: { sessionId?: string }) {
        this.sessionId = options?.sessionId;
      }

      async sendMessage() {
        started += 1;
        if (started === 1) {
          await barrier;
        } else {
          release();
        }

        const sessionId = this.sessionId ?? "missing-session";
        globalBus.publish(
          AppEvent.ConversationStreamToken,
          {
            content: `tok-${sessionId}`,
            sessionId,
            tokenCount: 1,
          },
          { throttle: false },
        );
        globalBus.publish(AppEvent.ConversationToolCall, {
          args: { sessionId },
          callId: `call-${sessionId}`,
          sessionId,
          tool: `tool-${sessionId}`,
        });
        globalBus.publish(
          AppEvent.ToolResult,
          {
            callId: `call-${sessionId}`,
            result: `result-${sessionId}`,
            sessionId,
            success: true,
            tool: `tool-${sessionId}`,
          } as any,
          { throttle: false },
        );

        return { ok: true, text: `done-${sessionId}`, toolRounds: 0 };
      }

      destroy() {}
    }

    __setSseServerDepsForTesting({
      ConversationHandler: MockConversationHandler,
      loadConfig: async () => DEFAULT_CONFIG,
    });

    const servedOptions = await bootSseServer("sse-concurrent-broadcast");
    const sseResp = servedOptions.routes["/sse"](new Request("http://localhost/sse"));
    const reader = sseResp.body!.getReader();
    await reader.read();

    const reqA = new Request("http://localhost/api/message", {
      body: JSON.stringify({ message: "first", sessionId: "ses_a" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const reqB = new Request("http://localhost/api/message", {
      body: JSON.stringify({ message: "second", sessionId: "ses_b" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    const respA = await servedOptions.routes["/api/message"].POST(reqA);
    const respB = await servedOptions.routes["/api/message"].POST(reqB);
    expect(respA.status).toBe(200);
    expect(respB.status).toBe(200);

    await globalBus.flush();
    const text = await collectSseOutput(reader, (chunk) => countEvents(chunk, "done") >= 2);

    expect(countEvents(text, "token")).toBe(2);
    expect(text).toContain("tok-ses_a");
    expect(text).toContain("tok-ses_b");
    expect(countEvents(text, "toolCall")).toBe(2);
    expect(text).toContain('"toolCallId":"call-ses_a"');
    expect(text).toContain('"toolCallId":"call-ses_b"');
    expect(countEvents(text, "toolResult")).toBe(2);
    expect(text).toContain('"success":true');
    expect(countEvents(text, "done")).toBe(2);
    expect(text).toContain('"messageId":"msg_');
  });

  test("handler 失败时广播结构化 error 事件", async () => {
    mockBaseModules();

    class FailingConversationHandler {
      async sendMessage(): Promise<never> {
        throw new Error("sse failed");
      }

      destroy() {}
    }

    __setSseServerDepsForTesting({
      ConversationHandler: FailingConversationHandler,
      loadConfig: async () => DEFAULT_CONFIG,
    });

    const servedOptions = await bootSseServer("sse-error-event");
    const sseResp = servedOptions.routes["/sse"](new Request("http://localhost/sse"));
    const reader = sseResp.body!.getReader();
    await reader.read();

    const req = new Request("http://localhost/api/message", {
      body: JSON.stringify({ message: "fail", sessionId: "ses_error" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const resp = await servedOptions.routes["/api/message"].POST(req);
    expect(resp.status).toBe(200);

    await globalBus.flush();
    const text = await collectSseOutput(reader, (chunk) => chunk.includes("event: error"));

    expect(text).toContain("sse failed");
    expect(text).toContain('"errorCode":"INTERNAL-904"');
  });

  test("session handler 缓存达到上限后淘汰最旧会话", async () => {
    mockBaseModules();

    const createdSessions: string[] = [];
    const destroyedSessions: string[] = [];

    class MockConversationHandler {
      private sessionId?: string;

      constructor(_config: unknown, options?: { sessionId?: string }) {
        this.sessionId = options?.sessionId;
        createdSessions.push(options?.sessionId ?? "missing-session");
      }

      async sendMessage() {
        return { ok: true, text: "ok", toolRounds: 0 };
      }

      destroy() {
        destroyedSessions.push(this.sessionId ?? "missing-session");
      }
    }

    __setSseServerDepsForTesting({
      ConversationHandler: MockConversationHandler,
      loadConfig: async () => DEFAULT_CONFIG,
    });

    const servedOptions = await bootSseServer("sse-session-cache");

    for (let i = 0; i < 51; i += 1) {
      const req = new Request("http://localhost/api/message", {
        body: JSON.stringify({ message: `msg-${i}`, sessionId: `ses_${i}` }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const resp = await servedOptions.routes["/api/message"].POST(req);
      expect(resp.status).toBe(200);
    }

    const reusedReq = new Request("http://localhost/api/message", {
      body: JSON.stringify({ message: "reuse", sessionId: "ses_0" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const reusedResp = await servedOptions.routes["/api/message"].POST(reusedReq);
    expect(reusedResp.status).toBe(200);

    expect(createdSessions.filter((sessionId) => sessionId === "ses_0")).toHaveLength(2);
    expect(destroyedSessions).toContain("ses_0");
  });
});
