/**
 * TUI 模式运行器 — 封装 TUI 启动流程。
 *
 * 职责:
 *   - 初始化 TUI 所需资源
 *   - 管理实例锁和生命周期
 *   - 启动 TUI 应用并等待退出
 */
import { createLogger } from "@/core/logging/logger";
import { VERSION } from "@/config/version";
import { AppEvent } from "@/bus";
import type { CliOrchestratorDeps } from "../type";
import type { ParsedCliArgs } from "../type";
import { shutdown } from "./lifecycle";
import { safeImport } from "./orchestrator";
import { exitWithError } from "../errors";

const log = createLogger("tui");

export interface TuiRunOptions {
  parsed: ParsedCliArgs;
}

// ─── 子流程：崩溃处理器注册 ────────────────────────────

interface CrashHandlers {
  onUncaughtException: (err: Error) => void;
  onUnhandledRejection: (reason: unknown) => void;
}

function setupCrashHandlers(): CrashHandlers {
  const handlers: CrashHandlers = {
    onUncaughtException: (err: Error) => {
      log.error(`发生未捕获异常: ${err.message}`);
      void shutdown(1, err);
    },
    onUnhandledRejection: (reason: unknown) => {
      log.error(`发生未处理 Rejection: ${String(reason)}`);
      void shutdown(1, reason);
    },
  };
  process.on("uncaughtException", handlers.onUncaughtException);
  process.on("unhandledRejection", handlers.onUnhandledRejection);
  return handlers;
}

// ─── 子流程：实例锁获取 ────────────────────────────────

function acquireInstanceLock(deps: CliOrchestratorDeps): string {
  const instanceId = deps.createInstanceId();
  deps.instanceLock.cleanupStaleLocks();
  if (!deps.instanceLock.lock(instanceId)) {
    exitWithError("resource-conflict", "已有实例正在运行，请先关闭当前项目目录下的其他 crab-cli。", { instanceId });
  }
  deps.registerCleanup(() => {
    deps.instanceLock.unlock(instanceId);
  });
  return instanceId;
}

// ─── 子流程：遥测与临时文件清理 ─────────────────────────

async function setupTelemetryAndCleanup(appConfig: Record<string, unknown>): Promise<() => Promise<void>> {
  // 初始化 OpenTelemetry 遥测(默认关闭，零开销)
  const { initTelemetry, shutdownTelemetry } = await safeImport(
    () => import("@/monitor/telemetry/telemetry"),
    "@/monitor/telemetry/telemetry",
  );
  await initTelemetry(appConfig.telemetry as Parameters<typeof initTelemetry>[0]);

  // 启动时清理过期的临时文件和旧备份
  const { registerTmpCleanupTask, runTmpCleanup, registerTmpCleanup } = await safeImport(
    () => import("@/bus/lifecycle/tmpCleanup"),
    "@/bus/lifecycle/tmpCleanup",
  );
  const { cleanupTruncationFiles } = await safeImport(() => import("@/tool/result/truncate"), "@/tool/result/truncate");
  registerTmpCleanupTask("tool-truncation-files", cleanupTruncationFiles);
  runTmpCleanup();
  registerTmpCleanup();

  // 注意: shutdownTelemetry 是 async，不能通过 registerCleanup（process.on("exit") 同步回调）注册
  // 返回清理函数供调用方在显式路径中调用
  return shutdownTelemetry;
}

// ─── 子流程：CLI 环境变量映射 ──────────────────────────

async function applyCliEnvVars(parsed: ParsedCliArgs): Promise<void> {
  const v = parsed.values;

  if (v.continue) {
    process.env.CRAB_RESUME_SESSION = String(v.continue);
  }
  if (v["c-yolo"] === true) {
    const explicitSessionId = parsed.positionals[0];
    if (explicitSessionId) {
      process.env.CRAB_RESUME_SESSION = explicitSessionId;
    } else if (!process.env.CRAB_RESUME_SESSION) {
      const { listSessions } = await safeImport(() => import("@session"), "@session");
      const latest = listSessions()[0];
      if (latest) {
        process.env.CRAB_RESUME_SESSION = latest.id;
      }
    }
    process.env.CRAB_YOLO_MODE = "1";
  }
  if (v.plan === true) {
    process.env.CRAB_INITIAL_MODE = "plan";
  }
  if (v.yolo === true || v["yolo-p"] === true) {
    process.env.CRAB_YOLO_MODE = "1";
  }
  if (v.dev === true) {
    process.env.CRAB_DEV_MODE = "1";
  }
}

