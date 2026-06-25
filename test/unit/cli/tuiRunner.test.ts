/**
 * TUI Runner 单元测试
 *
 * 测试重点:
 *   - 实例锁获取与释放
 *   - 环境变量设置（--continue, --c-yolo, --plan, --yolo, --dev）
 *   - 清理回调注册
 *   - 未捕获异常处理
 */
import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import type { CliOrchestratorDeps } from "@/cli/type";
import type { ParsedCliArgs } from "@/cli/type";

describe("tuiRunner", () => {
  const mockDeps: CliOrchestratorDeps = {
    closeDb: mock(() => {}),
    createCliRenderer: mock(async () => ({
      destroy: mock(() => {}),
      once: mock(() => {}),
      setTerminalTitle: mock(() => {}),
      waitForThemeMode: mock(async () => "dark"),
    })),
    createInstanceId: mock(() => "test-instance"),
    createTuiApp: mock(async () => {}),
    ensureMcpRuntimeStarted: mock(async () => {}),
    eventBus: { publish: mock(() => {}), subscribe: mock(() => () => {}), once: mock(() => () => {}) } as any,
    initDb: mock(() => Promise.resolve()),
    initTaskRuntime: mock(() => {}),
    installGlobalProcessHandlers: mock(() => {}),
    instanceLock: {
      cleanupStaleLocks: mock(() => {}),
      lock: mock(() => true),
      unlock: mock(() => {}),
    },
    loadConfig: mock(async () => ({
      defaultProvider: { model: "gpt-4o", provider: "openai" },
      theme: "dark",
    })),
    registerCleanup: mock(() => {}),
    runCleanup: mock(async () => true),
    setupGoalToolVisibility: mock(() => {}),
    spawnProcess: Bun.spawn,
    startResourceMonitor: mock(() => () => {}),
    waitForSseServerReady: mock(async () => ({ ready: true })),
  };

  beforeEach(() => {
    mock.clearAllMocks();
    delete process.env.CRAB_RESUME_SESSION;
    delete process.env.CRAB_YOLO_MODE;
    delete process.env.CRAB_INITIAL_MODE;
    delete process.env.CRAB_DEV_MODE;
  });

  afterEach(() => {
    delete process.env.CRAB_RESUME_SESSION;
    delete process.env.CRAB_YOLO_MODE;
    delete process.env.CRAB_INITIAL_MODE;
    delete process.env.CRAB_DEV_MODE;
  });

  describe("instance lock", () => {
    test("acquires instance lock on startup", async () => {
      const { runTui } = await import("@/cli/core/tuiRunner");
      const parsed: ParsedCliArgs = {
        mode: "tui",
        positionals: [],
        values: {},
        sseAll: false,
      };

      const lockSpy = mock(() => true);
      const depsWithLock = { ...mockDeps, instanceLock: { ...mockDeps.instanceLock, lock: lockSpy } };

      const renderer = {
        destroy: mock(() => {}),
        once: mock((_e: string, cb: () => void) => setTimeout(cb, 10)),
        setTerminalTitle: mock(() => {}),
        waitForThemeMode: mock(async () => "dark"),
      };
      depsWithLock.createCliRenderer = mock(async () => renderer as any);

      const promise = runTui(depsWithLock as any, { parsed });
      setTimeout(() => renderer.destroy(), 50);
      await promise;

      expect(lockSpy).toHaveBeenCalledTimes(1);
    });

    test("exits when instance lock is already held", async () => {
      const { runTui } = await import("@/cli/core/tuiRunner");
      const parsed: ParsedCliArgs = {
        mode: "tui",
        positionals: [],
        values: {},
        sseAll: false,
      };

      const lockSpy = mock(() => false);
      const depsWithLock = { ...mockDeps, instanceLock: { ...mockDeps.instanceLock, lock: lockSpy } };

      let exitCode: number | undefined;
      const originalExit = process.exit;
      process.exit = ((code: number) => {
        exitCode = code;
        throw new Error(`EXIT_${code}`);
      }) as any;

      try {
        await runTui(depsWithLock as any, { parsed });
      } catch {
        expect(exitCode).toBe(1);
      } finally {
        process.exit = originalExit;
      }
    });
  });

  describe("environment variable setup", () => {
    test("--continue sets CRAB_RESUME_SESSION", async () => {
      const { runTui } = await import("@/cli/core/tuiRunner");
      const parsed: ParsedCliArgs = {
        mode: "tui",
        positionals: [],
        values: { continue: "ses_abc123" },
        sseAll: false,
      };

      const renderer = {
        destroy: mock(() => {}),
        once: mock((_e: string, cb: () => void) => setTimeout(cb, 10)),
        setTerminalTitle: mock(() => {}),
        waitForThemeMode: mock(async () => "dark"),
      };
      const depsWithRenderer = { ...mockDeps, createCliRenderer: mock(async () => renderer as any) };

      const promise = runTui(depsWithRenderer as any, { parsed });
      setTimeout(() => renderer.destroy(), 50);
      await promise;

      expect(process.env.CRAB_RESUME_SESSION).toBe("ses_abc123");
    });

    test("--plan sets CRAB_INITIAL_MODE to plan", async () => {
      const { runTui } = await import("@/cli/core/tuiRunner");
      const parsed: ParsedCliArgs = {
        mode: "tui",
        positionals: [],
        values: { plan: true },
        sseAll: false,
      };

      const renderer = {
        destroy: mock(() => {}),
        once: mock((_e: string, cb: () => void) => setTimeout(cb, 10)),
        setTerminalTitle: mock(() => {}),
        waitForThemeMode: mock(async () => "dark"),
      };
      const depsWithRenderer = { ...mockDeps, createCliRenderer: mock(async () => renderer as any) };

      const promise = runTui(depsWithRenderer as any, { parsed });
      setTimeout(() => renderer.destroy(), 50);
      await promise;

      expect(process.env.CRAB_INITIAL_MODE).toBe("plan");
    });

    test("--yolo sets CRAB_YOLO_MODE", async () => {
      const { runTui } = await import("@/cli/core/tuiRunner");
      const parsed: ParsedCliArgs = {
        mode: "tui",
        positionals: [],
        values: { yolo: true },
        sseAll: false,
      };

      const renderer = {
        destroy: mock(() => {}),
        once: mock((_e: string, cb: () => void) => setTimeout(cb, 10)),
        setTerminalTitle: mock(() => {}),
        waitForThemeMode: mock(async () => "dark"),
      };
      const depsWithRenderer = { ...mockDeps, createCliRenderer: mock(async () => renderer as any) };

      const promise = runTui(depsWithRenderer as any, { parsed });
      setTimeout(() => renderer.destroy(), 50);
      await promise;

      expect(process.env.CRAB_YOLO_MODE).toBe("1");
    });

    test("--c-yolo 带 positional session ID 设置 CRAB_RESUME_SESSION 和 CRAB_YOLO_MODE", async () => {
      const { runTui } = await import("@/cli/core/tuiRunner");
      const parsed: ParsedCliArgs = {
        mode: "tui",
        positionals: ["ses_xyz"],
        values: { "c-yolo": true },
        sseAll: false,
      };

      const renderer = {
        destroy: mock(() => {}),
        once: mock((_e: string, cb: () => void) => setTimeout(cb, 10)),
        setTerminalTitle: mock(() => {}),
        waitForThemeMode: mock(async () => "dark"),
      };
      const depsWithRenderer = { ...mockDeps, createCliRenderer: mock(async () => renderer as any) };

      const promise = runTui(depsWithRenderer as any, { parsed });
      setTimeout(() => renderer.destroy(), 50);
      await promise;

      expect(process.env.CRAB_RESUME_SESSION).toBe("ses_xyz");
      expect(process.env.CRAB_YOLO_MODE).toBe("1");
    });

    test("--yolo-p 也设置 CRAB_YOLO_MODE", async () => {
      const { runTui } = await import("@/cli/core/tuiRunner");
      const parsed: ParsedCliArgs = {
        mode: "tui",
        positionals: [],
        values: { "yolo-p": true },
        sseAll: false,
      };

      const renderer = {
        destroy: mock(() => {}),
        once: mock((_e: string, cb: () => void) => setTimeout(cb, 10)),
        setTerminalTitle: mock(() => {}),
        waitForThemeMode: mock(async () => "dark"),
      };
      const depsWithRenderer = { ...mockDeps, createCliRenderer: mock(async () => renderer as any) };

      const promise = runTui(depsWithRenderer as any, { parsed });
      setTimeout(() => renderer.destroy(), 50);
      await promise;

      expect(process.env.CRAB_YOLO_MODE).toBe("1");
    });

    test("--dev sets CRAB_DEV_MODE", async () => {
      const { runTui } = await import("@/cli/core/tuiRunner");
      const parsed: ParsedCliArgs = {
        mode: "tui",
        positionals: [],
        values: { dev: true },
        sseAll: false,
      };

      const renderer = {
        destroy: mock(() => {}),
        once: mock((_e: string, cb: () => void) => setTimeout(cb, 10)),
        setTerminalTitle: mock(() => {}),
        waitForThemeMode: mock(async () => "dark"),
      };
      const depsWithRenderer = { ...mockDeps, createCliRenderer: mock(async () => renderer as any) };

      const promise = runTui(depsWithRenderer as any, { parsed });
      setTimeout(() => renderer.destroy(), 50);
      await promise;

      expect(process.env.CRAB_DEV_MODE).toBe("1");
    });
  });

  describe("cleanup registration", () => {
    test("registers instance lock unlock as cleanup", async () => {
      const { runTui } = await import("@/cli/core/tuiRunner");
      const parsed: ParsedCliArgs = {
        mode: "tui",
        positionals: [],
        values: {},
        sseAll: false,
      };

      const unlockSpy = mock(() => {});
      const depsWithUnlock = { ...mockDeps, instanceLock: { ...mockDeps.instanceLock, unlock: unlockSpy } };
      const registerSpy = mock((fn: () => void) => {});
      depsWithUnlock.registerCleanup = registerSpy;

      const renderer = {
        destroy: mock(() => {}),
        once: mock((_e: string, cb: () => void) => setTimeout(cb, 10)),
        setTerminalTitle: mock(() => {}),
        waitForThemeMode: mock(async () => "dark"),
      };
      depsWithUnlock.createCliRenderer = mock(async () => renderer as any);

      const promise = runTui(depsWithUnlock as any, { parsed });
      setTimeout(() => renderer.destroy(), 50);
      await promise;

      expect(registerSpy).toHaveBeenCalled();
      const cleanupFn = registerSpy.mock.calls[0]![0] as any;
      cleanupFn();
      expect(unlockSpy).toHaveBeenCalledWith("test-instance");
    });
  });
});
