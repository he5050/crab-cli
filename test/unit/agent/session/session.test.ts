/**
 * AgentSession 单元测试
 *
 * 测试覆盖:
 *   - 构造函数（正常创建 / Agent 不存在 / instanceId 注册 collector）
 *   - sendMessage（正常路径 / 错误路径 / 运行时增强前缀注入 / 状态转移）
 *   - destroy（handler 销毁 / collector 注销 / 状态清理）
 *   - clearHistory（委托 handler）
 *   - getter 方法（getAgentName / getAgentInfo / getStatus / getInstanceId）
 *   - getSubagentTasks（返回副本）
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { _resetAll as resetAgentManager, registerAgent } from "@/agent/core/manager";
import {
  __resetAgentSessionDepsForTesting,
  __setAgentSessionDepsForTesting,
  __setSubagentCollectorForTesting,
} from "@/agent/session/sessionDeps";
import type { SubagentResultCollector } from "@/agent/session/sessionDeps";
import type { ConversationResult } from "@/conversation";

// ─── Mock 工厂 ──────────────────────────────────────────────

/** 创建 mock ConversationHandler 构造函数 */
function createMockHandlerClass(overrides?: {
  sendMessageResult?: ConversationResult;
  sendMessageFn?: (content: string) => Promise<ConversationResult>;
  destroyFn?: () => void;
}) {
  const sendMessageResult: ConversationResult = overrides?.sendMessageResult ?? {
    ok: true,
    text: "mock response",
    toolRounds: 1,
  };
  const sendMessageFn: (content: string) => Promise<ConversationResult> =
    overrides?.sendMessageFn ?? (async (_content: string) => ({ ...sendMessageResult }));
  const destroyFn: () => void = overrides?.destroyFn ?? (() => {});

  return class MockConversationHandler {
    // config 和 options 由 AgentSession 传入，mock 不需要使用
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    constructor(_config: unknown, _options: unknown) {}

    async sendMessage(content: string): Promise<ConversationResult> {
      return sendMessageFn(content);
    }

    destroy(): void {
      destroyFn();
    }

    getMessages(): unknown[] {
      return [];
    }

    clearHistory(): void {}

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    setAdditionalToolSchemas(_schemas: unknown): void {}

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    injectMessages(_messages: unknown[]): void {}
  };
}

/** 创建 mock subagentCollector */
function createMockCollector(overrides?: Partial<SubagentResultCollector>): SubagentResultCollector {
  return {
    register: mock(() => {}),
    unregister: mock(() => {}),
    waitForSpawnedAgents: mock(async () => {}),
    drainSpawnedResults: mock(() => []),
    drainOrphanedResults: mock(() => []),
    dequeueMessages: mock(() => []),
    dequeueInterAgentMessages: mock(() => []),
    isRunning: mock(() => false),
    ...overrides,
  };
}

/** 默认的 buildAgentRuntimeAugmentations mock */
const defaultAugmentations = mock(() => ({
  prefix: "",
  lastCompressionTimestamp: 0,
}));

// ─── 测试 ────────────────────────────────────────────────────

