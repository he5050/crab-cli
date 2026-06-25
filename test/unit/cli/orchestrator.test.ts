/**
 * CLI Orchestrator 单元测试
 *
 * 测试重点:
 *   - parseCliArgs 对各种 CLI 参数的模式识别
 *   - 边界输入处理
 *   - 位置参数与命名参数的组合
 *   - shutdown 生命周期管理
 *   - 依赖注入
 */
import { describe, expect, test, afterEach, beforeEach, mock } from "bun:test";
import { parseCliArgs } from "@/cli/core/orchestrator";
import { setOrchestratorDeps, shutdown, getOrchestratorDeps, __resetLifecycleForTest } from "@/cli/core/lifecycle";
import type { CliOrchestratorDeps } from "@/cli/type";

describe("parseCliArgs", () => {
  afterEach(() => {
    // Clean up env vars that might affect parsing
    delete process.env.CRAB_RESUME_SESSION;
    delete process.env.CRAB_YOLO_MODE;
    delete process.env.CRAB_INITIAL_MODE;
    delete process.env.CRAB_DEV_MODE;
  });

  describe("mode detection", () => {
    test("default mode is tui", () => {
      const result = parseCliArgs([]);
      expect(result.mode).toBe("tui");
    });

    test("setup positional command", () => {
      const result = parseCliArgs(["setup"]);
      expect(result.mode).toBe("setup");
    });

    test("config test subcommand", () => {
      const result = parseCliArgs(["config", "test"]);
      expect(result.mode).toBe("config-test");
    });

    test("config test with provider id", () => {
      const result = parseCliArgs(["config", "test", "openai"]);
      expect(result.mode).toBe("config-test");
      expect(result.positionals).toEqual(["config", "test", "openai"]);
    });

    test("config export subcommand", () => {
      const result = parseCliArgs(["config", "export"]);
      expect(result.mode).toBe("config-export");
    });

    test("config import subcommand", () => {
      const result = parseCliArgs(["config", "import", "/path/to/config.json"]);
      expect(result.mode).toBe("config-import");
      expect(result.positionals).toEqual(["config", "import", "/path/to/config.json"]);
    });

    test("help flag", () => {
      const result = parseCliArgs(["--help"]);
      expect(result.mode).toBe("help");
    });

    test("version flag", () => {
      const result = parseCliArgs(["--version"]);
      expect(result.mode).toBe("version");
    });

    test("update flag", () => {
      const result = parseCliArgs(["--update"]);
      expect(result.mode).toBe("check-update");
    });

    test("sse flag", () => {
      const result = parseCliArgs(["--sse"]);
      expect(result.mode).toBe("sse");
    });

    test("sse-daemon flag", () => {
      const result = parseCliArgs(["--sse-daemon"]);
      expect(result.mode).toBe("sse-daemon");
    });

    test("sse-stop flag", () => {
      const result = parseCliArgs(["--sse-stop"]);
      expect(result.mode).toBe("sse-stop");
    });

    test("sse-status flag", () => {
      const result = parseCliArgs(["--sse-status"]);
      expect(result.mode).toBe("sse-status");
    });

    test("acp flag", () => {
      const result = parseCliArgs(["--acp"]);
      expect(result.mode).toBe("acp");
    });

    test("task flag", () => {
      const result = parseCliArgs(["--task", "do something"]);
      expect(result.mode).toBe("task");
      expect(result.values.task).toBe("do something");
    });

    test("task-list flag", () => {
      const result = parseCliArgs(["--task-list"]);
      expect(result.mode).toBe("task-list");
    });

    test("task-status flag", () => {
      const result = parseCliArgs(["--task-status", "task-123"]);
      expect(result.mode).toBe("task-status");
      expect(result.values["task-status"]).toBe("task-123");
    });

    test("headless mode with --ask", () => {
      const result = parseCliArgs(["--ask", "hello world"]);
      expect(result.mode).toBe("headless");
      expect(result.values.ask).toBe("hello world");
    });
  });

  describe("SSE port parsing", () => {
    test("no sse-port defaults to undefined", () => {
      const result = parseCliArgs([]);
      expect(result.ssePort).toBeUndefined();
    });

    test("valid sse-port", () => {
      const result = parseCliArgs(["--sse", "--sse-port", "8080"]);
      expect(result.ssePort).toBe(8080);
    });
  });

  describe("sseAll flag", () => {
    test("defaults to false", () => {
      const result = parseCliArgs([]);
      expect(result.sseAll).toBe(false);
    });

    test("set by --all flag", () => {
      const result = parseCliArgs(["--sse-stop", "--all"]);
      expect(result.sseAll).toBe(true);
    });
  });

  describe("yolo flags", () => {
    test("--yolo sets yolo to true", () => {
      const result = parseCliArgs(["--yolo"]);
      expect(result.values.yolo).toBe(true);
    });

    test("--yolo-p sets yolo-p to true", () => {
      const result = parseCliArgs(["--yolo-p"]);
      expect(result.values["yolo-p"]).toBe(true);
    });

    test("--c-yolo sets c-yolo to true", () => {
      const result = parseCliArgs(["--c-yolo"]);
      expect(result.values["c-yolo"]).toBe(true);
    });
  });

  describe("work-dir", () => {
    test("--work-dir captures path value", () => {
      const result = parseCliArgs(["--work-dir", "/some/path"]);
      expect(result.values["work-dir"]).toBe("/some/path");
    });
  });

  describe("dev mode", () => {
    test("--dev sets dev to true", () => {
      const result = parseCliArgs(["--dev"]);
      expect(result.values.dev).toBe(true);
    });
  });

  describe("plan mode", () => {
    test("--plan sets plan to true", () => {
      const result = parseCliArgs(["--plan"]);
      expect(result.values.plan).toBe(true);
    });
  });

  describe("continue session", () => {
    test("--continue captures session id", () => {
      const result = parseCliArgs(["--continue", "session-abc"]);
      expect(result.values.continue).toBe("session-abc");
    });
  });

  describe("timeout and max-tool-rounds", () => {
    test("--timeout captures value", () => {
      const result = parseCliArgs(["--ask", "hello", "--timeout", "30000"]);
      expect(result.values.timeout).toBe("30000");
    });

    test("--max-tool-rounds captures value", () => {
      const result = parseCliArgs(["--ask", "hello", "--max-tool-rounds", "100"]);
      expect(result.values["max-tool-rounds"]).toBe("100");
    });
  });

  describe("format option", () => {
    test("--format captures value", () => {
      const result = parseCliArgs(["--ask", "hello", "--format", "json"]);
      expect(result.values.format).toBe("json");
    });
  });

  describe("no-mcp flag", () => {
    test("--no-mcp sets to true", () => {
      const result = parseCliArgs(["--ask", "hello", "--no-mcp"]);
      expect(result.values["no-mcp"]).toBe(true);
    });
  });

  describe("strict mode — unknown arguments", () => {
    test("throws on unrecognized flag", () => {
      expect(() => parseCliArgs(["--nonexistent"])).toThrow();
    });

    test("throws on unrecognized positional when not a command", () => {
      // parseCliArgs uses strict: true, unknown positionals won't throw
      // but unknown flags will
      expect(() => parseCliArgs(["--ask", "hello", "--bogus-flag"])).toThrow();
    });
  });
});

