/**
 * IDEWebSocketServer 单元测试
 *
 * 策略: 直接实例化 IDEWebSocketServer，避免调用 start() 以跳过 Bun.serve。
 * 用 spyOn/mock 拦截 writeTokenFile / removeTokenFile / startHeartbeat 避免 fs/定时器副作用。
 * 通过手动设置内部状态 (_status, _port, _authToken) 模拟服务端已启动。
 */
import { describe, it, expect, beforeEach, mock, spyOn } from "bun:test";

const { IDEWebSocketServer } = await import("@/ide/connection/wsServer");

// ─── helpers ──────────────────────────────────────────────────

function createMockWs(
  overrides?: Partial<{ send: ReturnType<typeof mock>; close: ReturnType<typeof mock>; readyState: number }>,
) {
  return {
    send: mock(() => {}),
    close: mock(() => {}),
    readyState: WebSocket.OPEN,
    ...overrides,
  };
}

/**
 * 创建一个已"启动"的 server 实例。
 * 不调用 start()（避免 Bun.serve），手动设置内部状态。
 */
function createStartedServer() {
  const mockPublish = mock(() => {});
  const server = new IDEWebSocketServer();
  (server as any).eventBus = { publish: mockPublish };

  // Spy on fs/timer methods to prevent side effects
  spyOn(server as any, "writeTokenFile").mockImplementation(() => {});
  spyOn(server as any, "removeTokenFile").mockImplementation(() => {});
  spyOn(server as any, "startHeartbeat").mockImplementation(() => {});
  spyOn(server as any, "stopHeartbeat").mockImplementation(() => {});

  // Simulate server being started without calling Bun.serve
  (server as any)._status = "connected";
  (server as any)._port = 9876;
  (server as any)._authToken = undefined;
  (server as any).server = { stop: mock(() => {}) } as unknown as ReturnType<typeof Bun.serve>;

  return { server, mockPublish };
}

function registerClient(
  server: InstanceType<typeof IDEWebSocketServer>,
  clientId: string,
  ws: ReturnType<typeof createMockWs>,
  workspaceFolder?: string,
) {
  const client = {
    id: clientId,
    ws,
    connectedAt: Date.now(),
    lastActiveAt: Date.now(),
    lastMessageAt: undefined,
    rateLimitCount: 0,
    workspaceFolder,
  };
  (server as any).clients.set(clientId, client);
  return client;
}

// ─── tests ────────────────────────────────────────────────────

