/**
 * Agent session 高级测试。
 *
 * 测试目标:
 *   - 验证 agent session 流程在高级场景下的行为:注册、激活、subAgent 追踪等
 *
 * 测试用例:
 *   - _resetAll/initBuiltinAgents/registerAgent/setActiveAgent 的协作
 *   - subAgentTracker 跟踪子代理状态
 */
// @ts-nocheck
import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  _resetAll,
  AgentSession,
  __resetAgentSessionDepsForTesting,
  __setAgentSessionDepsForTesting,
  initBuiltinAgents,
  registerAgent,
  setActiveAgent,
  subAgentTracker,
} from "@/agent";
import { _resetAllStatus } from "@/session/state";

const config = {
  agents: [],
  customHeaders: {},
  defaultProvider: {
    model: "gpt-4",
    provider: "openai",
  },
  devMode: false,
  maxContextTokens: 200_000,
  maxSpawnDepth: 3,
  permissions: [],
  profile: "default",
  providerConfig: {},
  proxy: { browserDebugPort: 9222, enabled: false, port: 7890, searchEngine: "duckduckgo" },
  sensitiveCommands: { commands: [], enabled: true },
  theme: "dark",
  toolResultTokenLimitPercent: 30,
};

function resetTracker() {
  subAgentTracker.clear();
}