// ─── 主流程 ──────────────────────────────────────────────

export async function runTui(deps: CliOrchestratorDeps, options: TuiRunOptions): Promise<void> {
  // 1. 注册崩溃处理器
  const crashHandlers = setupCrashHandlers();

  try {
    // 2. 初始化开发者模式(如果启用)
    const { initDevMode } = await safeImport(() => import("@/config/devMode"), "@/config/devMode");
    initDevMode();

    // 3. 获取实例锁
    acquireInstanceLock(deps);

    // 4. 加载配置并初始化遥测与清理
    const appConfig = await deps.loadConfig();
    log.info(`Crab CLI v${VERSION} 启动中...`);

    // 4.5 首次运行检测:如果配置不完整，启动配置向导
    const { isFirstRun, markFirstRunComplete } = await safeImport(
      () => import("@/config/firstRun"),
      "@/config/firstRun",
    );
    if (await isFirstRun()) {
      log.info("检测到首次运行，启动配置向导...");
      const { setupCommand: runSetup } = await safeImport(
        () => import("@/command/config/setup"),
        "@/command/config/setup",
      );
      await runSetup();
      markFirstRunComplete();
      // 重新加载配置
      const { resetConfigCache } = await safeImport(() => import("@/config/loader/config"), "@/config/loader/config");
      resetConfigCache();
    }

    const shutdownTelemetry = await setupTelemetryAndCleanup(appConfig);

    // 5. 初始化数据库
    deps.initTaskRuntime(process.cwd(), {}, { config: appConfig });
    deps.initDb();
    log.info("数据库已初始化");

    // 6. 创建渲染器
    const renderer = await deps.createCliRenderer({
      autoFocus: false,
      exitOnCtrlC: true,
      externalOutputMode: "passthrough",
      screenMode: "alternate-screen",
      targetFps: 60,
      useKittyKeyboard: {},
      useMouse: true,
    });

    const mode = (await renderer.waitForThemeMode(1000)) ?? (appConfig.theme as "dark" | "light");
    renderer.setTerminalTitle("Crab CLI");

    // 7. 启动监控与 MCP
    const stopMonitor = deps.startResourceMonitor(5000);
    await deps.ensureMcpRuntimeStarted();

    deps.eventBus.publish(AppEvent.AppStarted, { pid: process.pid, version: VERSION });
    deps.installGlobalProcessHandlers(deps.eventBus);
    log.info(
      `主题模式: ${mode} | Provider: ${appConfig.defaultProvider.provider} | 模型: ${appConfig.defaultProvider.model}`,
    );

    // 7.5 后台检查更新(非阻塞)
    safeImport(() => import("@/core/update"), "@/core/update")
      .then(({ startUpdateCheck, onUpdateNotice }) => {
        onUpdateNotice((notice) => {
          if (notice) {
            log.info(`发现新版本: v${notice.latestVersion} (当前 v${VERSION})`);
            deps.eventBus.publish(AppEvent.UpdateAvailable, {
              currentVersion: VERSION,
              latestVersion: notice.latestVersion,
            });
            deps.eventBus.publish(AppEvent.Toast, {
              message: `发现新版本 v${notice.latestVersion}，运行 crab update 更新`,
              variant: "info",
            });
          }
        });
        startUpdateCheck();
      })
      .catch(() => {
        // 更新检查失败不影响启动
      });

    // 7.6 启动定时任务调度器(非阻塞)
    safeImport(() => import("@/command/schedule"), "@/command/schedule")
      .then(({ startScheduler }) => {
        startScheduler();
      })
      .catch(() => {
        // 调度器启动失败不影响主流程
      });

    // 8. 映射 CLI 环境变量
    await applyCliEnvVars(options.parsed);

    // 9. 启动 TUI 应用
    await deps.createTuiApp(renderer, mode, appConfig);

    // 10. 等待退出
    await new Promise<void>((resolve) => {
      renderer.once("destroy", () => {
        stopMonitor();
        resolve();
      });
    });

    // 11. 优雅关闭
    await shutdownTelemetry();
    await deps.runCleanup();
    console.log(`Crab CLI v${VERSION} 已退出`);
    process.exit(0);
  } finally {
    // 确保崩溃处理器被移除（即使 try 块中 exitWithError 被调用）
    process.removeListener("uncaughtException", crashHandlers.onUncaughtException);
    process.removeListener("unhandledRejection", crashHandlers.onUnhandledRejection);
  }
}
