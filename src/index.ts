/**
 * Crab-cli 主入口 — CLI 参数解析与模式分发。
 *
 * 职责:
 *   - 组装依赖并启动 CLI
 *   - 委托给 Orchestrator 进行模式路由
 *
 * 边界:
 *   1. 不含任何 JSX 语法，JSX 渲染全部委托给 app.tsx
 *   2. 模式互斥，一次只能运行一种模式
 *   3. 需要 Bun 运行时环境
 */
import { createCliRenderer } from "@opentui/core";
import { createTuiApp } from "@/app";
import { startResourceMonitor } from "@monitor";
import { createLogger } from "@/core/logging/logger";
import { loadConfig, migrateDirectoryStructure } from "@/config";
import { setupGoalToolVisibility } from "@/tool/registry/toolRegistry";
import { closeDb, initDb } from "@/db";
import { createInstanceId, instanceLock } from "@/core/concurrency/instanceLock";
import { setLogEventSink } from "@/core/logging/logger";
import { initTaskRuntime } from "@/mission";
import { ensureMcpRuntimeStarted } from "@/mcp/manager/runtime";
import { parseCliArgs, executeMode, setOrchestratorDeps, getOrchestratorDeps, shutdown, exitWithError } from "@/cli";
import type { CliOrchestratorDeps } from "@/cli/type";

export { parseCliArgs, executeMode, shutdown, type CliOrchestratorDeps };
import { installSignalHandlers } from "@/cli";
import { globalBus, runCleanup } from "@/bus";
import { installGlobalProcessHandlers } from "@/bus";

const log = createLogger("main");

async function defaultWaitForSseServerReady(pid: number, port?: number) {
  const { waitForSseServerReady } = await import("./server/sseManager");
  return waitForSseServerReady(pid, port);
}

/**
 * 组合根类型适配 — 将具体实现映射到 CLI 解耦接口。
 *
 * CliOrchestratorDeps 使用最小接口（ICliRenderer / CliAppConfig）解耦
 * @opentui/core 和 @/schema/config 的具体类型。此处 as 适配是标准的
 * Composition Root 模式，仅在本文件生效。
 */
type DepsKeys = CliOrchestratorDeps;
const deps: CliOrchestratorDeps = {
  closeDb,
  createCliRenderer: createCliRenderer as unknown as DepsKeys["createCliRenderer"],
  createInstanceId,
  createTuiApp: createTuiApp as unknown as DepsKeys["createTuiApp"],
  ensureMcpRuntimeStarted,
  eventBus: globalBus,
  initDb,
  initTaskRuntime: initTaskRuntime as unknown as DepsKeys["initTaskRuntime"],
  installGlobalProcessHandlers,
  instanceLock,
  loadConfig,
  registerCleanup: (fn) => process.on("exit", fn),
  runCleanup,
  setupGoalToolVisibility,
  spawnProcess: Bun.spawn,
  startResourceMonitor,
  waitForSseServerReady: defaultWaitForSseServerReady,
};

setOrchestratorDeps(deps);
installSignalHandlers();
setLogEventSink(({ level, message }) => {
  globalBus.publish({ type: "app.log" }, { level, message });
});

let testDeps: CliOrchestratorDeps | null = null;

export function __setCliDepsForTesting(overrideDeps: Partial<CliOrchestratorDeps>): void {
  testDeps = { ...deps, ...overrideDeps };
  setOrchestratorDeps(testDeps);
}

export function __resetCliDepsForTesting(): void {
  testDeps = null;
  setOrchestratorDeps(deps);
}

export async function runCli(args = process.argv.slice(2)): Promise<void> {
  const parsed = parseCliArgs(args);
  const v = parsed.values;

  // --work-dir 处理
  if (v["work-dir"]) {
    try {
      process.chdir(String(v["work-dir"]));
    } catch (error) {
      exitWithError("invalid-path", `无法切换到工作目录: ${String(v["work-dir"])}`, {
        path: String(v["work-dir"]),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // 通过 getOrchestratorDeps 获取 deps 而非直接使用模块级 deps，
  // 以支持 __setCliDepsForTesting 的依赖覆盖生效
  const currentDeps = getOrchestratorDeps();
  if (!currentDeps) {
    exitWithError("internal", "运行环境未初始化");
  }

  // 目录结构迁移（旧版平铺文件 → 新版子目录结构）
  migrateDirectoryStructure();

  currentDeps.initDb();
  currentDeps.setupGoalToolVisibility();

  // 注册退出清理：DB 关闭 + 所有 registerCleanup 注册的同步回调。
  // 注: registerCleanup 已映射为 process.on("exit", fn)，因此短生命周期命令
  // （headless/task/config 等）直接 process.exit(0) 时，同步清理仍会执行。
  // 异步批量清理（runCleanup）仅在 TUI 显式关闭路径中调用。
  process.on("exit", () => {
    currentDeps.closeDb();
  });

  await executeMode(parsed);
}

// 仅在直接执行入口时自动启动
if (import.meta.main) {
  runCli().catch((error) => {
    log.error(`main() 启动失败: ${error instanceof Error ? error.message : String(error)}`);
    void shutdown(1, error);
  });
}
