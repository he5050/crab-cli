/**
 * VSCodeConnection 单元测试
 *
 * 策略:
 * - 使用 connectToPort() 而非 start() 来建立连接（避免 @/ide barrel mock 问题）
 * - mock 所有有副作用的模块
 * - 替换全局 WebSocket 构造函数
 */
import { afterAll, describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";

// ─── Mock 模块（必须在 await import 之前） ───────────────────────────────

import { globalBus, IdeEvents } from "@/bus";

let publishSpy: ReturnType<typeof spyOn>;

mock.module("@/ide/detection", () => ({
  getAvailableIDEs: () => ({ matched: [], unmatched: [] }),
  detectIDE: () => "VSCode" as const,
  isExtensionInstalled: () => false,
  hasMatchingIDE: () => false,
}));

mock.module("@/config", () => ({
  getGlobalTmpDir: () => "/tmp/crab-test",
}));

mock.module("@/server/collaboration", () => ({
  collaborationManager: { stop: mock(() => {}) },
  CollaborationManager: class {
    constructor() {}
    subscribeBus() {}
    start() {}
    stop() {}
  },
}));

mock.module("@/core/logging/logger", () => ({
  createLogger: () => ({
    info: mock(() => {}),
    warn: mock(() => {}),
    debug: mock(() => {}),
    error: mock(() => {}),
  }),
}));

mock.module("@/core/errors/appError", () => ({
  createInternalError: (code: string, msg: string) => Object.assign(new Error(msg), { code }),
}));

mock.module("@/ide/errors", () => ({
  getIdeErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  createIdeError: () => ({ message: "test error", code: "test" }),
  toIdeLogPayload: () => ({}),
}));

// 不 mock @/ide/shared/pathUtils — normalizePath 对 Unix 路径是幂等的，
// 且 mock 会泄漏到同目录的 pathUtils.test.ts（bun:test 模块 mock 跨文件泄漏）。

// ─── helpers ────────────────────────────────────────────────────────────

function createMockWebSocket(opts?: { autoOpen?: boolean; autoError?: boolean; delayMs?: number }) {
  const eventListeners: Record<string, ((...args: any[]) => void)[]> = {
    open: [],
    close: [],
    error: [],
    message: [],
  };

  const ws: Record<string, any> = {
    readyState: WebSocket.CONNECTING as number,
    send: mock(() => {}),
    close: mock(() => {
      ws.readyState = WebSocket.CLOSED as number;
      // 异步触发 close 事件（更接近真实 WebSocket 行为）
      setTimeout(() => {
        for (const cb of eventListeners["close"] ?? []) cb(new CloseEvent("close"));
      }, 0);
    }),
    addEventListener: mock((type: string, cb: (...args: any[]) => void) => {
      if (!eventListeners[type]) eventListeners[type] = [];
      eventListeners[type]!.push(cb);
    }),
    removeEventListener: mock((type: string, cb: (...args: any[]) => void) => {
      const arr = eventListeners[type];
      if (arr) {
        const idx = arr.indexOf(cb);
        if (idx !== -1) arr.splice(idx, 1);
      }
    }),
  };

  const delay = opts?.delayMs ?? 0;
  if (opts?.autoError !== true) {
    setTimeout(() => {
      ws.readyState = WebSocket.OPEN as number;
      for (const cb of eventListeners["open"] ?? []) cb();
    }, delay);
  } else {
    setTimeout(() => {
      for (const cb of eventListeners["error"] ?? []) cb(new Event("error"));
    }, delay);
  }

  ws.__eventListeners = eventListeners;
  return ws;
}

/**
 * 辅助：通过 connectToPort() 建立连接并返回 mock ws。
 * 所有需要已连接状态的测试都应使用此方法。
 */
async function connectWithMock(conn: InstanceType<typeof VSCodeConnection>, port = 8888) {
  const ws = createMockWebSocket({ autoOpen: true });
  (globalThis as any).WebSocket = mock((_url: string) => ws);
  await conn.connectToPort(port);
  return ws;
}

// ─── 导入被测模块 ──────────────────────────────────────────────────────

const { VSCodeConnection } = await import("@/ide/client/vscodeConnection");

// ─── tests ───────────────────────────────────────────────────────────────

describe("VSCodeConnection", () => {
  afterAll(() => {
    mock.restore();
  });

  let conn: InstanceType<typeof VSCodeConnection>;
  let OriginalWebSocket: typeof globalThis.WebSocket;

  beforeEach(() => {
    conn = new VSCodeConnection();
    OriginalWebSocket = globalThis.WebSocket;
    const wsMock = mock((_url: string) => createMockWebSocket());
    // 保留 WebSocket 常量，否则 WebSocket.OPEN 变成 undefined
    (wsMock as any).OPEN = WebSocket.OPEN;
    (wsMock as any).CLOSED = WebSocket.CLOSED;
    (wsMock as any).CONNECTING = WebSocket.CONNECTING;
    (globalThis as any).WebSocket = wsMock;
    publishSpy = spyOn(globalBus, "publish").mockImplementation(() => {});
  });

  afterEach(() => {
    (globalThis as any).WebSocket = OriginalWebSocket;
    conn.stop();
  });

  // ─── connectToPort ──────────────────────────────────────────────────

  describe("connectToPort()", () => {
    it("成功连接到指定端口", async () => {
      const ws = await connectWithMock(conn, 8888);
      expect(conn.isConnected()).toBe(true);
      expect(conn.getPort()).toBe(8888);
      expect(conn.getStatus()).toBe("connected");
      // 验证 mock WS 被使用
      expect(ws.addEventListener).toHaveBeenCalled();
    });

    it("连接失败时 reject", async () => {
      const ws = createMockWebSocket({ autoError: true });
      (globalThis as any).WebSocket = mock((_url: string) => ws);

      expect(conn.connectToPort(8888)).rejects.toThrow("连接端口 8888 失败");
      expect(conn.getStatus()).toBe("error");
    });

    it("连接超时后 reject", async () => {
      // 创建一个不会触发 open/error/close 的裸 mock（避免 createMockWebSocket 闭包捕获 eventListeners）
      const neverWs = {
        readyState: WebSocket.CONNECTING as number,
        send: mock(() => {}),
        close: mock(() => {}),
        addEventListener: mock(() => {}),
        removeEventListener: mock(() => {}),
      };
      (globalThis as any).WebSocket = mock((_url: string) => neverWs);
      (conn as any).CONNECTION_TIMEOUT = 50;

      expect(conn.connectToPort(8888)).rejects.toThrow("操作超时");
    });

    it("调用前先停止现有连接", async () => {
      const ws1 = await connectWithMock(conn, 9123);
      expect(conn.getPort()).toBe(9123);

      await connectWithMock(conn, 9999);
      expect(conn.getPort()).toBe(9999);
      expect(ws1.close).toHaveBeenCalled();
    });
  });

  // ─── stop ─────────────────────────────────────────────────────────────

  describe("stop()", () => {
    it("断开连接并清理状态", async () => {
      await connectWithMock(conn);
      expect(conn.isConnected()).toBe(true);

      (conn as any)._userDisconnected = true; // 阻止 close 事件触发重连
      conn.stop();

      expect(conn.getStatus()).toBe("disconnected");
    });

    it("close 事件监听器正确触发 scheduleReconnect", async () => {
      await connectWithMock(conn);

      const scheduleSpy = spyOn(conn as any, "scheduleReconnect").mockImplementation(() => {});
      (conn as any)._userDisconnected = true; // 阻止实际重连

      // 手动触发 close 事件监听器（mock 的 close() 不分发事件）
      const ws = await connectWithMock(conn);
      const closeListeners = ws.__eventListeners["close"] ?? [];
      for (const cb of closeListeners) cb(new CloseEvent("close"));

      expect(scheduleSpy).toHaveBeenCalledTimes(1);
    });

    it("多次 stop 不报错", async () => {
      await connectWithMock(conn);
      (conn as any)._userDisconnected = true;
      conn.stop();
      conn.stop(); // 第二次 stop 不应报错
      expect(conn.getStatus()).toBe("disconnected");
    });
  });

  // ─── 状态查询 ──────────────────────────────────────────────────────

  describe("status queries", () => {
    it("初始状态为 disconnected", () => {
      const fresh = new VSCodeConnection();
      expect(fresh.getStatus()).toBe("disconnected");
      expect(fresh.isConnected()).toBe(false);
      expect(fresh.getPort()).toBe(0);
      expect(fresh.getContext()).toEqual({});
    });
  });

  // ─── handleMessage（通过已连接状态测试） ─────────────────────────────

  describe("handleMessage()", () => {
    it("context 消息更新 editorContext 并设置 trustContext", async () => {
      const ws = await connectWithMock(conn);

      const messageListeners = ws.__eventListeners["message"] ?? [];
      const handler = messageListeners[0] as ((ev: { data: string }) => void) | undefined;
      expect(handler).toBeDefined();

      handler!({
        data: JSON.stringify({
          type: "context",
          activeFile: "/project/main.ts",
          cursorPosition: { line: 42, character: 7 },
          selectedText: "fn()",
        }),
      });

      expect((conn as any).trustContext).toBe(true);
      const ctx = conn.getContext();
      expect(ctx.activeFile).toBe("/project/main.ts");
      expect(ctx.cursorPosition).toEqual({ line: 42, character: 7 });
      expect(ctx.selectedText).toBe("fn()");
    });

    it("非 context 消息不更新 editorContext", async () => {
      const ws = await connectWithMock(conn);

      const messageListeners = ws.__eventListeners["message"] ?? [];
      const handler = messageListeners[0] as ((ev: { data: string }) => void) | undefined;
      handler!({ data: JSON.stringify({ type: "otherEvent", data: "ignored" }) });

      expect(conn.getContext()).toEqual({});
    });

    it("lastMessageReceivedAt 在收到消息时更新", async () => {
      const ws = await connectWithMock(conn);

      const before = Date.now();
      const messageListeners = ws.__eventListeners["message"] ?? [];
      const handler = messageListeners[0] as ((ev: { data: string }) => void) | undefined;
      handler!({ data: JSON.stringify({ type: "context", activeFile: "/f.ts" }) });

      expect((conn as any).lastMessageReceivedAt).toBeGreaterThanOrEqual(before);
    });

    it("context 消息发布 EditorContextChanged 事件", async () => {
      const ws = await connectWithMock(conn);
      publishSpy.mockClear();

      const messageListeners = ws.__eventListeners["message"] ?? [];
      const handler = messageListeners[0] as ((ev: { data: string }) => void) | undefined;
      handler!({
        data: JSON.stringify({
          type: "context",
          activeFile: "/project/a.ts",
        }),
      });

      expect(publishSpy).toHaveBeenCalledWith(IdeEvents.EditorContextChanged, expect.any(Object));
    });
  });

  // ─── onContextUpdate ──────────────────────────────────────────────────

  describe("onContextUpdate()", () => {
    it("收到 context 消息时通知监听器", async () => {
      const ws = await connectWithMock(conn);
      const listener = mock(() => {});
      const unsub = conn.onContextUpdate(listener);

      const messageListeners = ws.__eventListeners["message"] ?? [];
      const handler = messageListeners[0] as ((ev: { data: string }) => void) | undefined;
      handler!({
        data: JSON.stringify({
          type: "context",
          activeFile: "/project/foo.ts",
          cursorPosition: { line: 1, character: 0 },
          workspaceFolder: process.cwd(),
        }),
      });

      expect(listener).toHaveBeenCalledTimes(1);

      unsub();
      handler!({
        data: JSON.stringify({
          type: "context",
          activeFile: "/project/bar.ts",
          workspaceFolder: process.cwd(),
        }),
      });

      expect(listener).toHaveBeenCalledTimes(1); // unsub 后不再通知
    });

    it("unsub 后不收到通知", async () => {
      const ws = await connectWithMock(conn);
      const listener = mock(() => {});
      const unsub = conn.onContextUpdate(listener);
      unsub();

      const messageListeners = ws.__eventListeners["message"] ?? [];
      const handler = messageListeners[0] as ((ev: { data: string }) => void) | undefined;
      handler!({ data: JSON.stringify({ type: "context", activeFile: "/a.ts" }) });

      expect(listener).not.toHaveBeenCalled();
    });
  });

  // ─── shouldHandle 工作区过滤 ─────────────────────────────────────────

  describe("shouldHandle() — workspace filtering", () => {
    it("无 workspaceFolder 的消息总是通过", async () => {
      const ws = await connectWithMock(conn);
      const listener = mock(() => {});
      conn.onContextUpdate(listener);

      const messageListeners = ws.__eventListeners["message"] ?? [];
      const handler = messageListeners[0] as ((ev: { data: string }) => void) | undefined;
      handler!({ data: JSON.stringify({ type: "context", activeFile: "/other/file.ts" }) });

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("trustContext 为 true 时 context 消息总是通过", async () => {
      const ws = await connectWithMock(conn);
      const listener = mock(() => {});
      conn.onContextUpdate(listener);

      const messageListeners = ws.__eventListeners["message"] ?? [];
      const handler = messageListeners[0] as ((ev: { data: string }) => void) | undefined;

      // 第一条 context 使 trustContext = true
      handler!({ data: JSON.stringify({ type: "context", activeFile: "/any/file.ts" }) });
      expect(listener).toHaveBeenCalledTimes(1);

      // 第二条 context 带不匹配 workspaceFolder 但 trustContext=true
      handler!({
        data: JSON.stringify({
          type: "context",
          activeFile: "/unmatched/file.ts",
          workspaceFolder: "/unmatched",
        }),
      });

      expect(listener).toHaveBeenCalledTimes(2);
    });

    it("workspaceFolder 匹配 currentCwd 时通过", async () => {
      const ws = await connectWithMock(conn);
      const listener = mock(() => {});
      conn.onContextUpdate(listener);

      const messageListeners = ws.__eventListeners["message"] ?? [];
      const handler = messageListeners[0] as ((ev: { data: string }) => void) | undefined;
      handler!({
        data: JSON.stringify({
          type: "context",
          activeFile: "/project/file.ts",
          workspaceFolder: process.cwd(),
        }),
      });

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("workspaceFolder 不匹配且 trustContext false 时被过滤", async () => {
      const ws = await connectWithMock(conn);
      const listener = mock(() => {});
      conn.onContextUpdate(listener);

      const messageListeners = ws.__eventListeners["message"] ?? [];
      const handler = messageListeners[0] as ((ev: { data: string }) => void) | undefined;
      handler!({
        data: JSON.stringify({
          type: "context",
          activeFile: "/other/file.ts",
          workspaceFolder: "/completely/different/path",
        }),
      });

      expect(listener).not.toHaveBeenCalled();
    });
  });

  // ─── getContext ──────────────────────────────────────────────────────

  describe("getContext()", () => {
    it("返回 editorContext 的副本（不受外部修改影响）", async () => {
      const ws = await connectWithMock(conn);

      const messageListeners = ws.__eventListeners["message"] ?? [];
      const handler = messageListeners[0] as ((ev: { data: string }) => void) | undefined;
      handler!({
        data: JSON.stringify({
          type: "context",
          activeFile: "/project/src/index.ts",
          workspaceFolder: process.cwd(),
        }),
      });

      const ctx = conn.getContext();
      expect(ctx.activeFile).toBe("/project/src/index.ts");

      // 修改副本不影响内部状态
      (ctx as any).activeFile = "mutated";
      expect(conn.getContext().activeFile).toBe("/project/src/index.ts");
    });
  });

  // ─── requestDiagnostics ──────────────────────────────────────────────

  describe("requestDiagnostics()", () => {
    it("未连接时返回空数组", async () => {
      const result = await conn.requestDiagnostics("/some/file.ts");
      expect(result).toEqual([]);
    });

    it("收到匹配 requestId 的 diagnostics 响应", async () => {
      const ws = await connectWithMock(conn);

      const diagPromise = conn.requestDiagnostics("/project/src/index.ts");
      await Bun.sleep(0);

      // 找到 getDiagnostics 请求
      const allCalls = ws.send.mock.calls as unknown[][];
      const getDiagCall = allCalls.find((c: unknown[]) => {
        try {
          return JSON.parse(c[0] as string).type === "getDiagnostics";
        } catch {
          return false;
        }
      });
      expect(getDiagCall).toBeDefined();
      const requestId = (JSON.parse(getDiagCall![0] as string) as any).requestId;

      // 模拟响应 — 遍历所有 message listener（requestDiagnostics 的专用 handler 是第二个 listener）
      const messageListeners = ws.__eventListeners["message"] ?? [];
      const responseEvent = {
        data: JSON.stringify({
          type: "diagnostics",
          requestId,
          diagnostics: [{ message: "err", severity: "error", line: 1, character: 0 }],
        }),
      };
      for (const listener of messageListeners) {
        (listener as (ev: { data: string }) => void)(responseEvent);
      }

      const result = await diagPromise;
      expect(result).toHaveLength(1);
      expect(result[0]!.message).toBe("err");
    });

    it("2s 超时后返回空数组", async () => {
      const ws = await connectWithMock(conn);

      // 清除 close 事件防止干扰
      const origClose = ws.close;
      ws.close = mock(() => {
        ws.readyState = WebSocket.CLOSED;
        origClose.call(ws);
      });
      ws.__eventListeners["close"] = [];

      const realSetTimeout = globalThis.setTimeout;
      const setTimeoutSpy = spyOn(globalThis, "setTimeout").mockImplementation(((
        fn: any,
        ms?: number,
        ...args: any[]
      ) => realSetTimeout(fn, ms === 2000 ? 30 : (ms as number), ...args)) as any);

      const result = await conn.requestDiagnostics("/project/file.ts");
      expect(result).toEqual([]);

      setTimeoutSpy.mockRestore();
    });
  });

  // ─── showDiff / closeDiff ────────────────────────────────────────────

  describe("showDiff() / closeDiff()", () => {
    it("未连接时 showDiff 抛出错误", async () => {
      expect(conn.showDiff("/file.ts", "old", "new", "label")).rejects.toThrow();
    });

    it("未连接时 closeDiff 抛出错误", async () => {
      expect(conn.closeDiff()).rejects.toThrow();
    });

    it("已连接时 showDiff 发送消息", async () => {
      const ws = await connectWithMock(conn);

      await conn.showDiff("/file.ts", "old", "new", "label");

      const lastCall = (ws.send.mock.calls as unknown[][]).at(-1)![0] as string;
      const parsed = JSON.parse(lastCall);
      expect(parsed.type).toBe("showDiff");
      expect(parsed.filePath).toBe("/file.ts");
    });

    it("已连接时 closeDiff 发送消息", async () => {
      const ws = await connectWithMock(conn);

      await conn.closeDiff();

      const lastCall = (ws.send.mock.calls as unknown[][]).at(-1)![0] as string;
      const parsed = JSON.parse(lastCall);
      expect(parsed.type).toBe("closeDiff");
    });
  });

  // ─── 重连逻辑 ──────────────────────────────────────────────────────

  describe("scheduleReconnect() — exponential backoff", () => {
    it("重连延迟公式: BASE_DELAY * 1.5^(attempts-1)，不超过 MAX_DELAY", () => {
      const BASE_DELAY = 2000;
      const MAX_DELAY = 30_000;

      expect(Math.min(BASE_DELAY * 1.5 ** 0, MAX_DELAY)).toBe(2000);
      expect(Math.min(BASE_DELAY * 1.5 ** 1, MAX_DELAY)).toBe(3000);
      expect(Math.min(BASE_DELAY * 1.5 ** 2, MAX_DELAY)).toBe(4500);
      expect(Math.min(BASE_DELAY * 1.5 ** 9, MAX_DELAY)).toBe(30000);
    });

    it("_userDisconnected 为 true 时不重连", () => {
      (conn as any)._userDisconnected = true;
      (conn as any).reconnectAttempts = 0;

      conn.stop();
      (conn as any).scheduleReconnect();

      expect((conn as any).reconnectTimer).toBeNull();
    });

    it("达到 MAX_RECONNECT 后停止重连", () => {
      (conn as any).reconnectAttempts = 9;
      (conn as any).MAX_RECONNECT = 10;

      // 直接调用 scheduleReconnect（stop 会通过 close 事件多调一次）
      (conn as any).scheduleReconnect();

      expect((conn as any).reconnectTimer).toBeNull();
      expect((conn as any).reconnectAttempts).toBe(10);
    });

    it("断连后触发 scheduleReconnect", async () => {
      const ws = await connectWithMock(conn);

      const scheduleSpy = spyOn(conn as any, "scheduleReconnect").mockImplementation(() => {});

      // reconnectAttempts > 0 才在 close 时触发重连
      (conn as any).reconnectAttempts = 1;
      const closeListeners = ws.__eventListeners["close"] ?? [];
      for (const cb of closeListeners) cb(new Event("close"));

      expect(scheduleSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ─── 客户端心跳 ──────────────────────────────────────────────────────

  describe("startClientHeartbeat() / stopClientHeartbeat()", () => {
    it("连接成功后启动心跳定时器", async () => {
      spyOn(globalThis, "setInterval").mockImplementation(() => 12345 as any);
      await connectWithMock(conn);

      expect((conn as any).heartbeatTimer).toBe(12345);
    });

    it("stop 时清除心跳定时器", async () => {
      const clearIntervalSpy = spyOn(globalThis, "clearInterval").mockImplementation(() => {});
      spyOn(globalThis, "setInterval").mockImplementation(() => 99999 as any);

      await connectWithMock(conn);
      conn.stop();

      expect(clearIntervalSpy).toHaveBeenCalledWith(99999);
    });

    it("心跳超时触发重连", async () => {
      spyOn(globalThis, "setInterval").mockImplementation(((cb: (...args: any[]) => void) => {
        (conn as any)._intervalCb = cb;
        return 11111;
      }) as any);

      const ws = await connectWithMock(conn);

      // 模拟长时间没收到消息
      (conn as any).lastMessageReceivedAt = 0;

      // 阻止 close 事件中的 scheduleReconnect（心跳自身会调用）
      ws.__eventListeners["close"] = [];

      const scheduleSpy = spyOn(conn as any, "scheduleReconnect").mockImplementation(() => {});
      (conn as any)._intervalCb();

      expect(conn.getStatus()).toBe("disconnected");
      expect(scheduleSpy).toHaveBeenCalledTimes(1);
      expect(scheduleSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ─── setStatus 发布事件 ──────────────────────────────────────────────

  describe("setStatus() — bus events", () => {
    it("连接时发布 IDEConnected 事件", async () => {
      await connectWithMock(conn, 9123);

      expect(publishSpy).toHaveBeenCalledWith(IdeEvents.IDEConnected, { port: 9123 });
    });

    it("断连时发布 IDEDisconnected 事件", async () => {
      await connectWithMock(conn);
      publishSpy.mockClear();

      conn.stop();

      expect(publishSpy).toHaveBeenCalledWith(IdeEvents.IDEDisconnected, { reason: "disconnected" });
    });

    it("error 状态时发布 IDEDisconnected 事件", async () => {
      const ws = createMockWebSocket({ autoError: true });
      (globalThis as any).WebSocket = mock((_url: string) => ws);
      publishSpy.mockClear();

      try {
        await conn.connectToPort(8888);
      } catch {}

      expect(publishSpy).toHaveBeenCalledWith(IdeEvents.IDEDisconnected, { reason: "error" });
    });
  });
});
