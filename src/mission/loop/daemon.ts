/**
 * Task 循环守护进程模块 — 管理后台循环任务的 PID/日志/状态。
 *
 * 职责:
 *   - 写入/读取循环守护进程 PID 文件
 *   - 维护循环日志与最近 N 行预览
 *   - 探测进程存活并提供停止能力
 *
 * 模块功能:
 *   - startLoopDaemon: 注册循环守护进程
 *   - getLoopDaemonStatus: 查询守护进程状态
 *   - stopLoopDaemon: 发送停止信号
 *   - LoopDaemonRecord / LoopDaemonStatus: 类型定义
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("task:loop-daemon");

const LOOP_DAEMON_DIR = "loop-daemon";
const PID_FILE = "loop.pid.json";
const LOG_FILE = "loop.log";
const DEFAULT_LOG_LINES = 80;

type SignalProcess = (pid: number, signal?: NodeJS.Signals | 0) => boolean;

export interface LoopDaemonRecord {
  pid: number;
  startedAt: number;
  projectDir: string;
}

export interface LoopDaemonStatus {
  state: "running" | "stopped" | "stale";
  pid?: number;
  startedAt?: number;
  projectDir: string;
  pidFile: string;
  logFile: string;
  message: string;
}

export interface LoopDaemonManagerOptions {
  processId?: number;
  signalProcess?: SignalProcess;
}

export class LoopDaemonManager {
  private projectDir = process.cwd();
  private readonly processId: number;
  private readonly signalProcess: SignalProcess;

  constructor(options: LoopDaemonManagerOptions = {}) {
    this.processId = options.processId ?? process.pid;
    this.signalProcess =
      options.signalProcess ??
      ((pid, signal) => {
        process.kill(pid, signal);
        return true;
      });
  }

  setProjectDir(projectDir: string): void {
    this.projectDir = projectDir;
  }

  getPaths(projectDir = this.projectDir): { dir: string; pidFile: string; logFile: string } {
    const dir = join(projectDir, ".crab", LOOP_DAEMON_DIR);
    return {
      dir,
      logFile: join(dir, LOG_FILE),
      pidFile: join(dir, PID_FILE),
    };
  }

  markRunning(now = Date.now()): LoopDaemonStatus {
    const paths = this.getPaths();
    mkdirSync(paths.dir, { recursive: true });
    const record: LoopDaemonRecord = {
      pid: this.processId,
      projectDir: this.projectDir,
      startedAt: now,
    };
    writeFileSync(paths.pidFile, JSON.stringify(record, null, 2), "utf8");
    this.appendLog(`daemon running pid=${record.pid}`);
    return this.status();
  }

  status(): LoopDaemonStatus {
    const paths = this.getPaths();
    if (!existsSync(paths.pidFile)) {
      return {
        logFile: paths.logFile,
        message: "Loop daemon 未运行",
        pidFile: paths.pidFile,
        projectDir: this.projectDir,
        state: "stopped",
      };
    }

    const record = this.readRecord(paths.pidFile);
    if (!record) {
      return {
        logFile: paths.logFile,
        message: "Loop daemon 状态文件不可读",
        pidFile: paths.pidFile,
        projectDir: this.projectDir,
        state: "stale",
      };
    }

    const alive = this.probeProcessAlive(record.pid);
    return {
      logFile: paths.logFile,
      message: alive ? "Loop daemon 正在运行" : "Loop daemon PID 已失效",
      pid: record.pid,
      pidFile: paths.pidFile,
      projectDir: this.projectDir,
      startedAt: record.startedAt,
      state: alive ? "running" : "stale",
    };
  }

  stop(): LoopDaemonStatus {
    const current = this.status();
    if (current.state === "running" && current.pid && current.pid !== this.processId) {
      try {
        this.signalProcess(current.pid, "SIGTERM");
      } catch (error) {
        log.warn("停止 Loop daemon 进程失败", {
          error: error instanceof Error ? error.message : String(error),
          pid: current.pid,
        });
      }
    }

    this.appendLog(current.pid ? `daemon stopped pid=${current.pid}` : "daemon stopped");
    this.clearRecord();
    return this.status();
  }

  resume(): LoopDaemonStatus {
    this.appendLog("daemon resume requested");
    return this.markRunning();
  }

  readLogs(limit = DEFAULT_LOG_LINES): string[] {
    const { logFile } = this.getPaths();
    if (!existsSync(logFile)) {
      return [];
    }
    return readFileSync(logFile, "utf8").split(/\r?\n/).filter(Boolean).slice(-Math.max(1, limit));
  }

  appendLog(message: string): void {
    const paths = this.getPaths();
    mkdirSync(paths.dir, { recursive: true });
    appendFileSync(paths.logFile, `${new Date().toISOString()} ${message}\n`, "utf8");
  }

  private clearRecord(): void {
    const { pidFile } = this.getPaths();
    rmSync(pidFile, { force: true });
  }

  private readRecord(pidFile: string): LoopDaemonRecord | null {
    try {
      const parsed = JSON.parse(readFileSync(pidFile, "utf8")) as Partial<LoopDaemonRecord>;
      if (
        typeof parsed.pid !== "number" ||
        typeof parsed.startedAt !== "number" ||
        typeof parsed.projectDir !== "string"
      ) {
        return null;
      }
      return parsed as LoopDaemonRecord;
    } catch {
      return null;
    }
  }

  private probeProcessAlive(pid: number): boolean {
    try {
      this.signalProcess(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}

export const loopDaemonManager = new LoopDaemonManager();
