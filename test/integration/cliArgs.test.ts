/**
 * CLI 参数集成测试。
 *
 * 测试目标:
 *   - 验证 CLI 参数解析、依赖注入与主流程调度
 *
 * 测试用例:
 *   - 合法 CLI 参数正确解析
 *   - 非法参数返回明确错误
 *   - __setCliDepsForTesting 注入的依赖被正确消费
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { __resetCliDepsForTesting, __setCliDepsForTesting } from "@/index";
import fs from "node:fs";
import path from "node:path";

const realLogger = await import("@/core/logging/logger");

describe("CLI 参数解析与分发", () => {
  const originalEnv = { ...process.env };
  const originalCwd = process.cwd();

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.chdir(originalCwd);
    __resetCliDepsForTesting();
  });

  afterEach(() => {
    mock.restore();
    process.env = { ...originalEnv };
    process.chdir(originalCwd);
    __resetCliDepsForTesting();
  });

  test("parseCliArgs 正确解析核心 flags", async () => {
    const { parseCliArgs: pa } = await import("@/index");
    const parsed = pa([
      "--task-list",
      "--task-status",
      "task_2",
      "--task-execute",
      "task_1",
      "--plan",
      "--c-yolo",
      "--no-mcp",
      "--work-dir",
      "/tmp/crab-work",
    ]);

    expect(parsed.values["task-list"]).toBe(true);
    expect(parsed.values["task-status"]).toBe("task_2");
    expect(parsed.values["task-execute"]).toBe("task_1");
    expect(parsed.values.plan).toBe(true);
    expect(parsed.values["c-yolo"]).toBe(true);
    expect(parsed.values["no-mcp"]).toBe(true);
    expect(parsed.values["work-dir"]).toBe("/tmp/crab-work");
    expect(process.env.CRAB_RESUME_SESSION).toBeUndefined();
    expect(process.env.CRAB_YOLO_MODE).toBeUndefined();
    expect(process.env.CRAB_DEV_MODE).toBeUndefined();
  });

  test("parseCliArgs 支持 SSE daemon 批量操作参数", async () => {
    const { parseCliArgs: pa } = await import("@/index");

    const statusParsed = pa(["--sse-status", "--all"]);
    expect(statusParsed.values["sse-status"]).toBe(true);
    expect(statusParsed.values.all).toBe(true);

    const stopParsed = pa(["--sse-stop", "--all"]);
    expect(stopParsed.values["sse-stop"]).toBe(true);
    expect(stopParsed.values.all).toBe(true);
  });

  test("runCli 在默认 TUI 分支设置 c-yolo/plan/dev 环境变量", async () => {
    const renderer = {
      destroy: () => {},
      once: (_event: string, cb: () => void) => cb(),
      setTerminalTitle: () => {},
      waitForThemeMode: async () => "dark",
    };
    const createTuiApp = mock(async () => {});
    __setCliDepsForTesting({
      closeDb: () => {},
      createCliRenderer: async () => renderer as any,
      createInstanceId: () => "project-lock-id",
      createTuiApp,
      ensureMcpRuntimeStarted: async () => ({}) as any,
      initDb: () => ({}) as any,
      initTaskRuntime: () => {},
      instanceLock: {
        cleanupStaleLocks: () => 0,
        lock: () => true,
        unlock: () => {},
      } as any,
      loadConfig: async () =>
        ({
          defaultProvider: { model: "model-a", provider: "test" },
          providerConfig: { test: { apiKey: "x", requestMethod: "chat" } },
          theme: "dark",
        }) as any,
      registerCleanup: () => () => {},
      runCleanup: async () => false,
      setupGoalToolVisibility: () => {},
      startResourceMonitor: () => () => {},
    });
    const exitSpy = mock(() => {
      throw new Error("EXIT_0");
    });
    const originalExit = process.exit;
    process.exit = exitSpy;

    try {
      const mod = await import("@/index.ts");
      await expect(mod.runCli(["--c-yolo", "ses_1", "--plan", "--dev"])).rejects.toThrow("EXIT_0");
    } finally {
      process.exit = originalExit;
    }

    expect(process.env.CRAB_RESUME_SESSION).toBe("ses_1");
    expect(process.env.CRAB_INITIAL_MODE).toBe("plan");
    expect(process.env.CRAB_YOLO_MODE).toBe("1");
    expect(process.env.CRAB_DEV_MODE).toBe("1");
    expect(createTuiApp).toHaveBeenCalledTimes(1);
  });

  test("runCli --work-dir 在进入 TUI 前切换工作目录", async () => {
    const tempDir = fs.mkdtempSync(path.join(originalCwd, ".tmp-cli-workdir-"));
    const renderer = {
      destroy: () => {},
      once: (_event: string, cb: () => void) => cb(),
      setTerminalTitle: () => {},
      waitForThemeMode: async () => "dark",
    };
    let observedCwd = "";
    __setCliDepsForTesting({
      closeDb: () => {},
      createCliRenderer: async () => renderer as any,
      createInstanceId: () => "project-lock-id",
      createTuiApp: async () => {
        observedCwd = process.cwd();
      },
      ensureMcpRuntimeStarted: async () => ({}) as any,
      initDb: () => ({}) as any,
      initTaskRuntime: () => {},
      instanceLock: {
        cleanupStaleLocks: () => 0,
        lock: () => true,
        unlock: () => {},
      } as any,
      loadConfig: async () =>
        ({
          defaultProvider: { model: "model-a", provider: "test" },
          providerConfig: { test: { apiKey: "x", requestMethod: "chat" } },
          theme: "dark",
        }) as any,
      registerCleanup: () => () => {},
      runCleanup: async () => false,
      setupGoalToolVisibility: () => {},
      startResourceMonitor: () => () => {},
    });
    const exitSpy = mock(() => {
      throw new Error("EXIT_0");
    });
    const originalExit = process.exit;
    process.exit = exitSpy;

    try {
      const mod = await import("@/index.ts");
      await expect(mod.runCli(["--work-dir", tempDir])).rejects.toThrow("EXIT_0");
    } finally {
      process.exit = originalExit;
      process.chdir(originalCwd);
      fs.rmSync(tempDir, { force: true, recursive: true });
    }

    expect(observedCwd).toBe(tempDir);
  });

  test("runCli 在实例锁冲突时拒绝进入 TUI", async () => {
    const createTuiApp = mock(async () => {});
    const renderer = {
      destroy: () => {},
      once: (_event: string, cb: () => void) => cb(),
      setTerminalTitle: () => {},
      waitForThemeMode: async () => "dark",
    };
    __setCliDepsForTesting({
      closeDb: () => {},
      createCliRenderer: async () => renderer as any,
      createInstanceId: () => "project-lock-id",
      createTuiApp,
      ensureMcpRuntimeStarted: async () => ({}) as any,
      initDb: () => ({}) as any,
      initTaskRuntime: () => {},
      instanceLock: {
        cleanupStaleLocks: () => 0,
        lock: () => false,
        unlock: () => {},
      } as any,
      loadConfig: async () =>
        ({
          defaultProvider: { model: "model-a", provider: "test" },
          providerConfig: { test: { apiKey: "x", requestMethod: "chat" } },
          theme: "dark",
        }) as any,
      registerCleanup: () => () => {},
      runCleanup: async () => false,
      setupGoalToolVisibility: () => {},
      startResourceMonitor: () => () => {},
    });

    const exitSpy = mock((code?: number) => {
      throw new Error(`EXIT_${code ?? 0}`);
    });
    const originalExit = process.exit;
    const originalStderrWrite = process.stderr.write;
    const errors: string[] = [];
    process.exit = exitSpy;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      errors.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      const mod = await import("@/index.ts");
      await expect(mod.runCli([])).rejects.toThrow("EXIT_1");
    } finally {
      process.exit = originalExit;
      process.stderr.write = originalStderrWrite;
    }

    expect(createTuiApp).not.toHaveBeenCalled();
    expect(errors.some((line) => line.includes("已有实例正在运行"))).toBe(true);
  });

  test("runCli --sse-daemon 会派发后台 --sse 子进程并立即退出", async () => {
    const logs: string[] = [];
    const child = { pid: 43_210, unref: mock(() => {}), exited: { finally: () => {} } };
    const spawnProcess = mock(() => child as any);
    const exitSpy = mock((code?: number) => {
      throw new Error(`EXIT_${code ?? 0}`);
    });
    const originalExit = process.exit;
    const originalLog = console.log;
    process.exit = exitSpy;
    console.log = ((msg?: unknown) => logs.push(String(msg ?? ""))) as typeof console.log;
    __setCliDepsForTesting({
      closeDb: () => {},
      initDb: () => ({}) as any,
      setupGoalToolVisibility: () => {},
      spawnProcess: spawnProcess as any,
      waitForSseServerReady: async () => ({ port: 3015, ready: true }),
    });

    try {
      const mod = await import("@/index.ts");
      await expect(mod.runCli(["--sse-daemon", "--sse-port", "3015"])).rejects.toThrow("EXIT_0");
    } finally {
      process.exit = originalExit;
      console.log = originalLog;
    }

    expect(spawnProcess).toHaveBeenCalledTimes(1);
    const spawnArgs = (spawnProcess as any).mock.calls[0][0] as string[];
    expect(spawnArgs).toContain("--sse");
    expect(spawnArgs).not.toContain("--sse-daemon");
    expect(spawnArgs).toContain("--sse-port");
    expect(spawnArgs).toContain("3015");
    expect(child.unref).toHaveBeenCalledTimes(1);
    expect(logs.some((line) => line.includes("SSE 服务器已后台启动"))).toBe(true);
  });

  test("runCli --task-execute 作为任务 worker 兼容别名进入执行入口", async () => {
    const completeTask = mock(() => {});
    const initTaskRuntime = mock(() => {});
    mock.module("@/server/taskRunner", () => ({ completeTask }));
    mock.module("@/mission", () => ({ initTaskRuntime }));
    const { __setHeadlessDepsForTesting, __resetHeadlessDepsForTesting } = await import("@/server/headless");
    class MockConversationHandler {
      async sendMessage(prompt: string) {
        return { ok: true, text: `done:${prompt}`, usage: { inputTokens: 1, outputTokens: 2 } };
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
      ensureMcpRuntimeStarted: async () => ({}) as any,
      ensureSession: () => ({}) as any,
      getSessionMessages: () => [],
      initTaskRuntime,
      loadConfig: async () => ({ defaultProvider: { model: "model-a", provider: "test" }, providerConfig: {} }) as any,
      submitExternalPermissionRequest: async () => true,
    });
    const exitSpy = mock((code?: number) => {
      throw new Error(`EXIT_${code ?? 0}`);
    });
    const originalExit = process.exit;
    process.exit = exitSpy;

    try {
      const mod = await import("@/index.ts");
      await expect(mod.runCli(["--task-execute", "task_compat_1", "--task", "hello"])).rejects.toThrow("EXIT_0");
    } finally {
      process.exit = originalExit;
      __resetHeadlessDepsForTesting();
    }

    expect(completeTask).toHaveBeenCalledWith("task_compat_1", undefined, {
      result: "done:hello",
      sessionId: undefined,
      tokenUsage: { input: 1, output: 2 },
    });
  });

  test("runCli --ask --no-mcp 跳过 headless MCP runtime", async () => {
    const { __setHeadlessDepsForTesting, __resetHeadlessDepsForTesting } = await import("@/server/headless");
    const ensureMcpRuntimeStarted = mock(async () => ({}) as any);
    class MockConversationHandler {
      async sendMessage(prompt: string) {
        return { ok: true, text: `done:${prompt}` };
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
      ensureMcpRuntimeStarted,
      ensureSession: () => ({}) as any,
      getSessionMessages: () => [],
      initTaskRuntime: () => {},
      loadConfig: async () => ({ defaultProvider: { model: "model-a", provider: "test" }, providerConfig: {} }) as any,
      submitExternalPermissionRequest: async () => true,
      writeStderr: () => true as any,
      writeStdout: () => true as any,
    });
    const exitSpy = mock((code?: number) => {
      throw new Error(`EXIT_${code ?? 0}`);
    });
    const originalExit = process.exit;
    process.exit = exitSpy;

    try {
      const mod = await import("@/index.ts");
      await expect(mod.runCli(["--ask", "hello", "--no-mcp"])).rejects.toThrow("EXIT_0");
    } finally {
      process.exit = originalExit;
      __resetHeadlessDepsForTesting();
    }

    expect(ensureMcpRuntimeStarted).not.toHaveBeenCalled();
  });

  test("runCli --task-status 输出单个后台任务详情", async () => {
    const tempDir = fs.mkdtempSync(path.join(originalCwd, ".tmp-task-status-"));
    const taskDir = path.join(tempDir, ".crab", "tasks");
    fs.mkdirSync(taskDir, { recursive: true });
    const now = Date.now();
    fs.writeFileSync(
      path.join(taskDir, "task_status_1.json"),
      JSON.stringify({
        completedAt: now,
        createdAt: now - 1000,
        id: "task_status_1",
        prompt: "status prompt",
        result: "status result",
        sessionId: "ses_status_1",
        status: "completed",
        tokenUsage: { input: 3, output: 5 },
        updatedAt: now,
      }),
      "utf8",
    );
    process.chdir(tempDir);

    const logs: string[] = [];
    const exitSpy = mock((code?: number) => {
      throw new Error(`EXIT_${code ?? 0}`);
    });
    const originalExit = process.exit;
    const originalLog = console.log;
    process.exit = exitSpy;
    console.log = ((msg?: unknown) => logs.push(String(msg ?? ""))) as typeof console.log;
    __setCliDepsForTesting({
      closeDb: () => {},
      initDb: () => ({}) as any,
      setupGoalToolVisibility: () => {},
    });

    try {
      const mod = await import("@/index.ts");
      await expect(mod.runCli(["--task-status", "task_status_1"])).rejects.toThrow("EXIT_0");
    } finally {
      process.exit = originalExit;
      console.log = originalLog;
      process.chdir(originalCwd);
      fs.rmSync(tempDir, { force: true, recursive: true });
    }

    const output = logs.join("\n");
    expect(output).toContain("ID: task_status_1");
    expect(output).toContain("状态: completed");
    expect(output).toContain("提示词: status prompt");
    expect(output).toContain("会话: ses_status_1");
    expect(output).toContain("Token: input=3, output=5");
    expect(output).toContain("结果: status result");
  });

  test("runCli --task-status 未找到任务时以失败退出", async () => {
    const tempDir = fs.mkdtempSync(path.join(originalCwd, ".tmp-task-status-missing-"));
    process.chdir(tempDir);

    const errors: string[] = [];
    const exitSpy = mock((code?: number) => {
      throw new Error(`EXIT_${code ?? 0}`);
    });
    const originalExit = process.exit;
    const originalStderrWrite = process.stderr.write;
    process.exit = exitSpy;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      errors.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    __setCliDepsForTesting({
      closeDb: () => {},
      initDb: () => ({}) as any,
      setupGoalToolVisibility: () => {},
    });

    try {
      const mod = await import("@/index.ts");
      await expect(mod.runCli(["--task-status", "task_missing"])).rejects.toThrow("EXIT_1");
    } finally {
      process.exit = originalExit;
      process.stderr.write = originalStderrWrite;
      process.chdir(originalCwd);
      fs.rmSync(tempDir, { force: true, recursive: true });
    }

    expect(errors.join("\n")).toContain("未找到任务: task_missing");
    expect(errors.join("\n")).toContain("[USER-204]");
  });

  test("runCli --sse-port 无效时返回稳定错误码", async () => {
    const errors: string[] = [];
    const exitSpy = mock((code?: number) => {
      throw new Error(`EXIT_${code ?? 0}`);
    });
    const originalExit = process.exit;
    const originalStderrWrite = process.stderr.write;
    process.exit = exitSpy;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      errors.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    __setCliDepsForTesting({
      closeDb: () => {},
      initDb: () => ({}) as any,
      setupGoalToolVisibility: () => {},
    });

    try {
      const mod = await import("@/index.ts");
      await expect(mod.runCli(["--sse-status", "--sse-port", "not-a-port"])).rejects.toThrow("EXIT_1");
    } finally {
      process.exit = originalExit;
      process.stderr.write = originalStderrWrite;
    }

    expect(errors.join("\n")).toContain("[USER-202]");
    expect(errors.join("\n")).toContain("错误: 无效的 SSE 端口: not-a-port");
  });

  test.skip("bin/crab.ts 通过统一入口输出版本", async () => {
    const proc = Bun.spawn([process.execPath, "bin/crab.ts", "--version"], {
      cwd: process.cwd(),
      env: process.env,
      stderr: "pipe",
      stdout: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("crab v0.5.0");
  });

  test("runCli --update 在发现新版本时输出真实升级信息，而不是占位错误", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify({ version: "0.2.0" }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
    ) as unknown as typeof fetch;
    const logs: string[] = [];
    const exitSpy = mock((code?: number) => {
      throw new Error(`EXIT_${code ?? 0}`);
    });
    const originalExit = process.exit;
    const originalLog = console.log;
    process.exit = exitSpy;
    console.log = ((msg?: unknown) => logs.push(String(msg ?? ""))) as typeof console.log;

    try {
      const mod = await import("@/index.ts");
      await expect(mod.runCli(["--update"])).rejects.toThrow("EXIT_0");
    } finally {
      globalThis.fetch = originalFetch;
      process.exit = originalExit;
      console.log = originalLog;
    }

    expect(logs.some((line) => line.includes("当前版本: crab v0.5.0"))).toBe(true);
    expect(logs.some((line) => line.includes("发现新版本"))).toBe(true);
    expect(logs.some((line) => line.includes("0.2.0"))).toBe(true);
    expect(logs.some((line) => line.includes("未知错误"))).toBe(false);
  });

  test("runCli --update 在无新版本时输出已是最新版本", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify({ version: "0.5.0" }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
    ) as unknown as typeof fetch;
    const logs: string[] = [];
    const exitSpy = mock((code?: number) => {
      throw new Error(`EXIT_${code ?? 0}`);
    });
    const originalExit = process.exit;
    const originalLog = console.log;
    process.exit = exitSpy;
    console.log = ((msg?: unknown) => logs.push(String(msg ?? ""))) as typeof console.log;

    try {
      const mod = await import("@/index.ts");
      await expect(mod.runCli(["--update"])).rejects.toThrow("EXIT_0");
    } finally {
      globalThis.fetch = originalFetch;
      process.exit = originalExit;
      console.log = originalLog;
    }

    expect(logs.some((line) => line.includes("当前版本: crab v0.5.0"))).toBe(true);
    expect(logs.some((line) => line.includes("已是最新版本"))).toBe(true);
    expect(logs.some((line) => line.includes("未知错误"))).toBe(false);
  });

  test("runCli --help 输出帮助文本并退出", async () => {
    const logs: string[] = [];
    const exitSpy = mock((code?: number) => {
      throw new Error(`EXIT_${code ?? 0}`);
    });
    const originalExit = process.exit;
    const originalLog = console.log;
    process.exit = exitSpy;
    console.log = ((msg?: unknown) => logs.push(String(msg ?? ""))) as typeof console.log;

    try {
      const mod = await import("@/index.ts");
      await expect(mod.runCli(["--help"])).rejects.toThrow("EXIT_0");
    } finally {
      process.exit = originalExit;
      console.log = originalLog;
    }

    const output = logs.join("\n");
    expect(output).toContain("Crab CLI");
    expect(output).toContain("用法:");
    expect(output).toContain("选项:");
    expect(output).toContain("--ask");
    expect(output).toContain("--sse");
    expect(output).toContain("--help");
  });
});
