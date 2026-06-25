/**
 * ACP Stdio 测试。
 *
 * 测试目标:
 *   - 验证 ACP Stdio 连接初始化与事件流
 *   - 验证会话更新与代理工厂约定
 */
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { globalBus } from "@/bus";
import { AppEvent } from "@/bus";
import { VERSION } from "@/config/version";

describe("ACP Stdio (L4-T01~T03)", () => {
  let sessionUpdateCalls: { sessionId: string; update: unknown }[];
  let lastAgent: any;
  let sendMessageImpl: (
    text: string,
    sessionId?: string,
  ) => Promise<{ text: string; ok?: boolean; toolRounds?: number }>;

  function createMockAcpSdk() {
    sessionUpdateCalls = [];
    lastAgent = undefined;

    return {
      AgentSideConnection: mock((agentFactory: any) => {
        const connection = {
          closed: Promise.resolve(),
          sessionUpdate: mock((params: any) => {
            sessionUpdateCalls.push(params);
          }),
          signal: {
            addEventListener: mock(),
          },
        };
        lastAgent = agentFactory(connection);
        return connection;
      }),
      PROTOCOL_VERSION: "2025-01-01",
      ndJsonStream: mock(() => ({})),
    };
  }

  function mockConversationHandler() {
    return class {
      private sessionId?: string;

      constructor(_config: unknown, options?: { sessionId?: string }) {
        this.sessionId = options?.sessionId;
      }

      async sendMessage(text: string) {
        return sendMessageImpl(text, this.sessionId);
      }
    };
  }

  function mockLoggerModule() {
    return {
      createLogger: () => ({ debug: () => {}, error: () => {}, info: () => {}, warn: () => {} }),
      flushLogSync: () => {},
    };
  }

  async function restoreLoggerModule() {
    const actualLoggerModule = await import(`@/core/logging/logger.ts`);
    mock.module("@core/logger", () => actualLoggerModule);
  }

  beforeEach(() => {
    mock.restore();
    sessionUpdateCalls = [];
    lastAgent = undefined;
    sendMessageImpl = async (text: string) => ({ ok: true, text: `echo:${text}`, toolRounds: 0 });
  });

  afterEach(async () => {
    mock.restore();
    await restoreLoggerModule();
  });

  afterAll(async () => {
    mock.restore();
    await restoreLoggerModule();
  });

  test("T01: Agent 初始化返回正确的能力声明", async () => {
    const sdk = createMockAcpSdk();
    mock.module("@agentclientprotocol/sdk", () => sdk);
    mock.module("@core/logger", mockLoggerModule);
    const mod = await import("@/server/acpStdio.ts");
    mod.__setAcpStdioDepsForTesting({
      ConversationHandler: mockConversationHandler() as any,
      ensureMcpRuntimeStarted: async () => ({}) as any,
    });
    // StartAcpStdio 内部 await ensureMcpRuntimeStarted 后同步创建 AgentSideConnection
    // Connection.closed mock 返回 Promise.resolve()，所以 await 不会挂起
    await mod.startAcpStdio();

    // 模拟 startAcpStdio 中的 AgentSideConnection 调用
    expect(sdk.AgentSideConnection).toHaveBeenCalled();
    expect(lastAgent).toBeDefined();

    // 获取 agent 实例
    const agent = lastAgent;

    const result = await agent.initialize({});

    expect(result.protocolVersion).toBe("2025-01-01");
    expect(result.agentCapabilities).toBeDefined();
    expect(result.agentCapabilities.sessionCapabilities).toBeDefined();
    expect(result.agentCapabilities.sessionCapabilities.close).toBeDefined();
    expect(result.agentCapabilities.promptCapabilities).toBeDefined();
    expect(result.agentInfo).toBeDefined();
    expect(result.agentInfo.name).toBe("crab-cli");
    expect(result.agentInfo.version).toBe(VERSION);
  });

  test("T02: 会话创建和关闭生命周期", async () => {
    const sdk = createMockAcpSdk();
    mock.module("@agentclientprotocol/sdk", () => sdk);
    mock.module("@core/logger", mockLoggerModule);
    // 捕获 crypto.randomUUID
    let uuidCounter = 0;
    const originalRandomUUID = crypto.randomUUID;
    crypto.randomUUID = (() =>
      `00000000-0000-0000-0000-${String(++uuidCounter).padStart(12, "0")}`) as typeof crypto.randomUUID;

    try {
      const mod = await import("@/server/acpStdio.ts");
      mod.__setAcpStdioDepsForTesting({
        ConversationHandler: mockConversationHandler() as any,
        ensureMcpRuntimeStarted: async () => ({}) as any,
        loadConfig: async () =>
          ({
            defaultProvider: { model: "m1", provider: "test" },
            providerConfig: {},
          }) as any,
      });
      await mod.startAcpStdio();
      const agent = lastAgent;

      // 创建会话
      const newSessionResult = await agent.newSession({ cwd: "/tmp/test" });
      expect(newSessionResult.sessionId).toBeTruthy();
      expect(newSessionResult.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

      // 关闭会话
      const closeResult = await agent.closeSession({ sessionId: newSessionResult.sessionId });
      expect(closeResult).toBeDefined();

      // 访问已关闭的会话应返回错误
      const promptResult = await agent
        .prompt({
          prompt: [{ text: "hello", type: "text" }],
          sessionId: newSessionResult.sessionId,
        })
        .catch((error: Error) => error);
      expect(promptResult.message).toContain("not found");
    } finally {
      crypto.randomUUID = originalRandomUUID;
    }
  });

  test("T03: prompt 发送消息并通过 sessionUpdate 推送结果，cancel 中断执行", async () => {
    const sdk = createMockAcpSdk();
    mock.module("@agentclientprotocol/sdk", () => sdk);
    mock.module("@core/logger", mockLoggerModule);
    let uuidCounter = 0;
    const originalRandomUUID = crypto.randomUUID;
    crypto.randomUUID = (() =>
      `00000000-0000-0000-0000-${String(++uuidCounter).padStart(12, "0")}`) as typeof crypto.randomUUID;

    try {
      const mod = await import("@/server/acpStdio.ts");
      mod.__setAcpStdioDepsForTesting({
        ConversationHandler: mockConversationHandler() as any,
        ensureMcpRuntimeStarted: async () => ({}) as any,
        loadConfig: async () =>
          ({
            defaultProvider: { model: "m1", provider: "test" },
            providerConfig: {},
          }) as any,
      });
      await mod.startAcpStdio();
      const agent = lastAgent;

      // 创建会话
      const { sessionId } = await agent.newSession({ cwd: "/tmp/test" });

      // Prompt 应通过 sessionUpdate 推送 processing 和结果
      const promptResult = await agent.prompt({
        prompt: [{ text: "hello world", type: "text" }],
        sessionId,
      });

      expect(promptResult.stopReason).toBe("end_turn");
      expect(sessionUpdateCalls.length).toBeGreaterThanOrEqual(2);

      // 第一个 update 应是 processing
      const firstUpdate = sessionUpdateCalls[0]!;
      expect(firstUpdate.sessionId).toBe(sessionId);
      expect((firstUpdate.update as { sessionUpdate: string }).sessionUpdate).toBe("agent_message_chunk");

      // 最后一个 update 应包含结果
      const lastUpdate = sessionUpdateCalls[sessionUpdateCalls.length - 1]!;
      expect(lastUpdate.sessionId).toBe(sessionId);

      // 测试 cancel
      await agent.cancel({ sessionId });
      sendMessageImpl = async () => {
        throw new Error("aborted");
      };
      const cancelPrompt = await agent.prompt({
        prompt: [{ text: "test", type: "text" }],
        sessionId,
      });
      expect(cancelPrompt.stopReason).toBe("cancelled");
    } finally {
      crypto.randomUUID = originalRandomUUID;
    }
  });

  test("T04: ping 和 loadSession 提供 ACP stdio 会话探活与加载能力", async () => {
    const sdk = createMockAcpSdk();
    mock.module("@agentclientprotocol/sdk", () => sdk);
    mock.module("@core/logger", mockLoggerModule);

    const mod = await import("@/server/acpStdio.ts");
    mod.__setAcpStdioDepsForTesting({
      ConversationHandler: mockConversationHandler() as any,
      ensureMcpRuntimeStarted: async () => ({}) as any,
      loadConfig: async () =>
        ({
          defaultProvider: { model: "m1", provider: "test" },
          providerConfig: {},
        }) as any,
    });
    await mod.startAcpStdio();
    const agent = lastAgent;

    expect(await agent.ping({})).toEqual({ ok: true });

    const loaded = await agent.loadSession({ cwd: "/tmp/test", sessionId: "existing-session" });
    expect(loaded).toEqual({});
    expect(sessionUpdateCalls).toContainEqual({
      sessionId: "existing-session",
      update: {
        sessionUpdate: "session_info_update",
        updatedAt: expect.any(String),
      },
    });
  });

  test("T05: prompt 将工具调用 bus 事件映射为 ACP tool_call_update", async () => {
    const sdk = createMockAcpSdk();
    mock.module("@agentclientprotocol/sdk", () => sdk);
    mock.module("@core/logger", mockLoggerModule);
    let uuidCounter = 0;
    const originalRandomUUID = crypto.randomUUID;
    crypto.randomUUID = (() =>
      `00000000-0000-0000-0000-${String(++uuidCounter).padStart(12, "0")}`) as typeof crypto.randomUUID;

    try {
      const mod = await import("@/server/acpStdio.ts");
      mod.__setAcpStdioDepsForTesting({
        ConversationHandler: mockConversationHandler() as any,
        ensureMcpRuntimeStarted: async () => ({}) as any,
        loadConfig: async () =>
          ({
            defaultProvider: { model: "m1", provider: "test" },
            providerConfig: {},
          }) as any,
      });
      await mod.startAcpStdio();
      const agent = lastAgent;
      const { sessionId } = await agent.newSession({ cwd: "/tmp/test" });

      sendMessageImpl = async (_text, activeSessionId) => {
        globalBus.publish(AppEvent.ConversationToolCall, {
          args: { path: "README.md" },
          callId: "call-1",
          sessionId: activeSessionId,
          tool: "filesystem-read",
        });
        globalBus.publish(AppEvent.ToolResult, {
          callId: "call-1",
          result: "file contents",
          sessionId: activeSessionId,
          success: true,
          tool: "filesystem-read",
        });
        return { ok: true, text: "done", toolRounds: 1 };
      };

      const promptResult = await agent.prompt({
        prompt: [{ text: "read", type: "text" }],
        sessionId,
      });

      expect(promptResult.stopReason).toBe("end_turn");
      expect(sessionUpdateCalls).toContainEqual({
        sessionId,
        update: {
          rawInput: { path: "README.md" },
          sessionUpdate: "tool_call_update",
          status: "in_progress",
          title: "filesystem-read",
          toolCallId: "call-1",
        },
      });
      expect(sessionUpdateCalls).toContainEqual({
        sessionId,
        update: {
          rawOutput: "file contents",
          sessionUpdate: "tool_call_update",
          status: "completed",
          title: "filesystem-read",
          toolCallId: "call-1",
        },
      });
    } finally {
      crypto.randomUUID = originalRandomUUID;
    }
  });
});
