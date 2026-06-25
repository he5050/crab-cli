/**
 * SSE Manager 模块
 *
 * 职责:
 *   - SSE 服务器进程管理(启动、停止、状态查询)
 *   - PID 文件读写和管理
 *   - 服务器状态监控和查询
 *   - 守护进程生命周期管理
 *   - 端口占用检测和可用端口查找
 *
 * 模块功能:
 *   - getSseServerStatus(): 获取服务器状态
 *   - getAllSseServerStatuses(): 获取所有端口级服务器状态
 *   - stopSseServer(): 停止 SSE 服务器
 *   - stopAllSseServers(): 停止所有端口级 SSE 服务器
 *   - registerSseServer(): 注册当前进程为 SSE 服务器
 *   - unregisterSseServer(): 注销 SSE 服务器
 *   - formatSseStatus(): 格式化状态信息
 *   - formatSseStatuses(): 格式化多端口状态信息
 *   - isPortInUse(): 检查端口是否被占用
 *   - findAvailablePort(): 查找可用端口
 *   - SseServerStatus: 状态类型定义
 *
 * 使用场景:
 *   - 守护进程模式启动 SSE 服务器
 *   - 查询 SSE 服务器运行状态
 *   - 停止正在运行的 SSE 服务器
 *   - 端口冲突检测和自动分配
 *
 * 边界:
 *   1. 仅管理进程，不处理 SSE 协议本身
 *   2. PID 文件存储在项目目录 .crab/sse-daemon/port-{port}.pid，并兼容旧 .crab/sse-server.pid
 *   3. 进程存活检测使用 kill(pid, 0) 信号
 *   4. 停止服务器时先发送 SIGTERM，超时后发送 SIGKILL
 *   5. 默认端口 3000，最多尝试 10 个连续端口
 *
 * 流程:
 *   1. 读取 PID 文件获取进程信息
 *   2. 检查进程是否存活
 *   3. 返回服务器状态(运行中/未运行)
 *   4. 停止时发送终止信号并等待进程退出
 *   5. 清理 PID 文件
 */

import { createLogger } from "@/core/logging/logger";
import { getProjectCrabDir } from "@/config";
import { VERSION } from "@/config/version";
import fs from "node:fs";
import path from "node:path";

const log = createLogger("sse-manager");

const sseManagerDeps = {
  getProjectCrabDir,
  version: VERSION,
};

export function __setSseManagerDepsForTesting(overrides: Partial<typeof sseManagerDeps>): void {
  Object.assign(sseManagerDeps, overrides);
}

export function __resetSseManagerDepsForTesting(): void {
  sseManagerDeps.getProjectCrabDir = getProjectCrabDir;
  sseManagerDeps.version = VERSION;
}

/** SSE 服务器状态 */
export interface SseServerStatus {
  running: boolean;
  starting?: boolean;
  pid?: number;
  port?: number;
  startedAt?: number;
  version?: string;
  error?: string;
}

/** PID 文件数据 */
interface PidFileData {
  pid: number;
  port: number;
  startedAt: number;
  version: string;
  ready?: boolean;
}

/** stopAllSseServers 返回类型 */
interface StopAllResult {
  success: boolean;
  message: string;
  results: { port?: number; success: boolean; message: string }[];
}

const PID_FILE_NAME = "sse-server.pid";
const DAEMON_DIR_NAME = "sse-daemon";
const DEFAULT_PORT = 3000;

/**
 * 获取 PID 文件路径
 */
function getLegacyPidFilePath(): string {
  return path.join(sseManagerDeps.getProjectCrabDir(process.cwd()), PID_FILE_NAME);
}

function getPortPidFilePath(port: number): string {
  return path.join(sseManagerDeps.getProjectCrabDir(process.cwd()), DAEMON_DIR_NAME, `port-${port}.pid`);
}