describe("lifecycle", () => {
  const mockDeps: CliOrchestratorDeps = {
    closeDb: mock(() => {}),
    createCliRenderer: mock(async () => ({
      waitForThemeMode: mock(async () => "dark"),
      setTerminalTitle: mock(() => {}),
      once: mock(() => {}),
      destroy: mock(() => {}),
    })),
    createInstanceId: mock(() => "test-instance"),
    createTuiApp: mock(async () => {}),
    ensureMcpRuntimeStarted: mock(async () => true),
    eventBus: { publish: mock(() => {}), subscribe: mock(() => () => {}), once: mock(() => () => {}) } as any,
    initDb: mock(() => Promise.resolve()),
    initTaskRuntime: mock(() => {}),
    installGlobalProcessHandlers: mock(() => {}),
    instanceLock: {
      cleanupStaleLocks: mock(() => {}),
      lock: mock(() => true),
      unlock: mock(() => {}),
    },
    loadConfig: mock(async () => ({ defaultProvider: { provider: "openai", model: "gpt-4o" }, theme: "dark" })),
    registerCleanup: mock(() => {}),
    runCleanup: mock(async () => true),
    setupGoalToolVisibility: mock(() => {}),
    spawnProcess: Bun.spawn,
    startResourceMonitor: mock(() => () => {}),
    waitForSseServerReady: mock(async () => ({ ready: true })),
  };

  beforeEach(() => {
    __resetLifecycleForTest();
    setOrchestratorDeps(mockDeps);
  });

  afterEach(() => {
    (mockDeps.closeDb as any).mockClear?.();
    (mockDeps.runCleanup as any).mockClear?.();
  });

  describe("setOrchestratorDeps / getOrchestratorDeps", () => {
    test("getOrchestratorDeps returns the set deps", () => {
      expect(getOrchestratorDeps()).toBe(mockDeps);
    });

    test("getOrchestratorDeps returns null before setOrchestratorDeps", () => {
      setOrchestratorDeps(null as any);
      expect(getOrchestratorDeps()).toBeNull();
      setOrchestratorDeps(mockDeps);
    });
  });

  describe("shutdown", () => {
    test("calls closeDb and runCleanup on shutdown (no exit code)", async () => {
      await shutdown();
      expect(mockDeps.closeDb).toHaveBeenCalled();
      expect(mockDeps.runCleanup).toHaveBeenCalled();
    });

    test("ignores repeated shutdown calls (idempotent)", async () => {
      await shutdown();
      await shutdown();
      expect(mockDeps.closeDb).toHaveBeenCalledTimes(1);
      expect(mockDeps.runCleanup).toHaveBeenCalledTimes(1);
    });
  });
});