describe("AgentSession advanced flows", () => {
  beforeEach(() => {
    mock.restore();
    resetTracker();
    _resetAll();
    _resetAllStatus();
    initBuiltinAgents();
    registerAgent({
      description: "test agent",
      label: "Session Advanced",
      mode: "primary",
      name: "session-advanced",
      options: {},
      prompt: "test",
    });
    setActiveAgent("general");
  });

  test("sendMessage appends spawned child summaries and continues the conversation", async () => {
    const handlerInstances: any[] = [];
    const mod = await import("@/agent/session/session.ts");
    mod.__setAgentSessionDepsForTesting({
      ConversationHandler: class {
        calls: string[] = [];
        constructor(_cfg: unknown, options: unknown) {
          this.options = options;
          handlerInstances.push(this);
        }
        async sendMessage(content: string) {
          this.calls.push(content);
          if (this.calls.length === 1) {
            return { ok: true, reasoning: "r1", text: "initial", toolRounds: 1 };
          }
          return { ok: true, reasoning: "r2", text: "continued", toolRounds: 2 };
        }
        destroy() {}
        clearHistory() {}
        getMessages() {
          return [];
        }
        setAdditionalToolSchemas() {}
      } as any,
    });

    const { AgentSession } = mod;
    const session = new AgentSession("session-advanced", config, { instanceId: "parent-instance" });
    (session as any).spawnedChildInstanceIds.add("child-instance");
    subAgentTracker.storeSpawnedResult({
      agentId: "review",
      agentName: "Review Agent",
      completedAt: new Date(),
      instanceId: "child-instance",
      prompt: "review code",
      result: "child result body",
      success: true,
    });

    const result = await session.sendMessage("parent prompt");
    const handler = handlerInstances[0];

    expect(result.ok).toBe(true);
    expect(result.text).toBe("continued");
    expect(result.toolRounds).toBe(3);
    expect(handler.calls).toHaveLength(2);
    expect(handler.calls[1]).toContain("[SPAWNED CHILDREN RESULTS]");
    expect(handler.calls[1]).toContain("child result body");

    session.destroy();
  });

  test("createToolContext 支持 askUser 与已派生子代理生命周期辅助函数", async () => {
    const handlerInstances: any[] = [];
    const mod = await import("@/agent/session/session.ts");
    mod.__setAgentSessionDepsForTesting({
      ConversationHandler: class {
        constructor(_cfg: unknown, options: unknown) {
          this.options = options;
          handlerInstances.push(this);
        }
        async sendMessage() {
          return { ok: true, text: "child ok", toolRounds: 1 };
        }
        destroy() {}
        clearHistory() {}
        getMessages() {
          return [];
        }
        setAdditionalToolSchemas() {}
      } as any,
    });

    const { AgentSession } = mod;
    const noAskSession = new AgentSession("session-advanced", config);
    const noAskContext = handlerInstances[0].options.getToolContext();
    await expect(noAskContext.askUser({ question: "q" })).rejects.toThrow("当前环境不支持用户交互");
    noAskSession.destroy();

    const askSession = new AgentSession("session-advanced", config, {
      askUserCallback: async () => ({ selected: ["A", "B"] }),
    });
    const toolContext = handlerInstances[1].options.getToolContext();
    const askResult = await toolContext.askUser({
      multiSelect: true,
      options: [{ label: "A" }, { label: "B" }],
      question: "pick",
    });
    expect(askResult).toBe("A, B");

    toolContext.spawnSubagent({
      agentId: "review",
      agentName: "Review Agent",
      name: "Review Agent",
      prompt: "review prompt",
    });
    expect(toolContext.listSubagents().length).toBeGreaterThanOrEqual(1);
    const running = toolContext.listSubagents()[0];
    expect(toolContext.getSubagentStatus(running.agentId)?.status).toBe("running");
    toolContext.stopSubagent(running.agentId);
    expect(toolContext.getSubagentStatus(running.agentId)).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 20));
    askSession.destroy();
  });

  test("sendMessage 返回结构化失败当处理器抛出", async () => {
    const mod = await import("@/agent/session/session.ts");
    mod.__setAgentSessionDepsForTesting({
      ConversationHandler: class {
        async sendMessage() {
          throw new Error("handler exploded");
        }
        destroy() {}
        clearHistory() {}
        getMessages() {
          return [];
        }
        setAdditionalToolSchemas() {}
      } as any,
    });

    const { AgentSession } = mod;
    const session = new AgentSession("session-advanced", config);
    const result = await session.sendMessage("boom");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("handler exploded");
    expect(session.getStatus()).toBe("error");

    session.destroy();
  });

  test("sendMessage 会同步 session runtime 状态", async () => {
    let release!: (value: { ok: boolean; text: string; toolRounds: number }) => void;
    const blocked = new Promise<{ ok: boolean; text: string; toolRounds: number }>((resolve) => {
      release = resolve;
    });

    const mod = await import("@/agent/session/session.ts");
    mod.__setAgentSessionDepsForTesting({
      ConversationHandler: class {
        async sendMessage() {
          return blocked;
        }
        destroy() {}
        clearHistory() {}
        getMessages() {
          return [];
        }
        setAdditionalToolSchemas() {}
      } as any,
    });

    const session = new AgentSession("session-advanced", config, { sessionId: "ses_agent_runtime" });
    const pending = session.sendMessage("runtime bridge");

    await new Promise((resolve) => setTimeout(resolve, 0));
    // While waiting for the handler response, session status is "running"
    expect(session.getStatus()).toBe("running");

    release({ ok: true, text: "ok", toolRounds: 1 });
    const result = await pending;

    expect(result.ok).toBe(true);
    expect(session.getStatus()).toBe("completed");
    session.destroy();
  });

  test("sendMessage 失败时同步 session runtime error，destroy 重置为 idle", async () => {
    const mod = await import("@/agent/session/session.ts");
    mod.__setAgentSessionDepsForTesting({
      ConversationHandler: class {
        async sendMessage() {
          throw new Error("handler exploded");
        }
        destroy() {}
        clearHistory() {}
        getMessages() {
          return [];
        }
        setAdditionalToolSchemas() {}
      } as any,
    });

    const session = new AgentSession("session-advanced", config, { sessionId: "ses_agent_reset" });
    const result = await session.sendMessage("boom");

    expect(result.ok).toBe(false);
    expect(session.getStatus()).toBe("error");

    session.clearHistory();
    // clearHistory does not reset session status; it only clears conversation history
    expect(session.getStatus()).toBe("error");

    session.destroy();
    // destroy resets session status to idle
    expect(session.getStatus()).toBe("idle");
  });

  test("sendMessage waits for running child and consumes orphaned failure results", async () => {
    const handlerInstances: any[] = [];
    const mod = await import("@/agent/session/session.ts");
    mod.__setAgentSessionDepsForTesting({
      ConversationHandler: class {
        calls: string[] = [];
        constructor() {
          handlerInstances.push(this);
        }
        async sendMessage(content: string) {
          this.calls.push(content);
          if (this.calls.length === 1) {
            return { ok: true, text: "initial", toolRounds: 1 };
          }
          return { ok: true, text: "after orphan", toolRounds: 1 };
        }
        destroy() {}
        clearHistory() {}
        getMessages() {
          return [];
        }
        setAdditionalToolSchemas() {}
      } as any,
    });

    const { AgentSession } = mod;
    const session = new AgentSession("session-advanced", config, { instanceId: "parent-orphan" });
    (session as any).spawnedChildInstanceIds.add("child-running");
    subAgentTracker.register({
      abortController: new AbortController(),
      agentId: "review",
      agentName: "Review Agent",
      instanceId: "child-running",
      prompt: "pending",
    });
    setTimeout(() => {
      subAgentTracker.unregister("child-running");
      subAgentTracker.storeSpawnedResult({
        agentId: "review",
        agentName: "Review Agent",
        completedAt: new Date(),
        error: "child failed",
        instanceId: "child-running",
        prompt: "pending",
        result: "",
        success: false,
      });
    }, 10);

    const result = await session.sendMessage("parent prompt");
    const handler = handlerInstances[0];

    expect(result.ok).toBe(true);
    expect(result.text).toBe("after orphan");
    expect(handler.calls[1]).toContain("error:\nchild failed");

    session.destroy();
  });

  test("spawnSubagent resumes failed child when SubAgentStop hook injects continuation", async () => {
    const hookExecutorMock = {
      subAgentStart: mock(async () => []),
      subAgentStop: mock(async () => [
        {
          decision: {
            action: "inject",
            message: "retry with more context",
            shouldContinueConversation: true,
          },
          success: true,
        },
      ]),
      userMessage: mock(async () => []),
    };

    let callCount = 0;
    __setAgentSessionDepsForTesting({
      ConversationHandler: class {
        async sendMessage() {
          callCount++;
          if (callCount === 1) {
            return { durationMs: 5, error: "first failure", ok: false, text: "", toolRounds: 1 };
          }
          return { durationMs: 7, ok: true, text: "recovered", toolRounds: 2 };
        }
        destroy() {}
        clearHistory() {}
        getMessages() {
          return [];
        }
        setAdditionalToolSchemas() {}
      } as any,
      hookExecutor: hookExecutorMock as any,
    });

    const session = new AgentSession("session-advanced", config);
    const result = await session.spawnSubagent("review", "review prompt");

    expect(result.ok).toBe(true);
    expect(result.text).toBe("recovered");
    expect(result.toolRounds).toBe(3);
    expect(hookExecutorMock.subAgentStop).toHaveBeenCalled();
    expect(session.getSubagentTasks()[0]?.status).toBe("completed");

    session.destroy();
    __resetAgentSessionDepsForTesting();
  });
});