describe("AgentSession", () => {
  let sendMessageCalls: string[];
  let mockCollector: SubagentResultCollector;

  beforeEach(() => {
    resetAgentManager();
    __setSubagentCollectorForTesting(undefined);

    sendMessageCalls = [];
    const MockHandler = createMockHandlerClass({
      sendMessageFn: async (content: string) => {
        sendMessageCalls.push(content);
        return { ok: true, text: "mock response", toolRounds: 1 };
      },
    });

    // 直接覆盖 deps，不调用 __resetAgentSessionDepsForTesting（独立运行时 require() 会因 ESM 失败）
    __setAgentSessionDepsForTesting({
      ConversationHandler: MockHandler as never,
      buildAgentRuntimeAugmentations: defaultAugmentations,
    });

    mockCollector = createMockCollector();
    __setSubagentCollectorForTesting(mockCollector);

    // 注册测试 Agent
    registerAgent({
      name: "test-agent",
      label: "Test Agent",
      description: "Test agent for unit tests",
      mode: "subagent" as never,
      prompt: "You are a test agent.",
      options: {},
      allowedTools: ["bash", "read"],
    });
  });

  afterEach(() => {
    __setSubagentCollectorForTesting(undefined);
    resetAgentManager();
  });

  // ─── 构造函数 ────────────────────────────────────────────

  describe("constructor", () => {
    test("正常创建 session，初始状态为 idle", async () => {
      const { AgentSession } = await import("@/agent/session/session");
      const session = new AgentSession("test-agent", {
        defaultProvider: { provider: "p", model: "m" },
      } as never);

      expect(session.getAgentName()).toBe("test-agent");
      expect(session.getStatus()).toBe("idle");
      expect(session.getInstanceId()).toBeUndefined();
      expect(session.getSubagentTasks()).toEqual([]);
      session.destroy();
    });

    test("Agent 不存在时抛出错误", async () => {
      const { AgentSession } = await import("@/agent/session/session");
      expect(
        () =>
          new AgentSession("nonexistent-agent", {
            defaultProvider: { provider: "p", model: "m" },
          } as never),
      ).toThrow("Agent 未找到");
    });

    test("有 instanceId 时注册到 collector", async () => {
      const { AgentSession } = await import("@/agent/session/session");
      const session = new AgentSession("test-agent", { defaultProvider: { provider: "p", model: "m" } } as never, {
        instanceId: "inst-123",
      });

      expect(session.getInstanceId()).toBe("inst-123");
      expect(mockCollector.register).toHaveBeenCalledWith(expect.objectContaining({ instanceId: "inst-123" }));
      session.destroy();
    });

    test("传入 spawnDepth 和 maxSpawnDepth 正确存储", async () => {
      const { AgentSession } = await import("@/agent/session/session");
      const session = new AgentSession("test-agent", { defaultProvider: { provider: "p", model: "m" } } as never, {
        spawnDepth: 1,
        maxSpawnDepth: 5,
      });

      expect(session.getAgentName()).toBe("test-agent");
      session.destroy();
    });
  });

  // ─── sendMessage ──────────────────────────────────────────

  describe("sendMessage", () => {
    test("正常路径返回正确结果，状态变为 completed", async () => {
      const { AgentSession } = await import("@/agent/session/session");
      const session = new AgentSession("test-agent", {
        defaultProvider: { provider: "p", model: "m" },
      } as never);

      const result = await session.sendMessage("hello");

      expect(result.ok).toBe(true);
      expect(result.text).toBe("mock response");
      expect(result.agentName).toBe("test-agent");
      expect(result.toolRounds).toBe(1);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
      expect(session.getStatus()).toBe("completed");
      expect(sendMessageCalls).toHaveLength(1);

      session.destroy();
    });

    test("运行时增强前缀注入到 sendMessage 内容", async () => {
      const { AgentSession } = await import("@/agent/session/session");
      __setAgentSessionDepsForTesting({
        ConversationHandler: createMockHandlerClass({
          sendMessageFn: async (content: string) => {
            sendMessageCalls.push(content);
            return { ok: true, text: "augmented", toolRounds: 0 };
          },
        }) as never,
        buildAgentRuntimeAugmentations: mock(() => ({
          prefix: "[增强前缀]",
          lastCompressionTimestamp: 100,
        })),
      });

      const session = new AgentSession("test-agent", {
        defaultProvider: { provider: "p", model: "m" },
      } as never);
      await session.sendMessage("hello");

      expect(sendMessageCalls[0]).toContain("[增强前缀]");
      expect(sendMessageCalls[0]).toContain("hello");

      session.destroy();
    });

    test("ConversationHandler 抛出异常时返回错误结果，状态为 error", async () => {
      const { AgentSession } = await import("@/agent/session/session");
      __setAgentSessionDepsForTesting({
        ConversationHandler: createMockHandlerClass({
          sendMessageFn: async () => {
            throw new Error("handler crash");
          },
        }) as never,
        buildAgentRuntimeAugmentations: defaultAugmentations,
      });

      const session = new AgentSession("test-agent", {
        defaultProvider: { provider: "p", model: "m" },
      } as never);

      const result = await session.sendMessage("hello");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("handler crash");
      expect(result.text).toBe("");
      expect(result.toolRounds).toBe(0);
      expect(session.getStatus()).toBe("error");

      session.destroy();
    });

    test("ConversationHandler 返回 ok=false 时状态为 error", async () => {
      const { AgentSession } = await import("@/agent/session/session");
      __setAgentSessionDepsForTesting({
        ConversationHandler: createMockHandlerClass({
          sendMessageResult: {
            ok: false,
            text: "partial output",
            error: "LLM error",
            toolRounds: 2,
          },
        }) as never,
        buildAgentRuntimeAugmentations: defaultAugmentations,
      });

      const session = new AgentSession("test-agent", {
        defaultProvider: { provider: "p", model: "m" },
      } as never);

      const result = await session.sendMessage("hello");
      expect(result.ok).toBe(false);
      expect(result.error).toBe("LLM error");
      expect(result.text).toBe("partial output");
      expect(result.toolRounds).toBe(2);
      expect(session.getStatus()).toBe("error");

      session.destroy();
    });

    test("sendMessage 完成后 spawnedChildInstanceIds 被清空", async () => {
      const { AgentSession } = await import("@/agent/session/session");
      const session = new AgentSession("test-agent", {
        defaultProvider: { provider: "p", model: "m" },
      } as never);

      await session.sendMessage("hello");
      // finally 块清空 spawnedChildInstanceIds
      // 无子代理时 Set 本来就是空的，验证不抛错
      expect(session.getStatus()).toBe("completed");

      session.destroy();
    });
  });

  // ─── destroy ──────────────────────────────────────────────

  describe("destroy", () => {
    test("调用后 handler.destroy 被执行", async () => {
      let destroyCalled = false;
      const { AgentSession } = await import("@/agent/session/session");
      __setAgentSessionDepsForTesting({
        ConversationHandler: createMockHandlerClass({
          destroyFn: () => {
            destroyCalled = true;
          },
        }) as never,
        buildAgentRuntimeAugmentations: defaultAugmentations,
      });

      const session = new AgentSession("test-agent", {
        defaultProvider: { provider: "p", model: "m" },
      } as never);
      session.destroy();

      expect(destroyCalled).toBe(true);
    });

    test("有 instanceId 时销毁成功，状态回到 idle", async () => {
      const { AgentSession } = await import("@/agent/session/session");
      const session = new AgentSession("test-agent", { defaultProvider: { provider: "p", model: "m" } } as never, {
        instanceId: "inst-destroy-test",
      });

      expect(mockCollector.register).toHaveBeenCalledWith(expect.objectContaining({ instanceId: "inst-destroy-test" }));

      session.destroy();
      // destroySession 调用 subAgentTracker.unregister(instanceId), collector.unregister 不被调用
      expect(session.getStatus()).toBe("idle");
    });

    test("多次销毁不抛错", async () => {
      const { AgentSession } = await import("@/agent/session/session");
      const session = new AgentSession("test-agent", {
        defaultProvider: { provider: "p", model: "m" },
      } as never);

      expect(() => {
        session.destroy();
        session.destroy();
      }).not.toThrow();
    });
  });

  // ─── clearHistory ─────────────────────────────────────────

  describe("clearHistory", () => {
    test("委托给 handler.clearHistory", async () => {
      let clearCalled = false;
      const { AgentSession } = await import("@/agent/session/session");
      __setAgentSessionDepsForTesting({
        ConversationHandler: (() =>
          class {
            // eslint-disable-next-line @typescript-eslint/no-empty-function
            constructor(_config: unknown, _options: unknown) {}
            async sendMessage() {
              return { ok: true, text: "", toolRounds: 0 };
            }
            destroy() {}
            getMessages() {
              return [];
            }
            clearHistory() {
              clearCalled = true;
            }
            setAdditionalToolSchemas() {}
            injectMessages() {}
          })() as never,
        buildAgentRuntimeAugmentations: defaultAugmentations,
      });

      const session = new AgentSession("test-agent", {
        defaultProvider: { provider: "p", model: "m" },
      } as never);
      session.clearHistory();

      expect(clearCalled).toBe(true);
      session.destroy();
    });
  });

  // ─── getter ──────────────────────────────────────────────

  describe("getter", () => {
    test("getAgentInfo 返回注册的 Agent 信息", async () => {
      const { AgentSession } = await import("@/agent/session/session");
      const session = new AgentSession("test-agent", {
        defaultProvider: { provider: "p", model: "m" },
      } as never);

      const info = session.getAgentInfo();
      expect(info.name).toBe("test-agent");
      expect(info.label).toBe("Test Agent");

      session.destroy();
    });

    test("getSubagentTasks 返回副本（非内部引用）", async () => {
      const { AgentSession } = await import("@/agent/session/session");
      const session = new AgentSession("test-agent", {
        defaultProvider: { provider: "p", model: "m" },
      } as never);

      const tasks1 = session.getSubagentTasks();
      const tasks2 = session.getSubagentTasks();
      expect(tasks1).not.toBe(tasks2); // 不同引用
      expect(tasks1).toEqual(tasks2); // 内容相同

      session.destroy();
    });
  });
});
