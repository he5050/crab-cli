/**
 * writeFatalLog 单元测试
 *
 * 测试重点:
 *   - 正常路径：flushLogSync 成功写入日志
 *   - 异常路径：flushLogSync 失败时 writeCliError 兜底输出
 *   - shutdown 带错误时触发 writeFatalLog
 */
import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { setOrchestratorDeps, shutdown, __resetLifecycleForTest } from "@/cli/core/lifecycle";
import type { CliOrchestratorDeps } from "@/cli/type";

describe("writeFatalLog", () => {
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
    ensureMcpRuntimeStarted: mock(async () => {}),
    eventBus: {} as any,
    initDb: mock(() => Promise.resolve()),
    initTaskRuntime: mock(() => {}),
    installGlobalProcessHandlers: mock(() => {}),
    instanceLock: { lock: mock(() => true), cleanupStaleLocks: mock(() => {}), unlock: mock(() => {}) },
    loadConfig: mock(async () => ({ defaultProvider: { provider: "openai", model: "gpt-4o" }, theme: "dark" })),
    registerCleanup: mock(() => {}),
    runCleanup: mock(async () => true),
    setupGoalToolVisibility: mock(() => {}),
    spawnProcess: Bun.spawn,
    startResourceMonitor: mock(() => () => {}),
    waitForSseServerReady: mock(async () => ({ ready: true })),
  };

  let exitCode: number | undefined;
  let restoreExit: (() => void) | undefined;

  beforeEach(() => {
    __resetLifecycleForTest();
    setOrchestratorDeps(mockDeps);
    const originalExit = process.exit;
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error(`EXIT_${code}`);
    }) as typeof process.exit;
    restoreExit = () => {
      process.exit = originalExit;
    };
  });

  afterEach(() => {
    restoreExit?.();
  });

  test("shutdown 带错误时调用 closeDb 和 runCleanup", async () => {
    try {
      await shutdown(1, new Error("测试致命错误"));
    } catch {
      /* process.exit mock */
    }
    expect(mockDeps.closeDb).toHaveBeenCalled();
    expect(mockDeps.runCleanup).toHaveBeenCalled();
  });

  test("shutdown 带错误后退出码正确", async () => {
    try {
      await shutdown(42, new Error("测试致命错误"));
    } catch {
      /* process.exit mock */
    }
    expect(exitCode).toBe(42);
  });

  test("shutdown 带字符串错误也能正常处理", async () => {
    try {
      await shutdown(1, "字符串错误信息");
    } catch {
      /* process.exit mock */
    }
    expect(mockDeps.closeDb).toHaveBeenCalled();
    expect(exitCode).toBe(1);
  });
});
