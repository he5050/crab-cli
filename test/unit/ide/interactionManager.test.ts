/**
 * IDE 交互管理器测试
 */
import { describe, it, expect, beforeEach, mock } from "bun:test";

// Mock wsServer before importing interactionManager
const mockSendNotification = mock(() => {});
const mockSendRequest = mock<
  (
    clientId: string,
    method: string,
    params: Record<string, unknown>,
    timeoutMs?: number,
  ) => Promise<{ data: unknown; reason: string }>
>(() => Promise.resolve({ data: null, reason: "disconnected" }));
const mockGetClients = mock(() => []);
const mockOn = mock(() => {});

// 隔离 mock：防止 vscodeConnection.test.ts 的 @/ide/errors mock 泄漏
mock.module("@/core/logging/logger", () => ({
  createLogger: () => ({
    info: mock(() => {}),
    warn: mock(() => {}),
    debug: mock(() => {}),
    error: mock(() => {}),
  }),
}));

mock.module("@/ide/errors", () => ({
  getIdeErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  createIdeError: (error: unknown, _context: Record<string, unknown>, reason?: string) => {
    const message = error instanceof Error ? error.message : String(error);
    const code =
      reason === "client_missing" ? "USER-204" : reason === "unsupported_request" ? "USER-202" : "INTERNAL-900";
    return { message, code, name: "AppError" };
  },
  toIdeLogPayload: (err: { message: string; code: string }) => ({ error: err.message, errorCode: err.code }),
}));

mock.module("@/ide/connection/wsServer", () => ({
  IDEWebSocketServer: class {},
  IDEClient: undefined,
  SendRequestResult: undefined,
  ideWsServer: {
    sendNotification: mockSendNotification,
    sendRequest: mockSendRequest,
    getClients: mockGetClients,
    on: mockOn,
    port: 0,
    status: "disconnected" as const,
  },
}));

const { wireInteractionManager, registerInteractionHandler, handleIDERequest, sendToIDE, _testClearHandlers } =
  await import("@/ide/connection/interactionManager");

describe("interactionManager", () => {
  beforeEach(() => {
    _testClearHandlers();
    mockSendNotification.mockClear();
    mockSendRequest.mockClear();
    mockGetClients.mockClear();
    mockOn.mockClear();
  });

  describe("wireInteractionManager", () => {
    it("幂等：调用两次只注册一次 on 回调", () => {
      wireInteractionManager();
      const countFirst = mockOn.mock.calls.length;
      wireInteractionManager();
      const countSecond = mockOn.mock.calls.length;
      expect(countSecond).toBe(countFirst);
    });
  });

  describe("handleIDERequest", () => {
    it("注册处理器后处理成功", async () => {
      registerInteractionHandler("showDiff", async (params) => params);
      const response = await handleIDERequest({
        type: "showDiff",
        clientId: "c1",
        params: { file: "/tmp/a.ts" },
      });
      expect(response.success).toBe(true);
      expect(response.data).toEqual({ file: "/tmp/a.ts" });
    });

    it("未注册的交互类型返回错误", async () => {
      // showDiff 已在上一个测试注册，这里先清理
      _testClearHandlers();
      const response = await handleIDERequest({
        type: "showDiff",
        clientId: "c1",
        params: {},
      });
      expect(response.success).toBe(false);
      expect(response.error).toContain("未支持的交互类型");
    });

    it("处理器抛错时返回错误", async () => {
      _testClearHandlers();
      registerInteractionHandler("showDiff", async () => {
        throw new Error("handler boom");
      });
      const response = await handleIDERequest({
        type: "showDiff",
        clientId: "c1",
        params: {},
      });
      expect(response.success).toBe(false);
      expect(response.error).toContain("handler boom");
    });
  });

  describe("sendToIDE", () => {
    it("sendRequest 返回 data=null 时返回失败", async () => {
      mockSendRequest.mockResolvedValue({ data: null, reason: "disconnected" });
      const response = await sendToIDE("c1", "showDiff", {});
      expect(response.success).toBe(false);
      expect(response.errorCode).toBeDefined();
    });

    it("sendRequest 返回数据时返回成功", async () => {
      mockSendRequest.mockResolvedValue({ data: { ok: true }, reason: "ok" });
      const response = await sendToIDE("c1", "showDiff", {});
      expect(response.success).toBe(true);
      expect(response.data).toEqual({ ok: true });
    });

    it("sendRequest 返回超时时包含超时信息", async () => {
      mockSendRequest.mockResolvedValue({ data: null, reason: "timeout" });
      const response = await sendToIDE("c1", "showDiff", {});
      expect(response.success).toBe(false);
      expect(response.error).toContain("超时");
    });

    it("sendRequest 抛错时返回失败", async () => {
      mockSendRequest.mockRejectedValue(new Error("network error"));
      const response = await sendToIDE("c1", "showDiff", {});
      expect(response.success).toBe(false);
      expect(response.error).toContain("network error");
    });
  });
});
