/**
 * SSE 模式模块 — 负责 SSE 服务器的启动/守护/查询/停止子命令。
 *
 * 职责:
 *   - 解析并执行 --sse / --sse-daemon / --sse-stop / --sse-status
 *   - 启动子进程并等待就绪
 *   - 与任务运行器共享项目 .crab 目录
 *
 * 模块功能:
 *   - sseMode: 启动 SSE 服务器
 *   - SseReadiness / SseModeDeps: 类型
 */
import path from "node:path";
import { createLogger } from "@/core/logging/logger";
import { getProjectCrabDir } from "@/config";

const log = createLogger("sse");

export interface SseReadiness {
  ready: boolean;
  port?: number;
  message?: string;
}

export interface SseModeDeps {
  spawnProcess: typeof Bun.spawn;
  waitForSseServerReady: (pid: number, port?: number) => Promise<SseReadiness>;
  entryPath: string;
}

export async function sseMode(daemon: boolean, forcedPort?: number): Promise<void> {
  log.info(`SSE 服务器模式 (daemon=${daemon})`);
  const { startSseServer } = await import("@/server/sseServer");
  const { registerSseServer, markSseServerReady, unregisterSseServer, findAvailablePort } =
    await import("@/server/sseManager");

  const port = forcedPort ?? findAvailablePort(3000);
  if (!port) {
    console.error("错误: 无法找到可用端口 (3000-3009)");
    process.exit(1);
  }

  registerSseServer(port, false);
  try {
    await startSseServer({ daemon, port });
    markSseServerReady();
  } catch (error) {
    unregisterSseServer(port);
    throw error;
  }

  if (!daemon) {
    console.log("SSE 服务器已启动" + "，按 Ctrl+C 停止");
  }
}

export async function sseDaemonMode(forcedPort: number | undefined, deps: SseModeDeps): Promise<void> {
  log.info("SSE 服务器后台模式");
  const { registerSseServerProcess, unregisterSseServer, findAvailablePort } = await import("@/server/sseManager");
  const { createRotatingLogStream } = await import("@/server/logRotation");
  const port = forcedPort ?? findAvailablePort(3000);
  if (!port) {
    console.error("错误: 无法找到可用端口 (3000-3009)");
    process.exit(1);
  }

  const logDir = path.join(getProjectCrabDir(process.cwd()), "sse-daemon");
  const logFile = path.join(logDir, `sse-${port}.log`);
  const logStream = createRotatingLogStream({ logFilePath: logFile });

  const child = deps.spawnProcess([process.execPath, deps.entryPath, "--sse", "--sse-port", String(port)], {
    cwd: process.cwd(),
    detached: true,
    env: process.env,
    stderr: "pipe",
    stdin: "ignore",
    stdout: "pipe",
  });

  async function pipeToLog(stream: ReadableStream<Uint8Array> | null) {
    if (!stream) {
      return;
    }
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        logStream.write(new TextDecoder().decode(value));
      }
    } catch (error) {
      log.error(`读取子进程输出失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      reader.releaseLock();
    }
  }

  void pipeToLog(child.stdout);
  void pipeToLog(child.stderr);

  child.exited.finally(() => {
    logStream.close();
  });

  child.unref();

  registerSseServerProcess(child.pid, port, false);
  const readiness = await deps.waitForSseServerReady(child.pid, port);
  if (!readiness.ready) {
    logStream.close();
    unregisterSseServer(port);
    try {
      process.kill(child.pid, "SIGKILL");
    } catch (error) {
      // Ignore cleanup errors for already-exited child
      log.debug(`SSE daemon 子进程 ${child.pid} 清理失败: ${error instanceof Error ? error.message : String(error)}`);
    }
    console.error(`SSE 后台服务启动失败: ${readiness.message ?? "未知错误"}`);
    process.exit(1);
  }
  console.log(`SSE 服务器已后台启动 (PID: ${child.pid}, 端口: ${readiness.port})`);
  console.log(`日志文件: ${logFile}`);
  log.info(`SSE 后台服务已派发: pid=${child.pid}, port=${readiness.port}, log=${logFile}`);
  process.exit(0);
}

export async function sseStopMode(port?: number, all = false): Promise<void> {
  const { stopSseServer, stopAllSseServers } = await import("@/server/sseManager");
  const result = all ? await stopAllSseServers() : await stopSseServer(port);
  console.log(result.message);
  process.exit(result.success ? 0 : 1);
}

export async function sseStatusMode(port?: number, all = false): Promise<void> {
  const { getSseServerStatus, getAllSseServerStatuses, formatSseStatus, formatSseStatuses } =
    await import("@/server/sseManager");
  const output = all ? formatSseStatuses(getAllSseServerStatuses()) : formatSseStatus(getSseServerStatus(port));
  console.log(output);
  process.exit(0);
}

export class SsePortError extends Error {}

export function parseSsePort(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new SsePortError(`错误: 无效的 SSE 端口: ${String(value)}`);
  }
  return port;
}