function listPortPidFilePaths(): string[] {
  const daemonDir = path.join(sseManagerDeps.getProjectCrabDir(process.cwd()), DAEMON_DIR_NAME);
  try {
    if (!fs.existsSync(daemonDir)) {
      return [];
    }
    return fs
      .readdirSync(daemonDir)
      .filter((name) => /^port-\d+\.pid$/.test(name))
      .map((name) => path.join(daemonDir, name));
  } catch (error) {
    log.warn(`读取 SSE daemon PID 目录失败: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/**
 * 检查进程是否存活
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      const code = String((error as NodeJS.ErrnoException).code ?? "");
      if (code === "EPERM") {
        return true;
      }
    }
    return false;
  }
}

/**
 * 读取 PID 文件
 */
function readPidFile(pidFile: string = getLegacyPidFilePath()): PidFileData | null {
  try {
    if (!fs.existsSync(pidFile)) {
      return null;
    }
    const content = fs.readFileSync(pidFile, "utf8");
    return JSON.parse(content) as PidFileData;
  } catch (error) {
    log.warn(`读取 PID 文件失败: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function readPidFileForPort(port: number): PidFileData | null {
  const portData = readPidFile(getPortPidFilePath(port));
  if (portData) {
    return portData;
  }

  const legacyData = readPidFile(getLegacyPidFilePath());
  if (legacyData?.port === port) {
    return legacyData;
  }
  return null;
}

/**
 * 写入 PID 文件
 */
function writePidFile(data: PidFileData): void {
  writePidFileAt(getPortPidFilePath(data.port), data);
  writePidFileAt(getLegacyPidFilePath(), data);
}

function writePidFileAt(pidFile: string, data: PidFileData): void {
  try {
    fs.mkdirSync(path.dirname(pidFile), { recursive: true });
    fs.writeFileSync(pidFile, JSON.stringify(data, null, 2), "utf8");
  } catch (error) {
    log.error(`写入 PID 文件失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 删除 PID 文件
 */
function removePidFile(port?: number): void {
  const paths = new Set<string>();
  if (typeof port === "number") {
    paths.add(getPortPidFilePath(port));
    const legacy = readPidFile(getLegacyPidFilePath());
    if (legacy?.port === port) {
      paths.add(getLegacyPidFilePath());
    }
  } else {
    const legacy = readPidFile(getLegacyPidFilePath());
    if (legacy?.port) {
      paths.add(getPortPidFilePath(legacy.port));
    }
    paths.add(getLegacyPidFilePath());
  }

  for (const pidFile of paths) {
    removePidFileAt(pidFile);
  }
}

function removePidFileAt(pidFile: string): void {
  try {
    if (fs.existsSync(pidFile)) {
      fs.unlinkSync(pidFile);
    }
  } catch (error) {
    log.warn(`删除 PID 文件失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 获取 SSE 服务器状态
 */
export function getSseServerStatus(port?: number): SseServerStatus {
  const pidData = typeof port === "number" ? readPidFileForPort(port) : readPidFile();

  if (!pidData) {
    return { running: false };
  }

  // 检查进程是否存活
  if (!isProcessAlive(pidData.pid)) {
    // 进程已死亡，清理 PID 文件
    removePidFile(pidData.port);
    return { error: "进程已退出", running: false };
  }

  const ready = pidData.ready !== false;

  if (!ready) {
    return {
      pid: pidData.pid,
      port: pidData.port,
      running: false,
      startedAt: pidData.startedAt,
      starting: true,
      version: pidData.version,
    };
  }

  return {
    pid: pidData.pid,
    port: pidData.port,
    running: true,
    startedAt: pidData.startedAt,
    version: pidData.version,
  };
}

/**
 * 获取所有端口级 SSE 服务器状态。
 */
export function getAllSseServerStatuses(): SseServerStatus[] {
  const seen = new Set<string>();
  const statuses: SseServerStatus[] = [];
  for (const pidFile of [getLegacyPidFilePath(), ...listPortPidFilePaths()]) {
    if (seen.has(pidFile)) {
      continue;
    }
    seen.add(pidFile);
    const data = readPidFile(pidFile);
    if (!data) {
      continue;
    }
    const key = `${data.pid}:${data.port}`;
    if (statuses.some((status) => `${status.pid}:${status.port}` === key)) {
      continue;
    }
    const status = getSseServerStatus(data.port);
    if (status.running || status.starting || status.error) {
      statuses.push(status);
    }
  }
  return statuses;
}

/**
 * 停止 SSE 服务器
 */
export async function stopSseServer(port?: number): Promise<{ success: boolean; message: string }> {
  const status = getSseServerStatus(port);

  if (!status.running && !status.starting) {
    return { message: "SSE 服务器未运行", success: false };
  }

  if (!status.pid) {
    return { message: "无法获取服务器 PID", success: false };
  }

  try {
    // 发送 SIGTERM 信号
    process.kill(status.pid, "SIGTERM");
    log.info(`已发送停止信号到进程 ${status.pid}`);

    // 等待进程退出(最多 5 秒)
    let attempts = 0;
    const maxAttempts = 50;
    while (attempts < maxAttempts) {
      if (!isProcessAlive(status.pid)) {
        removePidFile(status.port ?? port);
        return { message: `SSE 服务器已停止 (PID: ${status.pid})`, success: true };
      }
      await Bun.sleep(100);
      attempts++;
    }

    // 强制终止
    process.kill(status.pid, "SIGKILL");
    removePidFile(status.port ?? port);
    return { message: `SSE 服务器已强制停止 (PID: ${status.pid})`, success: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error(`停止 SSE 服务器失败: ${error}`);
    return { message: `停止失败: ${error}`, success: false };
  }
}

/**
 * 停止所有端口级 SSE 服务器。
 */
export async function stopAllSseServers(): Promise<StopAllResult> {
  const statuses = getAllSseServerStatuses().filter((status) => status.running || status.starting);
  if (statuses.length === 0) {
    return { message: "SSE 服务器未运行", results: [], success: false };
  }

  const seenPorts = new Set<number>();
  const results: { port?: number; success: boolean; message: string }[] = [];
  for (const status of statuses) {
    if (typeof status.port === "number") {
      if (seenPorts.has(status.port)) {
        continue;
      }
      seenPorts.add(status.port);
    }
    const result = await stopSseServer(status.port);
    results.push({ port: status.port, ...result });
  }

  const successCount = results.filter((result) => result.success).length;
  const failedCount = results.length - successCount;
  const lines = [
    `SSE 服务器批量停止完成: ${successCount} 成功, ${failedCount} 失败`,
    ...results.map((result) => `  ${result.port ?? "unknown"}: ${result.message}`),
  ];

  return {
    message: lines.join("\n"),
    results,
    success: successCount > 0 && failedCount === 0,
  };
}

/**
 * 注册当前进程为 SSE 服务器
 * 在 SSE 服务器启动时调用
 */
export function registerSseServer(port: number = DEFAULT_PORT, ready: boolean = true): void {
  registerSseServerProcess(process.pid, port, ready);
}

export function registerSseServerProcess(pid: number, port: number = DEFAULT_PORT, ready: boolean = true): void {
  const data: PidFileData = {
    pid,
    port,
    ready,
    startedAt: Date.now(),
    version: sseManagerDeps.version,
  };
  writePidFile(data);
  log.info(`SSE 服务器已注册: PID=${data.pid}, Port=${port}`);
}

export function markSseServerReady(port?: number): void {
  const existing = typeof port === "number" ? readPidFileForPort(port) : readPidFile();
  if (!existing) {
    return;
  }
  writePidFile({
    ...existing,
    ready: true,
  });
  log.info(`SSE 服务器已就绪: PID=${existing.pid}, Port=${existing.port}`);
}

export function markSseServerReadyForPid(pid: number): void {
  for (const pidFile of [getLegacyPidFilePath(), ...listPortPidFilePaths()]) {
    const existing = readPidFile(pidFile);
    if (!existing || existing.pid !== pid) {
      continue;
    }
    writePidFile({
      ...existing,
      ready: true,
    });
    log.info(`SSE 服务器已就绪: PID=${existing.pid}, Port=${existing.port}`);
    return;
  }
}

export async function waitForSseServerReady(
  expectedPid: number,
  expectedPort?: number,
  timeoutMs: number = 30_000,
  pollMs: number = 200,
): Promise<{ ready: boolean; port?: number; message?: string }> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (!isProcessAlive(expectedPid)) {
      return { message: "进程已退出", ready: false };
    }

    const status = getSseServerStatus(expectedPort);
    const port = expectedPort ?? status.port;
    if (port) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`);
        if (response.ok) {
          const body = (await response.json()) as { status?: string };
          if (body.status === "ok") {
            return { port, ready: true };
          }
        }
      } catch {
        // 服务端口尚未真正 ready，继续轮询
      }
    }

    if (status.pid === expectedPid && status.error) {
      return { message: status.error, ready: false };
    }

    await Bun.sleep(pollMs);
  }

  return { message: "SSE 服务器启动超时", ready: false };
}

/**
 * 注销 SSE 服务器
 * 在 SSE 服务器退出时调用
 */
export function unregisterSseServer(port?: number): void {
  removePidFile(port);
  log.info("SSE 服务器已注销");
}

/**
 * 格式化状态信息为可读字符串
 */
export function formatSseStatus(status: SseServerStatus): string {
  if (status.starting) {
    const lines: string[] = ["SSE 服务器: 启动中"];
    if (status.pid) {
      lines.push(`  PID: ${status.pid}`);
    }
    if (status.port) {
      lines.push(`  端口: ${status.port}`);
    }
    if (status.version) {
      lines.push(`  版本: ${status.version}`);
    }
    if (status.startedAt) {
      const started = new Date(status.startedAt).toLocaleString("zh-CN");
      lines.push(`  启动时间: ${started}`);
    }
    return lines.join("\n");
  }

  if (!status.running) {
    return "SSE 服务器: 未运行";
  }

  const lines: string[] = ["SSE 服务器: 运行中"];
  if (status.pid) {
    lines.push(`  PID: ${status.pid}`);
  }
  if (status.port) {
    lines.push(`  端口: ${status.port}`);
  }
  if (status.version) {
    lines.push(`  版本: ${status.version}`);
  }
  if (status.startedAt) {
    const started = new Date(status.startedAt).toLocaleString("zh-CN");
    lines.push(`  启动时间: ${started}`);
  }

  return lines.join("\n");
}

/**
 * 格式化多端口状态信息为可读字符串。
 */
export function formatSseStatuses(statuses: SseServerStatus[]): string {
  if (statuses.length === 0) {
    return "SSE 服务器: 未运行";
  }

  return [
    `SSE 服务器列表: ${statuses.length} 个记录`,
    ...statuses.map((status) =>
      formatSseStatus(status)
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n"),
    ),
  ].join("\n");
}

/**
 * 检查端口是否被占用
 */
export function isPortInUse(port: number): boolean {
  try {
    // 尝试监听端口，如果失败则说明端口被占用
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port,
      socket: {
        close() {},
        data() {},
        drain() {},
        error() {},
        open() {},
      },
    });
    server.stop();
    return false;
  } catch (error) {
    log.debug(`端口检测异常: ${error instanceof Error ? error.message : String(error)}`);
    return true;
  }
}

/**
 * 查找可用端口
 */
export function findAvailablePort(startPort: number = DEFAULT_PORT, maxAttempts: number = 10): number | null {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    if (!isPortInUse(port)) {
      return port;
    }
  }
  return null;
}
