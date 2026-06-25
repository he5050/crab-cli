/**
 * 无头(Headless)模式集成测试。
 *
 * 测试目标:
 *   - 验证无 TUI 下的 CLI 主流程(headless)
 *
 * 测试用例:
 *   - 无头模式下的初始化与执行
 *   - mock 依赖在测试结束后被还原
 *   - 临时目录清理
 */
// @ts-nocheck
import { beforeEach, describe, expect, mock, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HeadlessRunner, __resetHeadlessDepsForTesting, __setHeadlessDepsForTesting } from "@/server/headless";

function mockDrizzleDb() {
  const runResult = { all: () => [], get: () => undefined, run: () => {} };
  return {
    delete: () => ({ ...runResult, where: () => runResult }),
    insert: () => ({ values: () => runResult }),
    select: () => ({ from: () => ({ ...runResult, where: () => runResult }) }),
    update: () => ({ set: () => ({ ...runResult, where: () => runResult }) }),
  };
}

describe("无头模式", () => {
  beforeEach(() => {
    mock.restore();
    __resetHeadlessDepsForTesting();
    delete process.env.CRAB_HEADLESS_MCP;
  });

  test("成功时写入 stdout 并在非 background 模式输出工具事件", async () => {
    const writes: { stream: "stdout" | "stderr"; text: string }[] = [];
    const completeTask = mock(() => {});
    const ensureSession = mock(() => ({}));
    const cleanIncompleteToolCalls = mock(() => 0);
    const getSessionMessages = mock(() => [
      {
        createdAt: 1,
        id: "msg-1",
        parts: [{ content: "历史用户消息", type: "text" }],
        role: "user",
        sessionId: "ses-headless-1",
      },
      {
        createdAt: 2,
        id: "msg-2",
        parts: [{ content: "历史助手回复", type: "text" }],
        role: "assistant",
        sessionId: "ses-headless-1",
      },
    ]);
    const handlerOptions: any[] = [];
    class MockConversationHandler {
      constructor(_config: unknown, options?: unknown) {
        handlerOptions.push(options);
      }
      async sendMessage() {
        const [{ globalBus }, { AppEvent }] = await Promise.all([import("@/bus"), import("@/bus/events")]);
        globalBus.publish(AppEvent.ConversationStreamToken, { content: "hello" }, { throttle: false });
        globalBus.publish(AppEvent.ConversationToolCall, { args: {}, callId: "c1", tool: "filesystem-read" });
        globalBus.publish(
          AppEvent.ToolResult,
          { callId: "c1", result: "result-data", success: true, tool: "filesystem-read" },
          { throttle: false },
        );
        await globalBus.flush();
        return {
          ok: true,
          text: "hello",
          usage: { inputTokens: 11, outputTokens: 22 },
        };
      }
      destroy() {}
      getPermissionManager() {
        return {
          destroy: () => {},
          getPromptApproval: async () => true,
          getToolApproval: async () => ({ approved: true }),
        };
      }
      setActiveSkillContext() {}
    }
    __setHeadlessDepsForTesting({
      ConversationHandler: MockConversationHandler as any,
      cleanIncompleteToolCalls,
      completeTask,
      ensureMcpRuntimeStarted: async () => {},
      ensureSession,
      getSessionMessages,
      initTaskRuntime: () => {},
      loadConfig: async () => ({ defaultProvider: { model: "model-a", provider: "test" }, providerConfig: {} }) as any,
      submitExternalPermissionRequest: async () => true,
      writeStderr: (text: string) => {
        writes.push({ stream: "stderr", text });
        return true as any;
      },
      writeStdout: (text: string) => {
        writes.push({ stream: "stdout", text });
        return true as any;
      },
    });
    const runner = new HeadlessRunner();
    await runner.run("hello", { sessionId: "ses-headless-1", taskId: "task-1" });

    expect(writes.some((w) => w.stream === "stdout" && w.text.includes("hello"))).toBe(true);
    expect(writes.some((w) => w.stream === "stderr" && w.text.includes("[工具调用] filesystem-read"))).toBe(true);
    expect(writes.some((w) => w.stream === "stderr" && w.text.includes("[工具结果] filesystem-read"))).toBe(true);
    expect(completeTask).toHaveBeenCalledWith("task-1", undefined, {
      result: "hello",
      sessionId: "ses-headless-1",
      tokenUsage: { input: 11, output: 22 },
    });
    expect(ensureSession).toHaveBeenCalledWith("ses-headless-1", {
      model: "model-a",
      projectDir: process.cwd(),
    });
    expect(cleanIncompleteToolCalls).toHaveBeenCalledWith("ses-headless-1");
    expect(getSessionMessages).toHaveBeenCalledWith("ses-headless-1");
    expect(handlerOptions[0]).toMatchObject({
      initialMessages: [
        { content: "历史用户消息", role: "user" },
        { content: "历史助手回复", role: "assistant" },
      ],
      sessionId: "ses-headless-1",
    });
  });

  test("json 输出模式不会把流式 token 混入 stdout", async () => {
    const writes: { stream: "stdout" | "stderr"; text: string }[] = [];
    class MockConversationHandler {
      async sendMessage() {
        const [{ globalBus }, { AppEvent }] = await Promise.all([import("@/bus"), import("@/bus/events")]);
        globalBus.publish(AppEvent.ConversationStreamToken, { content: "stream-prefix" }, { throttle: false });
        await globalBus.flush();
        return {
          ok: true,
          text: "final answer",
          usage: { inputTokens: 3, outputTokens: 4 },
        };
      }
      destroy() {}
      getPermissionManager() {
        return { destroy: () => {} };
      }
      setActiveSkillContext() {}
    }
    __setHeadlessDepsForTesting({
      ConversationHandler: MockConversationHandler as any,
      cleanIncompleteToolCalls: () => 0,
      completeTask: () => {},
      ensureMcpRuntimeStarted: async () => {},
      ensureSession: () => ({}),
      getSessionMessages: () => [],
      initTaskRuntime: () => {},
      loadConfig: async () => ({ defaultProvider: { model: "model-a", provider: "test" }, providerConfig: {} }) as any,
      submitExternalPermissionRequest: async () => true,
      writeStderr: (text: string) => {
        writes.push({ stream: "stderr", text });
        return true as any;
      },
      writeStdout: (text: string) => {
        writes.push({ stream: "stdout", text });
        return true as any;
      },
    });

    const runner = new HeadlessRunner();
    await runner.run("hello", { outputFormat: "json", sessionId: "ses-json" });

    const stdout = writes
      .filter((w) => w.stream === "stdout")
      .map((w) => w.text)
      .join("");
    expect(stdout).not.toContain("stream-prefix");
    const parsed = JSON.parse(stdout);
    expect(parsed).toEqual({
      sessionId: "ses-json",
      success: true,
      text: "final answer",
      usage: { inputTokens: 3, outputTokens: 4 },
    });
  });

  test("json 输出模式失败时向 stdout 写入结构化错误", async () => {
    const writes: { stream: "stdout" | "stderr"; text: string }[] = [];
    const completeTask = mock(() => {});
    class MockConversationHandler {
      async sendMessage() {
        return { error: "boom", ok: false, text: "" };
      }
      destroy() {}
      getPermissionManager() {
        return { destroy: () => {} };
      }
      setActiveSkillContext() {}
    }
    __setHeadlessDepsForTesting({
      ConversationHandler: MockConversationHandler as any,
      cleanIncompleteToolCalls: () => 0,
      completeTask,
      ensureMcpRuntimeStarted: async () => {},
      ensureSession: () => ({}),
      getSessionMessages: () => [],
      initTaskRuntime: () => {},
      loadConfig: async () => ({ defaultProvider: { model: "model-a", provider: "test" }, providerConfig: {} }) as any,
      submitExternalPermissionRequest: async () => true,
      writeStderr: (text: string) => {
        writes.push({ stream: "stderr", text });
        return true as any;
      },
      writeStdout: (text: string) => {
        writes.push({ stream: "stdout", text });
        return true as any;
      },
    });

    const runner = new HeadlessRunner();
    await expect(
      runner.run("hello", {
        outputFormat: "json",
        sessionId: "ses-json-fail",
        taskId: "task-json-fail",
      }),
    ).rejects.toThrow("boom");

    const stdout = writes
      .filter((w) => w.stream === "stdout")
      .map((w) => w.text)
      .join("");
    const parsed = JSON.parse(stdout);
    expect(parsed).toEqual({
      error: {
        code: "AGENT-504",
        message: "boom",
      },
      sessionId: "ses-json-fail",
      success: false,
    });
    expect(completeTask).toHaveBeenCalledWith("task-json-fail", "boom");
  });

  test("json 输出模式下 foreground 权限拒绝会标注不可交互原因和建议", async () => {
    const writes: { stream: "stdout" | "stderr"; text: string }[] = [];
    class MockConversationHandler {
      private options: any;
      constructor(_config: unknown, options?: unknown) {
        this.options = options;
      }
      async sendMessage() {
        const allowed = await this.options.permissionRequestHandler({
          patterns: ["npm install"],
          permission: "bash",
          tool: "terminal-execute",
        });
        return allowed === "reject"
          ? { error: 'Permission denied: user rejected tool "terminal-execute"', ok: false, text: "" }
          : { ok: true, text: "done" };
      }
      destroy() {}
      getPermissionManager() {
        return { destroy: () => {} };
      }
      setActiveSkillContext() {}
    }
    __setHeadlessDepsForTesting({
      ConversationHandler: MockConversationHandler as any,
      cleanIncompleteToolCalls: () => 0,
      completeTask: () => {},
      ensureMcpRuntimeStarted: async () => {},
      ensureSession: () => ({}),
      getSessionMessages: () => [],
      initTaskRuntime: () => {},
      loadConfig: async () => ({ defaultProvider: { model: "model-a", provider: "test" }, providerConfig: {} }) as any,
      submitExternalPermissionRequest: mock(async () => "once"),
      writeStderr: (text: string) => {
        writes.push({ stream: "stderr", text });
        return true as any;
      },
      writeStdout: (text: string) => {
        writes.push({ stream: "stdout", text });
        return true as any;
      },
    });

    const runner = new HeadlessRunner();
    await expect(
      runner.run("hello", {
        outputFormat: "json",
        sessionId: "ses-json-permission",
      }),
    ).rejects.toThrow("Permission denied");

    const stdout = writes
      .filter((w) => w.stream === "stdout")
      .map((w) => w.text)
      .join("");
    const parsed = JSON.parse(stdout);
    expect(parsed).toMatchObject({
      error: {
        code: "AGENT-504",
        reason: "non_interactive_permission",
        suggestion: expect.stringContaining("--yolo"),
      },
      sessionId: "ses-json-permission",
      success: false,
    });
  });

  test("json 输出模式下区分 headless 策略拒绝和外部用户拒绝", async () => {
    async function runCase(options: {
      runOptions: { yolo?: boolean; background?: boolean };
      permissionInput: { permission: string; tool: string; patterns: string[] };
      submitExternalPermissionRequest?: () => Promise<unknown>;
      sessionId: string;
    }) {
      const writes: { stream: "stdout" | "stderr"; text: string }[] = [];
      class MockConversationHandler {
        private handlerOptions: any;
        constructor(_config: unknown, handlerOptions?: unknown) {
          this.handlerOptions = handlerOptions;
        }
        async sendMessage() {
          const decision = await this.handlerOptions.permissionRequestHandler(options.permissionInput);
          return decision === "reject" || decision === false
            ? { error: `Permission denied for ${options.permissionInput.tool}`, ok: false, text: "" }
            : { ok: true, text: "done" };
        }
        destroy() {}
        getPermissionManager() {
          return { destroy: () => {} };
        }
        setActiveSkillContext() {}
      }

      __resetHeadlessDepsForTesting();
      __setHeadlessDepsForTesting({
        ConversationHandler: MockConversationHandler as any,
        cleanIncompleteToolCalls: () => 0,
        completeTask: () => {},
        ensureMcpRuntimeStarted: async () => {},
        ensureSession: () => ({}),
        getSessionMessages: () => [],
        initTaskRuntime: () => {},
        loadConfig: async () =>
          ({ defaultProvider: { model: "model-a", provider: "test" }, providerConfig: {} }) as any,
        submitExternalPermissionRequest: (options.submitExternalPermissionRequest ?? mock(async () => "once")) as any,
        writeStderr: (text: string) => {
          writes.push({ stream: "stderr", text });
          return true as any;
        },
        writeStdout: (text: string) => {
          writes.push({ stream: "stdout", text });
          return true as any;
        },
      });

      const runner = new HeadlessRunner();
      await expect(
        runner.run("hello", {
          ...options.runOptions,
          outputFormat: "json",
          sessionId: options.sessionId,
        }),
      ).rejects.toThrow("Permission denied");

      const stdout = writes
        .filter((w) => w.stream === "stdout")
        .map((w) => w.text)
        .join("");
      return JSON.parse(stdout);
    }

    const policyDenied = await runCase({
      permissionInput: {
        patterns: ['{"command":"rm -rf dist"}'],
        permission: "mcp.sensitive.github.exec_command",
        tool: "github_exec_command",
      },
      runOptions: { yolo: true },
      sessionId: "ses-policy-denied",
    });
    expect(policyDenied).toMatchObject({
      error: {
        reason: "policy_denied",
        suggestion: expect.stringContaining("safety policy"),
      },
    });

    const userRejected = await runCase({
      permissionInput: {
        patterns: ["npm install"],
        permission: "bash",
        tool: "terminal-execute",
      },
      runOptions: { background: true },
      sessionId: "ses-user-rejected",
      submitExternalPermissionRequest: mock(async () => "reject"),
    });
    expect(userRejected).toMatchObject({
      error: {
        reason: "user_rejected",
        suggestion: expect.stringContaining("approve"),
      },
    });
  });

  test("background 模式不输出工具事件，但失败时写错误并回填任务失败", async () => {
    const writes: { stream: "stdout" | "stderr"; text: string }[] = [];
    const completeTask = mock(() => {});
    const handlerOptions: any[] = [];
    class MockConversationHandler {
      constructor(_config: unknown, options?: unknown) {
        handlerOptions.push(options);
      }
      async sendMessage() {
        const [{ globalBus }, { AppEvent }] = await Promise.all([import("@/bus"), import("@/bus/events")]);
        globalBus.publish(AppEvent.ConversationToolCall, { args: {}, callId: "c1", tool: "bash" });
        globalBus.publish(
          AppEvent.ToolResult,
          { callId: "c1", result: "x", success: false, tool: "bash" },
          { throttle: false },
        );
        await globalBus.flush();
        return { error: "boom", ok: false, text: "" };
      }
      destroy() {}
      getPermissionManager() {
        return {
          destroy: () => {},
          getPromptApproval: async () => true,
          getToolApproval: async () => ({ approved: true }),
        };
      }
      setActiveSkillContext() {}
    }
    __setHeadlessDepsForTesting({
      ConversationHandler: MockConversationHandler as any,
      cleanIncompleteToolCalls: () => 0,
      completeTask,
      ensureMcpRuntimeStarted: async () => {},
      ensureSession: () => ({}),
      getSessionMessages: () => [],
      initTaskRuntime: () => {},
      loadConfig: async () => ({ defaultProvider: { model: "model-a", provider: "test" }, providerConfig: {} }) as any,
      submitExternalPermissionRequest: async () => true,
      writeStderr: (text: string) => {
        writes.push({ stream: "stderr", text });
        return true as any;
      },
      writeStdout: (text: string) => {
        writes.push({ stream: "stdout", text });
        return true as any;
      },
    });
    const runner = new HeadlessRunner();
    await expect(runner.run("hello", { background: true, taskId: "task-2" })).rejects.toThrow("boom");

    expect(typeof handlerOptions[0]?.permissionRequestHandler).toBe("function");
    const permissionInput = {
      patterns: ["echo background"],
      permission: "bash",
      tool: "terminal-execute",
    };
    await expect(handlerOptions[0].permissionRequestHandler(permissionInput)).resolves.toBe(true);
    expect(handlerOptions[0].permissionRequestHandler.length).toBe(1);
    expect(writes.some((w) => w.stream === "stderr" && w.text.includes("错误: boom"))).toBe(true);
    expect(writes.some((w) => w.text.includes("[工具调用]"))).toBe(false);
    expect(writes.some((w) => w.text.includes("[工具结果]"))).toBe(false);
    expect(completeTask).toHaveBeenCalledWith("task-2", "boom");
  });

  test("foreground headless permission requests reject instead of waiting for UI", async () => {
    const handlerOptions: any[] = [];
    class MockConversationHandler {
      constructor(_config: unknown, options?: unknown) {
        handlerOptions.push(options);
      }
      async sendMessage() {
        return { ok: true, text: "done" };
      }
      destroy() {}
      getPermissionManager() {
        return { destroy: () => {} };
      }
      setActiveSkillContext() {}
    }
    const submitExternalPermissionRequest = mock(async () => "once");
    __setHeadlessDepsForTesting({
      ConversationHandler: MockConversationHandler as any,
      cleanIncompleteToolCalls: () => 0,
      completeTask: () => {},
      ensureMcpRuntimeStarted: async () => {},
      ensureSession: () => ({}),
      getSessionMessages: () => [],
      initTaskRuntime: () => {},
      loadConfig: async () => ({ defaultProvider: { model: "model-a", provider: "test" }, providerConfig: {} }) as any,
      submitExternalPermissionRequest,
      writeStderr: () => true as any,
      writeStdout: () => true as any,
    });

    const runner = new HeadlessRunner();
    await runner.run("hello");

    expect(typeof handlerOptions[0]?.permissionRequestHandler).toBe("function");
    await expect(
      handlerOptions[0].permissionRequestHandler({
        patterns: ["npm install"],
        permission: "bash",
        tool: "terminal-execute",
      }),
    ).resolves.toBe("reject");
    expect(submitExternalPermissionRequest).not.toHaveBeenCalled();
  });

  test("yolo 模式在 headless 下自动批准权限请求", async () => {
    const handlerOptions: any[] = [];
    class MockConversationHandler {
      constructor(_config: unknown, options?: unknown) {
        handlerOptions.push(options);
      }
      async sendMessage() {
        return { ok: true, text: "done" };
      }
      destroy() {}
      getPermissionManager() {
        return { destroy: () => {} };
      }
      setActiveSkillContext() {}
    }
    const submitExternalPermissionRequest = mock(async () => false);
    __setHeadlessDepsForTesting({
      ConversationHandler: MockConversationHandler as any,
      cleanIncompleteToolCalls: () => 0,
      completeTask: () => {},
      ensureMcpRuntimeStarted: async () => {},
      ensureSession: () => ({}),
      getSessionMessages: () => [],
      initTaskRuntime: () => {},
      loadConfig: async () => ({ defaultProvider: { model: "model-a", provider: "test" }, providerConfig: {} }) as any,
      submitExternalPermissionRequest,
      writeStderr: () => true as any,
      writeStdout: () => true as any,
    });

    const runner = new HeadlessRunner();
    await runner.run("hello", { yolo: true });

    expect(typeof handlerOptions[0]?.permissionRequestHandler).toBe("function");
    await expect(
      handlerOptions[0].permissionRequestHandler({
        patterns: ['{"action":"add_phase"}'],
        permission: "fs.edit",
        tool: "todo-ultra",
      }),
    ).resolves.toBe("once");
    await expect(
      handlerOptions[0].permissionRequestHandler({
        patterns: ['{"command":"git push --force","__sensitive":true}'],
        permission: "bash",
        tool: "terminal-execute",
      }),
    ).resolves.toBe("reject");
    await expect(
      handlerOptions[0].permissionRequestHandler({
        patterns: ['{"command":"rm -rf dist"}'],
        permission: "mcp.sensitive.github.exec_command",
        tool: "github_exec_command",
      }),
    ).resolves.toBe("reject");
    expect(submitExternalPermissionRequest).not.toHaveBeenCalled();
  });

  test("headless 可传递最大工具调用轮次", async () => {
    const handlerOptions: any[] = [];
    class MockConversationHandler {
      constructor(_config: unknown, options?: unknown) {
        handlerOptions.push(options);
      }
      async sendMessage() {
        return { ok: true, text: "done" };
      }
      destroy() {}
      getPermissionManager() {
        return { destroy: () => {} };
      }
      setActiveSkillContext() {}
    }
    __setHeadlessDepsForTesting({
      ConversationHandler: MockConversationHandler as any,
      cleanIncompleteToolCalls: () => 0,
      completeTask: () => {},
      ensureMcpRuntimeStarted: async () => {},
      ensureSession: () => ({}),
      getSessionMessages: () => [],
      initTaskRuntime: () => {},
      loadConfig: async () => ({ defaultProvider: { model: "model-a", provider: "test" }, providerConfig: {} }) as any,
      submitExternalPermissionRequest: mock(async () => false),
      writeStderr: () => true as any,
      writeStdout: () => true as any,
    });

    const runner = new HeadlessRunner();
    await runner.run("hello", { maxToolRounds: 25 });

    expect(handlerOptions[0]).toMatchObject({ maxToolRounds: 25 });
  });

  test("headless 可显式禁用 MCP runtime 启动", async () => {
    class MockConversationHandler {
      async sendMessage() {
        return { ok: true, text: "done" };
      }
      destroy() {}
      getPermissionManager() {
        return { destroy: () => {} };
      }
      setActiveSkillContext() {}
    }
    const ensureMcpRuntimeStarted = mock(async () => {});
    __setHeadlessDepsForTesting({
      ConversationHandler: MockConversationHandler as any,
      cleanIncompleteToolCalls: () => 0,
      completeTask: () => {},
      ensureMcpRuntimeStarted,
      ensureSession: () => ({}),
      getSessionMessages: () => [],
      initTaskRuntime: () => {},
      loadConfig: async () => ({ defaultProvider: { model: "model-a", provider: "test" }, providerConfig: {} }) as any,
      submitExternalPermissionRequest: mock(async () => false),
      writeStderr: () => true as any,
      writeStdout: () => true as any,
    });

    const runner = new HeadlessRunner();
    await runner.run("hello", { mcp: "disabled" });

    expect(ensureMcpRuntimeStarted).not.toHaveBeenCalled();
  });

  test("CRAB_HEADLESS_MCP=0 会禁用 MCP runtime 启动", async () => {
    class MockConversationHandler {
      async sendMessage() {
        return { ok: true, text: "done" };
      }
      destroy() {}
      getPermissionManager() {
        return { destroy: () => {} };
      }
      setActiveSkillContext() {}
    }
    const ensureMcpRuntimeStarted = mock(async () => {});
    process.env.CRAB_HEADLESS_MCP = "0";
    __setHeadlessDepsForTesting({
      ConversationHandler: MockConversationHandler as any,
      cleanIncompleteToolCalls: () => 0,
      completeTask: () => {},
      ensureMcpRuntimeStarted,
      ensureSession: () => ({}),
      getSessionMessages: () => [],
      initTaskRuntime: () => {},
      loadConfig: async () => ({ defaultProvider: { model: "model-a", provider: "test" }, providerConfig: {} }) as any,
      submitExternalPermissionRequest: mock(async () => false),
      writeStderr: () => true as any,
      writeStdout: () => true as any,
    });

    const runner = new HeadlessRunner();
    await runner.run("hello");

    expect(ensureMcpRuntimeStarted).not.toHaveBeenCalled();
  });

  test("headless 超时时会中止正在执行的对话", async () => {
    const handlerOptions: any[] = [];
    class MockConversationHandler {
      constructor(_config: unknown, options?: unknown) {
        handlerOptions.push(options);
      }
      async sendMessage() {
        await new Promise(() => {});
      }
      destroy() {}
      getPermissionManager() {
        return { destroy: () => {} };
      }
      setActiveSkillContext() {}
    }
    __setHeadlessDepsForTesting({
      ConversationHandler: MockConversationHandler as any,
      cleanIncompleteToolCalls: () => 0,
      completeTask: () => {},
      ensureMcpRuntimeStarted: async () => {},
      ensureSession: () => ({}),
      getSessionMessages: () => [],
      initTaskRuntime: () => {},
      loadConfig: async () => ({ defaultProvider: { model: "model-a", provider: "test" }, providerConfig: {} }) as any,
      submitExternalPermissionRequest: mock(async () => false),
      writeStderr: () => true as any,
      writeStdout: () => true as any,
    });

    const runner = new HeadlessRunner();
    await expect(runner.run("hello", { timeout: 5 })).rejects.toThrow("执行超时 (5ms)");

    expect(handlerOptions[0]?.abortSignal).toBeDefined();
    expect(handlerOptions[0].abortSignal.aborted).toBe(true);
  });

  test("headless 会注入项目 ROLE.md prompt role 且保留显式 maxToolRounds 优先级", async () => {
    const originalCwd = process.cwd();
    const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), "crab-headless-role-"));
    fs.mkdirSync(path.join(tempProject, ".crab"), { recursive: true });
    fs.writeFileSync(
      path.join(tempProject, ".crab", "ROLE.md"),
      "# Headless Role\n\n必须在回答中包含 HEADLESS_ROLE_SENTINEL_7421。",
      "utf8",
    );

    const handlerOptions: any[] = [];
    class MockConversationHandler {
      constructor(_config: unknown, options?: unknown) {
        handlerOptions.push(options);
      }
      async sendMessage() {
        return { ok: true, text: "done" };
      }
      destroy() {}
      getPermissionManager() {
        return { destroy: () => {} };
      }
      setActiveSkillContext() {}
    }

    __setHeadlessDepsForTesting({
      ConversationHandler: MockConversationHandler as any,
      cleanIncompleteToolCalls: () => 0,
      completeTask: () => {},
      ensureMcpRuntimeStarted: async () => {},
      ensureSession: () => ({}),
      getSessionMessages: () => [],
      initTaskRuntime: () => {},
      loadConfig: async () =>
        ({
          defaultProvider: { model: "model-a", provider: "test" },
          maxToolRounds: 9,
          providerConfig: {},
        }) as any,
      submitExternalPermissionRequest: mock(async () => false),
      writeStderr: () => true as any,
      writeStdout: () => true as any,
    });

    try {
      process.chdir(tempProject);
      const runner = new HeadlessRunner();
      await runner.run("hello", { maxToolRounds: 25 });
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tempProject, { force: true, recursive: true });
    }

    expect(handlerOptions[0]?.systemPrompt).toContain("HEADLESS_ROLE_SENTINEL_7421");
    expect(handlerOptions[0]?.maxToolRounds).toBe(25);
  });
});
