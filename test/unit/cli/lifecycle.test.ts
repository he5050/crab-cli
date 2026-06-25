/**
 * CLI 生命周期管理单元测试
 *
 * 测试重点:
 *   - installSignalHandlers 防重入
 *   - shutdown 幂等性
 *   - setOrchestratorDeps / getOrchestratorDeps 正常工作
 */
import { describe, expect, test, mock, beforeEach } from "bun:test";
import {
  installSignalHandlers,
  shutdown,
  setOrchestratorDeps,
  getOrchestratorDeps,
  __resetLifecycleForTest,
} from "@/cli/core/lifecycle";
import type { CliOrchestratorDeps } from "@/cli/type";

describe("installSignalHandlers", () => {
  beforeEach(() => {
    // Reset the module state by reloading
    __resetLifecycleForTest();
  });

  test("installs handlers only once", () => {
    const originalOn = process.on;
    let callCount = 0;
    process.on = ((event: string, listener: any) => {
      callCount++;
      return process;
    }) as typeof process.on;

    try {
      installSignalHandlers();
      installSignalHandlers(); // Should not install again
      // SIGINT + SIGTERM = 2 calls (SIGBREAK only on Windows)
      expect(callCount).toBeLessThanOrEqual(3);
    } finally {
      process.on = originalOn;
    }
  });
});

describe("setOrchestratorDeps / getOrchestratorDeps", () => {
  beforeEach(() => {
    __resetLifecycleForTest();
  });

  test("getOrchestratorDeps returns null before setOrchestratorDeps", () => {
    expect(getOrchestratorDeps()).toBeNull();
  });

  test("getOrchestratorDeps returns the set deps", () => {
    const mockDeps: CliOrchestratorDeps = {
      closeDb: mock(() => {}),
      runCleanup: mock(async () => true),
      initDb: mock(() => Promise.resolve()),
      createTuiApp: mock(async () => {}),
      createCliRenderer: mock(async () => ({
        waitForThemeMode: mock(async () => "dark"),
        setTerminalTitle: mock(() => {}),
        once: mock(() => {}),
        destroy: mock(() => {}),
      })),
      createInstanceId: mock(() => "test"),
      instanceLock: { lock: mock(() => true), cleanupStaleLocks: mock(() => {}), unlock: mock(() => {}) },
      loadConfig: mock(async () => ({ defaultProvider: { provider: "openai", model: "gpt-4o" }, theme: "dark" })),
      setupGoalToolVisibility: mock(() => {}),
      initTaskRuntime: mock(() => {}),
      ensureMcpRuntimeStarted: mock(async () => true),
      registerCleanup: mock(() => {}),
      spawnProcess: Bun.spawn,
      startResourceMonitor: mock(() => () => {}),
      waitForSseServerReady: mock(async () => ({ ready: true, port: 3000 })),
      eventBus: {} as any,
      installGlobalProcessHandlers: mock(() => {}),
    };
    setOrchestratorDeps(mockDeps);
    expect(getOrchestratorDeps()).toBe(mockDeps);
  });
});

describe("shutdown", () => {
  const mockDeps: CliOrchestratorDeps = {
    closeDb: mock(() => {}),
    createCliRenderer: mock(async () => ({
      waitForThemeMode: mock(async () => "dark"),
      setTerminalTitle: mock(() => {}),
      once: mock(() => {}),
      destroy: mock(() => {}),
    })),
    createInstanceId: mock(() => "test"),
    createTuiApp: mock(async () => {}),
    ensureMcpRuntimeStarted: mock(async () => ({})),
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

  test("calls closeDb and runCleanup", async () => {
    await shutdown();
    expect(mockDeps.closeDb).toHaveBeenCalled();
    expect(mockDeps.runCleanup).toHaveBeenCalled();
  });

  test("is idempotent - ignores repeated calls", async () => {
    await shutdown();
    await shutdown();
    expect(mockDeps.closeDb).toHaveBeenCalledTimes(1);
    expect(mockDeps.runCleanup).toHaveBeenCalledTimes(1);
  });

  test("handles cleanup errors gracefully", async () => {
    const failingDeps: CliOrchestratorDeps = {
      ...mockDeps,
      runCleanup: mock(async () => {
        throw new Error("清理失败");
      }),
    };
    setOrchestratorDeps(failingDeps);

    // Should not throw
    let threw = false;
    try {
      await shutdown();
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  test("exits with provided exit code", async () => {
    const exitSpy = mock((code?: number) => {
      throw new Error(`EXIT_${code ?? 0}`);
    });
    const originalExit = process.exit;
    process.exit = exitSpy as any;

    try {
      await expect(shutdown(42)).rejects.toThrow("EXIT_42");
    } finally {
      process.exit = originalExit;
    }
  });
});