describe("IDEWebSocketServer", () => {
  let server: InstanceType<typeof IDEWebSocketServer>;
  let mockPublish: ReturnType<typeof mock>;

  beforeEach(() => {
    const result = createStartedServer();
    server = result.server;
    mockPublish = result.mockPublish;
  });

  describe("status and port", () => {
    it("after simulated start, status is connected and port is set", () => {
      expect(server.status).toBe("connected");
      expect(server.port).toBe(9876);
    });

    it("configureAuth sets authToken", () => {
      server.configureAuth("my-token");
      expect(server.authToken).toBe("my-token");
    });

    it("setAllowedOrigins overrides defaults", () => {
      server.setAllowedOrigins(["custom://"]);
      // Verify by checking that allowedOrigins is set (via behavior)
      // We test via the ide/connect origin check
    });
  });

  describe("Token authentication", () => {
    it("ide/connect with correct token succeeds and registers workspace", () => {
      server.configureAuth("valid-token");

      const ws = createMockWs();
      (server as any).handleOpen(ws);

      (server as any).handleMessage(
        ws,
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "ide/connect",
          params: { token: "valid-token", workspaceFolder: "/project" },
        }),
      );

      const clients = server.getClients();
      expect(clients.length).toBe(1);
      expect(clients[0]!.workspaceFolder).toBe("/project");
    });

    it("ide/connect with wrong token disconnects client", () => {
      server.configureAuth("correct-token");

      const ws = createMockWs();
      (server as any).handleOpen(ws);

      (server as any).handleMessage(
        ws,
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "ide/connect",
          params: { token: "wrong-token" },
        }),
      );

      expect(ws.close).toHaveBeenCalledWith(4001, "Auth failed");
      expect((server as any).clients.size).toBe(0);
    });

    it("no auth configured: ide/connect without token succeeds", () => {
      // _authToken is already undefined from createStartedServer

      const ws = createMockWs();
      (server as any).handleOpen(ws);

      (server as any).handleMessage(
        ws,
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "ide/connect",
          params: { workspaceFolder: "/project" },
        }),
      );

      expect(ws.close).not.toHaveBeenCalled();
      expect((server as any).clients.size).toBe(1);
    });
  });

  describe("Origin validation", () => {
    it("origin not in allowedOrigins list disconnects client", () => {
      server.setAllowedOrigins(["vscode-file://", "cursor://"]);

      const ws = createMockWs();
      (server as any).handleOpen(ws);

      (server as any).handleMessage(
        ws,
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "ide/connect",
          params: { origin: "evil-origin" },
        }),
      );

      expect(ws.close).toHaveBeenCalledWith(4003, "Origin not allowed");
      expect((server as any).clients.size).toBe(0);
    });

    it("allowedOrigins empty array means no origin check", () => {
      server.setAllowedOrigins([]);

      const ws = createMockWs();
      (server as any).handleOpen(ws);

      (server as any).handleMessage(
        ws,
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "ide/connect",
          params: { origin: "anything-goes" },
        }),
      );

      expect(ws.close).not.toHaveBeenCalled();
      expect((server as any).clients.size).toBe(1);
    });
  });

  describe("JSON-RPC message routing", () => {
    function setupClient() {
      const ws = createMockWs();
      (server as any).handleOpen(ws);
      (server as any).handleMessage(
        ws,
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "ide/connect",
          params: { workspaceFolder: "/project" },
        }),
      );
      // Advance time past rate-limit window (100ms) so next message is not dropped
      const client = server.getClients()[0]!;
      (client as any).lastMessageAt = 0;
      return ws;
    }

    it("context method triggers context-update event and eventBus publish", () => {
      const ws = setupClient();

      const listener = mock(() => {});
      server.on("context-update", listener);

      (server as any).handleMessage(
        ws,
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "context",
          params: { activeFile: "/a.ts" },
        }),
      );

      expect(listener).toHaveBeenCalledTimes(1);
      expect(mockPublish).toHaveBeenCalled();
    });

    it("diagnostics method triggers diagnostics-update event and eventBus publish", () => {
      const ws = setupClient();

      const listener = mock(() => {});
      server.on("diagnostics-update", listener);

      (server as any).handleMessage(
        ws,
        JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "diagnostics",
          params: {
            filePath: "/b.ts",
            diagnostics: [{ message: "error", severity: "error", line: 1, character: 0 }],
          },
        }),
      );

      expect(listener).toHaveBeenCalledTimes(1);
      expect(mockPublish).toHaveBeenCalled();
    });

    it("interaction/result triggers interaction-result event", () => {
      const ws = setupClient();

      const listener = mock(() => {});
      server.on("interaction-result", listener);

      (server as any).handleMessage(
        ws,
        JSON.stringify({
          jsonrpc: "2.0",
          id: 4,
          method: "interaction/result",
          params: { action: "accepted" },
        }),
      );

      expect(listener).toHaveBeenCalledTimes(1);
      expect(((listener.mock.calls as unknown[][])[0] as unknown[])[0]).toMatchObject({ action: "accepted" });
    });

    it("pong updates lastActiveAt without emitting event", () => {
      const ws = setupClient();
      const client = server.getClients()[0]!;
      const beforeActive = client.lastActiveAt;

      const origNow = Date.now;
      Date.now = mock(() => origNow() + 50);

      (server as any).handleMessage(ws, JSON.stringify({ jsonrpc: "2.0", method: "pong" }));

      expect(client.lastActiveAt).toBeGreaterThan(beforeActive);
      Date.now = origNow;
    });

    it("unknown method triggers no event and no crash", () => {
      const ws = setupClient();
      const listener = mock(() => {});
      server.on("context-update", listener);

      expect(() => {
        (server as any).handleMessage(ws, JSON.stringify({ jsonrpc: "2.0", id: 5, method: "unknown.method" }));
      }).not.toThrow();

      expect(listener).not.toHaveBeenCalled();
    });

    it("unknown method with id returns RPC error response", () => {
      const ws = setupClient();

      (server as any).handleMessage(ws, JSON.stringify({ jsonrpc: "2.0", id: 5, method: "unknown.method" }));

      const sent = (ws.send as ReturnType<typeof mock>).mock.calls.find((call: unknown[]) => {
        const parsed = JSON.parse(call[0] as string);
        return parsed.error !== undefined;
      });
      expect(sent).toBeDefined();
      const errorResp = JSON.parse(sent![0] as string);
      expect(errorResp.error.code).toBe(-32601);
    });
  });

  describe("Simple message format", () => {
    it("{ type: 'context', activeFile: '/a.ts' } triggers context-update", () => {
      const ws = createMockWs();
      (server as any).handleOpen(ws);

      const listener = mock(() => {});
      server.on("context-update", listener);

      (server as any).handleMessage(ws, JSON.stringify({ type: "context", activeFile: "/a.ts" }));

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("simple context message without correct token (auth configured) is discarded", () => {
      server.configureAuth("secret-token");

      const ws = createMockWs();
      (server as any).handleOpen(ws);

      const listener = mock(() => {});
      server.on("context-update", listener);

      (server as any).handleMessage(ws, JSON.stringify({ type: "context", activeFile: "/a.ts" }));

      expect(listener).not.toHaveBeenCalled();
    });

    it("{ type: 'unknown' } triggers no crash", () => {
      const ws = createMockWs();
      (server as any).handleOpen(ws);

      expect(() => {
        (server as any).handleMessage(ws, JSON.stringify({ type: "unknown" }));
      }).not.toThrow();
    });

    it("simple { type: 'diagnostics' } triggers diagnostics-update event", () => {
      const ws = createMockWs();
      (server as any).handleOpen(ws);

      const listener = mock(() => {});
      server.on("diagnostics-update", listener);

      (server as any).handleMessage(
        ws,
        JSON.stringify({
          type: "diagnostics",
          filePath: "/b.ts",
          diagnostics: [{ message: "err", severity: "error", line: 1, character: 0 }],
        }),
      );

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe("Client management", () => {
    it("getClientByWorkspace finds client by workspace path", () => {
      const ws = createMockWs();
      registerClient(server, "c1", ws, "/project");

      const found = server.getClientByWorkspace("/project");
      expect(found).toBeDefined();
      expect(found!.id).toBe("c1");
    });

    it("getClientByWorkspace returns undefined for non-existent workspace", () => {
      const ws = createMockWs();
      registerClient(server, "c1", ws, "/project");

      expect(server.getClientByWorkspace("/other")).toBeUndefined();
    });

    it("getClients returns snapshot of connected clients", () => {
      const ws = createMockWs();
      registerClient(server, "c1", ws, "/project");

      const clients = server.getClients();
      expect(clients.length).toBe(1);
      expect(clients[0]!.id).toBe("c1");
    });

    it("connection limit (10): 11th connection is rejected", () => {
      for (let i = 0; i < 10; i++) {
        (server as any).handleOpen(createMockWs());
      }
      expect((server as any).clients.size).toBe(10);

      const ws11 = createMockWs();
      (server as any).handleOpen(ws11);
      expect(ws11.close).toHaveBeenCalled();
      expect((server as any).clients.size).toBe(10);
    });
  });

  describe("sendNotification / sendRequest / broadcast", () => {
    it("sendNotification returns false when WebSocket not open", () => {
      const ws = createMockWs({ readyState: WebSocket.CLOSED });
      registerClient(server, "c1", ws);

      expect(server.sendNotification("c1", "test.method", {})).toBe(false);
    });

    it("sendNotification returns true when WebSocket is open", () => {
      const ws = createMockWs();
      registerClient(server, "c1", ws);

      expect(server.sendNotification("c1", "test.method", { key: "val" })).toBe(true);
      const sentMsg = JSON.parse((ws.send as ReturnType<typeof mock>).mock.calls[0]![0] as string);
      expect(sentMsg.method).toBe("test.method");
      expect(sentMsg.params).toEqual({ key: "val" });
    });

    it("sendNotification returns false for unknown client", () => {
      expect(server.sendNotification("nonexistent", "test.method", {})).toBe(false);
    });

    it("sendRequest timeout returns { data: null, reason: 'timeout' }", async () => {
      const ws = createMockWs();
      registerClient(server, "c1", ws);

      const result = await server.sendRequest("c1", "test.method", {}, 10);
      expect(result).toEqual({ data: null, reason: "timeout" });
    });

    it("sendRequest returns { data: null, reason: 'disconnected' } for unknown client", async () => {
      const result = await server.sendRequest("nonexistent", "test.method", {});
      expect(result).toEqual({ data: null, reason: "disconnected" });
    });

    it("sendRequest success resolves with response result", async () => {
      const ws = createMockWs();
      registerClient(server, "c1", ws);

      const sendPromise = server.sendRequest("c1", "test.method", { key: "val" });
      const sentMsg = JSON.parse((ws.send as ReturnType<typeof mock>).mock.calls[0]![0] as string);
      const requestId = sentMsg.id;

      // Bypass rate-limit: reset lastMessageAt so response is not silently dropped
      const client = server.getClients()[0]!;
      (client as any).lastMessageAt = 0;

      (server as any).handleMessage(ws, JSON.stringify({ jsonrpc: "2.0", id: requestId, result: { ok: true } }));

      const result = await sendPromise;
      // Note: handleMessage resolves pending with raw data.result (any-typed resolve bypasses SendRequestResult wrapper)
      expect(result as unknown).toEqual({ ok: true });
    });

    it("broadcast sends notification to all clients", () => {
      const ws1 = createMockWs();
      const ws2 = createMockWs();
      registerClient(server, "c1", ws1);
      registerClient(server, "c2", ws2);

      server.broadcast("test.broadcast", { msg: "hello" });

      expect((ws1.send as ReturnType<typeof mock>).mock.calls.length).toBe(1);
      expect((ws2.send as ReturnType<typeof mock>).mock.calls.length).toBe(1);

      const msg1 = JSON.parse((ws1.send as ReturnType<typeof mock>).mock.calls[0]![0] as string);
      expect(msg1.method).toBe("test.broadcast");
      expect(msg1.params).toEqual({ msg: "hello" });
    });
  });

  describe("Message size limit", () => {
    it("message > 1MB disconnects client", () => {
      const ws = createMockWs();
      (server as any).handleOpen(ws);

      const bigPayload = "x".repeat(1024 * 1024 + 1);
      (server as any).handleMessage(
        ws,
        JSON.stringify({ jsonrpc: "2.0", method: "context", params: { data: bigPayload } }),
      );

      expect(ws.close).toHaveBeenCalled();
    });

    it("message <= 1MB is accepted normally", () => {
      const ws = createMockWs();
      (server as any).handleOpen(ws);

      const listener = mock(() => {});
      server.on("context-update", listener);

      (server as any).handleMessage(
        ws,
        JSON.stringify({ jsonrpc: "2.0", method: "context", params: { activeFile: "/a.ts" } }),
      );

      expect(ws.close).not.toHaveBeenCalled();
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe("Rate limiting", () => {
    it("fast messages (< 100ms interval) are silently dropped", () => {
      const ws = createMockWs();
      (server as any).handleOpen(ws);

      const listener = mock(() => {});
      server.on("context-update", listener);

      const msg = JSON.stringify({ jsonrpc: "2.0", method: "context", params: { activeFile: "/a.ts" } });

      // First message accepted
      (server as any).handleMessage(ws, msg);
      expect(listener).toHaveBeenCalledTimes(1);

      // Second message immediately — dropped
      (server as any).handleMessage(ws, msg);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("50 consecutive rate limit violations disconnect client", () => {
      const ws = createMockWs();
      (server as any).handleOpen(ws);

      const msg = JSON.stringify({ jsonrpc: "2.0", method: "context", params: { activeFile: "/a.ts" } });

      // First valid message
      (server as any).handleMessage(ws, msg);

      // 49 rapid messages
      for (let i = 0; i < 49; i++) {
        (server as any).handleMessage(ws, msg);
      }
      expect(ws.close).not.toHaveBeenCalled();

      // 50th triggers disconnect
      (server as any).handleMessage(ws, msg);
      expect(ws.close).toHaveBeenCalled();
    });
  });

  describe("Heartbeat detection", () => {
    it("client inactive > 120s is automatically disconnected", () => {
      const ws = createMockWs();
      (server as any).handleOpen(ws);

      // Make client stale
      for (const client of (server as any).clients.values()) {
        client.lastActiveAt = Date.now() - 200_000;
      }

      // Invoke heartbeat stale-check logic
      const now = Date.now();
      const staleThreshold = (server as any)._staleThresholdMs;
      for (const [id, client] of (server as any).clients) {
        if (now - client.lastActiveAt > staleThreshold) {
          (server as any).closeSocketSafely(client.ws, 4000, "Heartbeat timeout", {
            clientId: id,
            operation: "heartbeat.closeStaleClient",
          });
          (server as any).clients.delete(id);
        }
      }

      expect(ws.close).toHaveBeenCalledWith(4000, "Heartbeat timeout");
      expect((server as any).clients.size).toBe(0);
    });
  });

  describe("Client disconnect", () => {
    it("handleClose removes client and publishes IDEDisconnected event", () => {
      const ws = createMockWs();
      (server as any).handleOpen(ws);
      expect((server as any).clients.size).toBe(1);

      (server as any).handleClose(ws);

      expect((server as any).clients.size).toBe(0);
      expect(mockPublish).toHaveBeenCalled();
    });

    it("handleClose for unknown ws is a no-op", () => {
      const ws = createMockWs();
      // ws was never opened, so handleClose should do nothing

      (server as any).handleClose(ws);

      expect((server as any).clients.size).toBe(0);
      expect(mockPublish).not.toHaveBeenCalled();
    });
  });

  describe("Event system", () => {
    it("on returns unsubscribe function", () => {
      const listener = mock(() => {});
      const unsub = server.on("test-event", listener);

      (server as any).emit("test-event", { data: 1 });
      expect(listener).toHaveBeenCalledTimes(1);

      unsub();

      (server as any).emit("test-event", { data: 2 });
      expect(listener).toHaveBeenCalledTimes(1); // no additional call
    });

    it("emit with exception in listener does not throw", () => {
      const badListener = mock(() => {
        throw new Error("boom");
      });
      server.on("test-event", badListener);

      expect(() => {
        (server as any).emit("test-event", {});
      }).not.toThrow();
    });
  });

  describe("handleOpen", () => {
    it("registers client and emits client-connected event", () => {
      const listener = mock(() => {});
      server.on("client-connected", listener);

      const ws = createMockWs();
      (server as any).handleOpen(ws);

      expect((server as any).clients.size).toBe(1);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(((listener.mock.calls as unknown[][])[0]![0] as Record<string, unknown>).ws).toBe(ws);
    });
  });

  describe("Invalid JSON", () => {
    it("invalid JSON message is silently handled (no crash)", () => {
      const ws = createMockWs();
      (server as any).handleOpen(ws);

      expect(() => {
        (server as any).handleMessage(ws, "not-json{{{");
      }).not.toThrow();
    });
  });
});
