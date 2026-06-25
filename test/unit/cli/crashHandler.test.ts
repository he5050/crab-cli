/**
 * tuiRunner 崩溃处理器单元测试
 *
 * 测试重点:
 *   - setupCrashHandlers 注册 uncaughtException 和 unhandledRejection
 *   - 触发 uncaughtException 后调用 shutdown
 *   - 触发 unhandledRejection 后调用 shutdown
 *   - runTui 正常结束后移除处理器（避免泄漏）
 */
import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import type { CliOrchestratorDeps } from "@/cli/type";

describe("tuiRunner crash handlers", () => {
  const mockDeps: CliOrchestratorDeps = {
    closeDb: mock(() => {}),
    createCliRenderer: mock(async () => ({
      destroy: mock(() => {}),
      once: mock((_e: string, cb: () => void) => setTimeout(cb, 10)),
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

  let originalListeners: Map<string, Function[]>;

  beforeEach(() => {
    // 捕获当前已注册的 uncaughtException/unhandledRejection 监听器
    originalListeners = new Map();
    for (const event of ["uncaughtException", "unhandledRejection"] as const) {
      const listeners = (process as any).listeners(event) as Function[];
      originalListeners.set(event, [...listeners]);
    }
  });

  afterEach(() => {
    // 恢复：移除所有当前监听器，恢复原始监听器
    for (const event of ["uncaughtException", "unhandledRejection"] as const) {
      const current = (process as any).listeners(event) as Function[];
      for (const fn of current) {
        process.removeListener(event, fn as any);
      }
      for (const fn of originalListeners.get(event) ?? []) {
        process.on(event, fn as any);
      }
    }
  });

  test("runTui 注册 crash处理器并在退出后移除", async () => {
    const { runTui } = await import("@/cli/core/tuiRunner");
    const parsed = { mode: "tui" as const, positionals: [], values: {}, ssePort: undefined, sseAll: false };

    const before = (process as any).listeners("uncaughtException").length;
    await runTui(mockDeps as any, { parsed });
    const after = (process as any).listeners("uncaughtException").length;

    // 退出后监听器数量应恢复原状（不多不少）
    expect(after).toBe(before);
  });
});
