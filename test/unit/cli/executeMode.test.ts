/**
 * executeMode 分发测试
 *
 * 测试重点:
 *   - 每种模式正确调用对应的命令/函数
 *   - process.exit 被正确调用
 *   - 参数正确传递
 */
import { describe, expect, test, afterEach, beforeEach, mock, spyOn } from "bun:test";
import { setOrchestratorDeps } from "@/cli/core/lifecycle";
import { executeMode } from "@/cli/core/orchestrator";
import type { CliOrchestratorDeps, ParsedCliArgs } from "@/cli/type";

const mockDeps: CliOrchestratorDeps = {
  initDb: mock(() => Promise.resolve()),
  setupGoalToolVisibility: mock(() => {}),
  loadConfig: mock(async () => ({ defaultProvider: { provider: "openai", model: "gpt-4o" }, providerConfig: {} })),
  createTuiApp: mock(async () => {}),
  createCliRenderer: mock(async () => ({
    waitForThemeMode: mock(async () => "dark"),
    once: mock(() => {}),
    destroy: mock(() => {}),
    setTerminalTitle: mock(() => {}),
  })),
  createInstanceId: mock(() => "test-instance"),
  instanceLock: { lock: mock(() => true), cleanupStaleLocks: mock(() => {}), unlock: mock(() => {}) },
  startResourceMonitor: mock(() => () => {}),
  ensureMcpRuntimeStarted: mock(async () => true),
  initTaskRuntime: mock(() => {}),
  runCleanup: mock(async () => true),
  closeDb: mock(() => {}),
  spawnProcess: mock(
    () =>
      ({
        pid: 1234,
        unref: mock(() => {}),
        exited: { finally: mock(() => {}) },
        stdout: null,
        stderr: null,
      }) as any,
  ),
  waitForSseServerReady: mock(async () => ({ ready: true, port: 3000 })),
  registerCleanup: mock(() => {}),
  eventBus: {} as any,
  installGlobalProcessHandlers: mock(() => {}),
};

let exitSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  setOrchestratorDeps(mockDeps);
  exitSpy = spyOn(process, "exit").mockImplementation((() => {}) as never);
});

afterEach(() => {
  exitSpy.mockRestore();
  (mockDeps.initDb as any).mockClear?.();
  (mockDeps.setupGoalToolVisibility as any).mockClear?.();
  (mockDeps.loadConfig as any).mockClear?.();
});

