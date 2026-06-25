/**
 * CLI 生命周期管理 — 信号处理、优雅关闭、依赖注入。
 *
 * 职责:
 *   - 管理进程信号处理（SIGINT, SIGTERM, SIGBREAK）
 *   - 协调优雅关闭流程
 *   - 存储和提供 CLI 编排器依赖
 */
import { createLogger, flushLogSync } from "@/core/logging/logger";
import { createCliError, writeCliError } from "../errors";
import type { CliOrchestratorDeps } from "../type";

const log = createLogger("lifecycle");

let signalHandlersInstalled = false;

export function installSignalHandlers(): void {
  if (signalHandlersInstalled) {
    return;
  }
  signalHandlersInstalled = true;

  const handleSignal = async (signal: string) => {
    log.info(`收到信号 ${signal}，开始优雅关闭...`);
    await shutdown(0);
  };

  process.on("SIGINT", () => void handleSignal("SIGINT"));
  process.on("SIGTERM", () => void handleSignal("SIGTERM"));

  if (process.platform === "win32") {
    process.on("SIGBREAK", () => void handleSignal("SIGBREAK"));
  }
}

function writeFatalLog(message: string, error: unknown): void {
  try {
    flushLogSync({
      id: `fatal_${Date.now()}`,
      level: "error" as const,
      message,
      payload: {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      service: "lifecycle",
      timestamp: Date.now(),
    });
  } catch {
    writeCliError(
      createCliError({
        cause: error,
        context: { operation: "lifecycle.writeFatalLog" },
        kind: "internal",
        message: "[FATAL] 写入致命错误日志失败",
      }),
      { includeCause: true },
    );
  }
}

let shuttingDown = false;

export async function shutdown(exitCode?: number, error?: unknown): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  if (error) {
    writeFatalLog(`致命错误: ${error instanceof Error ? error.message : String(error)}`, error);

    process.stderr.write("\n────────────────────────────────\n");
    writeCliError(
      createCliError({
        cause: error,
        context: { operation: "lifecycle.shutdown" },
        kind: "internal",
        message: `发生错误: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );
    process.stderr.write("详情已记录至日志文件，可通过 --verbose 参数查看完整信息\n");
    process.stderr.write("────────────────────────────────\n\n");
  }

  try {
    if (globalOrchestratorDeps) {
      globalOrchestratorDeps.closeDb();
      await globalOrchestratorDeps.runCleanup();
    }
  } catch (cleanupError) {
    writeCliError(
      createCliError({
        cause: cleanupError,
        context: { operation: "lifecycle.cleanup" },
        kind: "internal",
        message: "执行清理回调失败",
      }),
      { includeCause: true },
    );
  }

  if (typeof exitCode === "number") {
    process.exit(exitCode);
  }
}

let globalOrchestratorDeps: CliOrchestratorDeps | null = null;

export function setOrchestratorDeps(deps: CliOrchestratorDeps | null): void {
  globalOrchestratorDeps = deps;
}

export function getOrchestratorDeps(): CliOrchestratorDeps | null {
  return globalOrchestratorDeps;
}

export function __resetLifecycleForTest(): void {
  shuttingDown = false;
  signalHandlersInstalled = false;
  globalOrchestratorDeps = null;
}