describe("executeMode dispatch", () => {
  describe("config commands", () => {
    test("config-test mode calls configTestCommand with providerId", async () => {
      const configTestSpy = spyOn(await import("@/command/config/test"), "configTestCommand").mockResolvedValue(
        undefined,
      );

      const parsed: ParsedCliArgs = {
        mode: "config-test",
        positionals: ["config", "test", "openai"],
        values: {},
        sseAll: false,
      };

      await executeMode(parsed);

      expect(configTestSpy).toHaveBeenCalledWith("openai");
    });

    test("config-export mode calls configExportCommand with options", async () => {
      const configExportSpy = spyOn(await import("@/command/config/export"), "configExportCommand").mockResolvedValue(
        undefined,
      );

      const parsed: ParsedCliArgs = {
        mode: "config-export",
        positionals: ["config", "export"],
        values: { output: "/tmp/out.json", sanitize: true, format: "json" },
        sseAll: false,
      };

      await executeMode(parsed);

      expect(configExportSpy).toHaveBeenCalledWith({
        output: "/tmp/out.json",
        sanitize: true,
        format: "json",
      });
    });

    test("config-export mode without flags calls with defaults", async () => {
      const configExportSpy = spyOn(await import("@/command/config/export"), "configExportCommand").mockResolvedValue(
        undefined,
      );

      const parsed: ParsedCliArgs = {
        mode: "config-export",
        positionals: ["config", "export"],
        values: {},
        sseAll: false,
      };

      await executeMode(parsed);

      expect(configExportSpy).toHaveBeenCalledWith({
        format: "pretty",
        output: undefined,
        sanitize: false,
      });
    });

    test("config-import mode calls configImportCommand with path and options", async () => {
      const configImportSpy = spyOn(await import("@/command/config/import"), "configImportCommand").mockResolvedValue(
        undefined,
      );

      const parsed: ParsedCliArgs = {
        mode: "config-import",
        positionals: ["config", "import", "/tmp/test.json"],
        values: { force: true, "no-merge": true },
        sseAll: false,
      };

      await executeMode(parsed);

      expect(configImportSpy).toHaveBeenCalledWith("/tmp/test.json", {
        force: true,
        merge: false,
      });
    });

    test("config-import mode without flags calls with defaults", async () => {
      const configImportSpy = spyOn(await import("@/command/config/import"), "configImportCommand").mockResolvedValue(
        undefined,
      );

      const parsed: ParsedCliArgs = {
        mode: "config-import",
        positionals: ["config", "import", "/tmp/test.json"],
        values: {},
        sseAll: false,
      };

      await executeMode(parsed);

      expect(configImportSpy).toHaveBeenCalledWith("/tmp/test.json", {
        force: false,
        merge: true,
      });
    });

    test("config-import mode without path exits with error", async () => {
      const parsed: ParsedCliArgs = {
        mode: "config-import",
        positionals: ["config", "import"],
        values: {},
        sseAll: false,
      };

      try {
        await executeMode(parsed);
      } catch {
        /* exitWithError mocked, execution may continue and throw */
      }
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe("simple exit modes", () => {
    test("help mode prints help and exits", async () => {
      const printHelpSpy = spyOn(await import("@/cli/help"), "printHelp").mockImplementation(() => {});

      const parsed: ParsedCliArgs = {
        mode: "help",
        positionals: [],
        values: { help: true },
        sseAll: false,
      };

      await executeMode(parsed);

      expect(printHelpSpy).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    test("version mode prints version and exits", async () => {
      const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

      const parsed: ParsedCliArgs = {
        mode: "version",
        positionals: [],
        values: { version: true },
        sseAll: false,
      };

      await executeMode(parsed);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("crab v"));
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    test("check-update mode checks for updates and exits", async () => {
      const checkForUpdateSpy = spyOn(await import("@/core/update"), "checkForUpdate").mockResolvedValue(null);
      spyOn(console, "log").mockImplementation(() => {});

      const parsed: ParsedCliArgs = {
        mode: "check-update",
        positionals: [],
        values: { update: true },
        sseAll: false,
      };

      await executeMode(parsed);

      expect(checkForUpdateSpy).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(0);
    });
  });

  describe("setup mode", () => {
    test("setup mode calls setupCommand", async () => {
      const setupSpy = spyOn(await import("@/command/config/setup"), "setupCommand").mockResolvedValue(undefined);

      const parsed: ParsedCliArgs = {
        mode: "setup",
        positionals: ["setup"],
        values: {},
        sseAll: false,
      };

      await executeMode(parsed);

      expect(setupSpy).toHaveBeenCalled();
    });
  });

  describe("SSE modes", () => {
    test("sse-daemon mode calls sseDaemonMode with deps", async () => {
      const sseDaemonSpy = spyOn(await import("@/server/sseModes"), "sseDaemonMode").mockResolvedValue(undefined);

      const parsed: ParsedCliArgs = {
        mode: "sse-daemon",
        positionals: [],
        values: { "sse-daemon": true },
        ssePort: 3000,
        sseAll: false,
      };

      await executeMode(parsed);

      expect(sseDaemonSpy).toHaveBeenCalled();
    });

    test("sse mode calls sseMode", async () => {
      const sseModeSpy = spyOn(await import("@/server/sseModes"), "sseMode").mockResolvedValue(undefined);

      const parsed: ParsedCliArgs = {
        mode: "sse",
        positionals: [],
        values: { sse: true },
        ssePort: 3000,
        sseAll: false,
      };

      await executeMode(parsed);

      expect(sseModeSpy).toHaveBeenCalledWith(false, 3000);
    });

    test("sse-stop mode calls sseStopMode", async () => {
      const sseStopSpy = spyOn(await import("@/server/sseModes"), "sseStopMode").mockResolvedValue(undefined);

      const parsed: ParsedCliArgs = {
        mode: "sse-stop",
        positionals: [],
        values: { "sse-stop": true },
        ssePort: undefined,
        sseAll: true,
      };

      await executeMode(parsed);

      expect(sseStopSpy).toHaveBeenCalled();
    });

    test("sse-status mode calls sseStatusMode", async () => {
      const sseStatusSpy = spyOn(await import("@/server/sseModes"), "sseStatusMode").mockResolvedValue(undefined);

      const parsed: ParsedCliArgs = {
        mode: "sse-status",
        positionals: [],
        values: { "sse-status": true },
        ssePort: undefined,
        sseAll: false,
      };

      await executeMode(parsed);

      expect(sseStatusSpy).toHaveBeenCalled();
    });
  });

  describe("acp mode", () => {
    test("acp mode starts stdio", async () => {
      const acpSpy = spyOn(await import("@/server/acpStdio"), "startAcpStdio").mockResolvedValue(undefined);

      const parsed: ParsedCliArgs = {
        mode: "acp",
        positionals: [],
        values: { acp: true },
        sseAll: false,
      };

      await executeMode(parsed);

      expect(acpSpy).toHaveBeenCalled();
    });
  });

  describe("task modes", () => {
    test("task-list mode lists tasks and exits", async () => {
      const listTasksSpy = spyOn(await import("@/server/taskRunner"), "listTasks").mockResolvedValue([]);
      const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

      const parsed: ParsedCliArgs = {
        mode: "task-list",
        positionals: [],
        values: { "task-list": true },
        sseAll: false,
      };

      await executeMode(parsed);

      expect(listTasksSpy).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    test("task-status mode gets task and exits on not found", async () => {
      const getTaskSpy = spyOn(await import("@/server/taskRunner"), "getTask").mockReturnValue(undefined);

      const parsed: ParsedCliArgs = {
        mode: "task-status",
        positionals: [],
        values: { "task-status": "task-123" },
        sseAll: false,
      };

      try {
        await executeMode(parsed);
      } catch {
        /* exitWithError mocked, execution may continue and throw */
      }
      expect(getTaskSpy).toHaveBeenCalledWith("task-123");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    test("task-worker mode creates HeadlessRunner and runs", async () => {
      const mockRun = mock(async () => {});
      const mockConstructor = mock(() => ({ run: mockRun })) as any;
      const originalModule = await import("@/server/headless");
      const headlessSpy = spyOn(originalModule, "HeadlessRunner") as any;
      headlessSpy.mockImplementation(mockConstructor);

      const parsed: ParsedCliArgs = {
        mode: "task-worker",
        positionals: [],
        values: { "task-runner-id": "task-123", task: "do work" },
        sseAll: false,
      };

      await executeMode(parsed);

      expect(headlessSpy).toHaveBeenCalled();
      expect(mockRun).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    test("task mode spawns child process and exits", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const registerTaskSpy: any = spyOn(await import("@/server/taskRunner"), "registerTask");
      spyOn(await import("@/core/identity"), "createId").mockReturnValue("task-abc");

      const parsed: ParsedCliArgs = {
        mode: "task",
        positionals: [],
        values: { task: "do something" },
        sseAll: false,
      };

      await executeMode(parsed);

      expect(registerTaskSpy).toHaveBeenCalledWith("task-abc", "do something");
      expect(mockDeps.spawnProcess).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(0);
    });
  });

  describe("headless mode", () => {
    test("headless mode creates HeadlessRunner and runs with options", async () => {
      const mockRun = mock(async () => {});
      const mockConstructor = mock(() => ({ run: mockRun })) as any;
      const originalModule = await import("@/server/headless");
      const spy = spyOn(originalModule, "HeadlessRunner") as any;
      spy.mockImplementation(mockConstructor);

      const parsed: ParsedCliArgs = {
        mode: "headless",
        positionals: [],
        values: { ask: "hello world", timeout: "30", "max-tool-rounds": "10" },
        sseAll: false,
      };

      await executeMode(parsed);

      expect(mockConstructor).toHaveBeenCalled();
      expect(mockRun).toHaveBeenCalledWith(
        "hello world",
        expect.objectContaining({
          timeout: 30,
          maxToolRounds: 10,
        }),
      );
    });

    test("headless mode with no-mcp option", async () => {
      const mockRun = mock(async () => {});
      const mockConstructor = mock(() => ({ run: mockRun })) as any;
      const originalModule = await import("@/server/headless");
      const spy = spyOn(originalModule, "HeadlessRunner") as any;
      spy.mockImplementation(mockConstructor);

      const parsed: ParsedCliArgs = {
        mode: "headless",
        positionals: [],
        values: { ask: "continue please", "no-mcp": true },
        sseAll: false,
      };

      await executeMode(parsed);

      expect(mockRun).toHaveBeenCalledWith(
        "continue please",
        expect.objectContaining({
          mcp: "disabled",
        }),
      );
    });
  });

  describe("tui mode", () => {
    test("tui mode calls runTui with deps", async () => {
      const runTuiSpy = spyOn(await import("@/cli/core/tuiRunner"), "runTui").mockResolvedValue(undefined);

      const parsed: ParsedCliArgs = {
        mode: "tui",
        positionals: [],
        values: {},
        sseAll: false,
      };

      await executeMode(parsed);

      expect(runTuiSpy).toHaveBeenCalledWith(mockDeps, { parsed });
    });
  });

  describe("unregistered mode", () => {
    test("未注册的模式触发 exitWithError", async () => {
      const { __clearCommandRegistry } = await import("@/cli/core/commandRegistry");
      const { setOrchestratorDeps, __resetLifecycleForTest } = await import("@/cli/core/lifecycle");

      // 清空注册表使所有模式变为"未注册"
      __clearCommandRegistry();
      __resetLifecycleForTest();
      setOrchestratorDeps(mockDeps);

      const parsed: ParsedCliArgs = {
        mode: "setup",
        positionals: ["setup"],
        values: {},
        sseAll: false,
      };

      try {
        await executeMode(parsed);
      } catch {
        /* exitWithError */
      }
      expect(exitSpy).toHaveBeenCalledWith(1);

      // 恢复注册表（后续测试依赖）
      await import("@/cli/core/commands");
    });
  });
});
