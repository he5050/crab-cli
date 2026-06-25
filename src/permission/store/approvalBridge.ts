/**
 * 权限审批桥接 — 处理外部进程的权限审批请求
 *
 * 职责:
 *   - 接收外部进程的权限请求
 *   - 通过文件系统与主进程通信
 *   - 管理权限请求的生命周期和超时
 *   - 轮询等待审批结果
 *
 * 模块功能:
 *   - ExternalPermissionRequest: 外部权限请求接口
 *   - listPendingExternalPermissionRequests: 列出待处理的外部请求
 *   - resolveExternalPermissionRequest: 解析外部权限请求
 *   - submitExternalPermissionRequest: 提交外部权限请求并等待结果
 *
 * 使用场景:
 *   - 后台任务权限审批(子进程/Worker)
 *   - 子进程权限代理
 *   - 跨进程权限同步(文件桥接方式)
 *
 * 边界:
 * 1. 使用文件系统(permission-bridge.json)作为通信桥接
 * 2. 有超时限制(默认 1 小时)，超时后自动拒绝
 * 3. 仅适用于本地进程间通信，非网络通信
 * 4. 轮询间隔 500ms，平衡响应速度和 CPU 开销
 *
 * 流程:
 * 1. 外部进程调用 submitExternalPermissionRequest 提交请求
 * 2. 请求写入桥接文件并开始轮询等待结果
 * 3. 主进程通过 listPendingExternalPermissionRequests 获取请求
 * 4. 用户审批后调用 resolveExternalPermissionRequest 写入结果
 * 5. 外部进程检测到结果后返回审批决策
 */

import fs from "node:fs";
import path from "node:path";
import { uuid } from "@/core/id";
import { createLogger } from "@/core/logging/logger";
import { getDataDir } from "@/config";
import type { ApprovalAction, PermissionAskInput } from "../manager/permission";
import { normalizeApprovalAction } from "../core/normalize";
import { createInternalError } from "@/core/errors/appError";

const log = createLogger("permission:bridge");

/**
 * 外部权限请求接口
 */
export interface ExternalPermissionRequest {
  id: string;
  sessionId?: string;
  permission: string;
  tool: string;
  patterns: string[];
  description?: string;
  riskLevel?: "low" | "medium" | "high";
  sourcePid: number;
  createdAt: number;
  status: "pending" | "resolved";
  allowed?: boolean;
  action?: ApprovalAction;
}

const BRIDGE_FILE = "permission-bridge.json";
const BRIDGE_TMP_FILE = "permission-bridge.json.tmp";
const BRIDGE_LOCK_DIR = "permission-bridge.lock";
const POLL_INITIAL_MS = 200;
const POLL_MAX_MS = 2000;
const POLL_BACKOFF_FACTOR = 1.5;
export const BACKGROUND_APPROVAL_TIMEOUT_MS = 60 * 60 * 1000;
const LOCK_RETRY_DELAY_MS = 50;
const LOCK_MAX_RETRIES = 100;

/**
 * Synchronous sleep for lock retry.
 *
 * In Bun (primary runtime): uses `Bun.sleepSync` which yields the thread.
 * In Node.js / other runtimes: uses `Atomics.wait` on a SharedArrayBuffer
 * when available, otherwise falls back to a short spin loop with a warning.
 *
 * Why a synchronous sleep is required:
 *   `withBridgeLock` is a synchronous function (callers expect a return
 *   value, not a Promise).  `Atomics.wait` is forbidden on the main thread
 *   by V8/Bun.  `setTimeout` / `node:timers/promises` are async-only.
 */
function blockingSleep(ms: number): void {
  if (typeof Bun !== "undefined" && typeof Bun.sleepSync === "function") {
    Bun.sleepSync(ms);
    return;
  }
  // Non-Bun fallback: short spin with reduced iterations
  // LOCK_RETRY_DELAY_MS=50ms × LOCK_MAX_RETRIES=100 = 5s worst case
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    // spin — acceptable because contention is rare in single-writer usage
  }
}

function getBridgePath(): string {
  return path.join(getDataDir(), BRIDGE_FILE);
}

function getBridgeTmpPath(): string {
  return path.join(getDataDir(), BRIDGE_TMP_FILE);
}

function getBridgeLockPath(): string {
  return path.join(getDataDir(), BRIDGE_LOCK_DIR);
}

function ensureBridgeDir(): void {
  fs.mkdirSync(path.dirname(getBridgePath()), { recursive: true });
}

/**
 * Acquire a cross-process exclusive lock for the bridge file.
 * Implementation uses atomic directory creation: `mkdir` is atomic on
 * POSIX, so only one process can hold the lock at a time. Removal of
 * the directory releases it. A short retry loop handles contention;
 * stale locks older than 60s are reaped automatically. This avoids
 * platform-specific `flock` syscalls (Bun's `node:fs` does not expose
 * `flockSync`) and works on macOS / Linux / WSL.
 */
function withBridgeLock<T>(fn: () => T): T {
  const lockPath = getBridgeLockPath();
  ensureBridgeDir();
  let acquired = false;
  for (let i = 0; i < LOCK_MAX_RETRIES; i += 1) {
    try {
      fs.mkdirSync(lockPath);
      acquired = true;
      break;
    } catch (error: any) {
      if (error && error.code === "EEXIST") {
        // Stale lock from a crashed process — reap if older than 60s.
        try {
          const stat = fs.statSync(lockPath);
          if (Date.now() - stat.mtimeMs > 60_000) {
            fs.rmdirSync(lockPath);
            continue;
          }
        } catch {
          // Fall through to busy-wait
        }
        blockingSleep(LOCK_RETRY_DELAY_MS);
        continue;
      }
      throw error;
    }
  }
  if (!acquired) {
    throw createInternalError("INTERNAL_ERROR", `无法获取权限桥文件锁: ${lockPath}`);
  }
  try {
    return fn();
  } finally {
    try {
      fs.rmdirSync(lockPath);
    } catch {
      // Best-effort release
    }
  }
}

function readRequests(): ExternalPermissionRequest[] {
  const bridgePath = getBridgePath();
  if (!fs.existsSync(bridgePath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(bridgePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      log.error("权限桥文件格式错误: 根元素不是数组");
      backupCorruptedBridge(bridgePath, raw);
      return [];
    }
    return parsed as ExternalPermissionRequest[];
  } catch (error) {
    log.error(`权限桥文件损坏: ${error instanceof Error ? error.message : String(error)}`);
    try {
      backupCorruptedBridge(bridgePath, fs.readFileSync(bridgePath, "utf8"));
    } catch {
      // 备份失败时忽略，原始错误已在日志中
    }
    return [];
  }
}

/** 将损坏的桥接文件备份为 .bak 后缀，保留现场用于排查 */
function backupCorruptedBridge(bridgePath: string, content: string): void {
  try {
    const bakPath = `${bridgePath}.bak.${Date.now()}`;
    fs.writeFileSync(bakPath, content, "utf8");
    log.info(`损坏的桥接文件已备份: ${bakPath}`);
  } catch {
    // 备份失败不影响主流程
  }
}

/**
 * Atomic write: serialize to a temp file in the same directory, then
 * `rename` over the destination. POSIX `rename` is atomic within a
 * filesystem, so concurrent readers always see a complete snapshot.
 */
function writeRequests(requests: ExternalPermissionRequest[]): void {
  ensureBridgeDir();
  const tmp = getBridgeTmpPath();
  fs.writeFileSync(tmp, JSON.stringify(requests, null, 2), "utf8");
  fs.renameSync(tmp, getBridgePath());
}

function upsertRequest(request: ExternalPermissionRequest): void {
  withBridgeLock(() => {
    const requests = readRequests();
    const idx = requests.findIndex((item) => item.id === request.id);
    if (idx !== -1) {
      requests[idx] = request;
    } else {
      requests.push(request);
    }
    writeRequests(requests);
  });
}

function removeRequest(id: string): void {
  withBridgeLock(() => {
    const requests = readRequests().filter((item) => item.id !== id);
    writeRequests(requests);
  });
}

export function listPendingExternalPermissionRequests(): ExternalPermissionRequest[] {
  return readRequests()
    .filter((item) => item.status === "pending")
    .toSorted((a, b) => a.createdAt - b.createdAt);
}

export function resolveExternalPermissionRequest(id: string, decision: ApprovalAction | boolean): boolean {
  return withBridgeLock(() => {
    const requests = readRequests();
    const target = requests.find((item) => item.id === id);
    if (!target) {
      return false;
    }
    const action = normalizeApprovalAction(decision);
    target.status = "resolved";
    target.action = action;
    target.allowed = action !== "reject";
    writeRequests(requests);
    return true;
  });
}

export interface RemotePermissionResolveResult {
  ok: boolean;
  reason?: "not_found" | "session_required" | "session_mismatch" | "already_resolved";
}

export function resolveExternalPermissionRequestForSession(
  id: string,
  sessionId: string,
  decision: ApprovalAction | boolean,
): RemotePermissionResolveResult {
  return withBridgeLock(() => {
    const requests = readRequests();
    const target = requests.find((item) => item.id === id);
    if (!target) {
      return { ok: false, reason: "not_found" };
    }
    if (target.status !== "pending") {
      return { ok: false, reason: "already_resolved" };
    }
    if (!target.sessionId) {
      return { ok: false, reason: "session_required" };
    }
    if (target.sessionId !== sessionId) {
      return { ok: false, reason: "session_mismatch" };
    }
    const action = normalizeApprovalAction(decision);
    target.status = "resolved";
    target.action = action;
    target.allowed = action !== "reject";
    writeRequests(requests);
    return { ok: true };
  });
}

export async function submitExternalPermissionRequest(
  input: PermissionAskInput & { riskLevel?: "low" | "medium" | "high" },
  timeoutMs = BACKGROUND_APPROVAL_TIMEOUT_MS,
): Promise<ApprovalAction | boolean> {
  const request: ExternalPermissionRequest = {
    createdAt: Date.now(),
    description: input.description,
    id: uuid(),
    patterns: input.patterns,
    permission: input.permission,
    riskLevel: input.riskLevel,
    sessionId: input.sessionId,
    sourcePid: process.pid,
    status: "pending",
    tool: input.tool,
  };

  upsertRequest(request);
  log.info(`外部权限请求已提交: ${request.permission} ${request.patterns.join(", ")}`);

  const startedAt = Date.now();
  let pollInterval = POLL_INITIAL_MS;
  try {
    while (Date.now() - startedAt < timeoutMs) {
      const latest = readRequests().find((item) => item.id === request.id);
      if (latest?.status === "resolved") {
        if (latest.action) {
          return latest.action;
        }
        return latest.allowed === true ? "once" : "reject";
      }
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      pollInterval = Math.min(pollInterval * POLL_BACKOFF_FACTOR, POLL_MAX_MS);
    }
    log.warn(`外部权限请求超时: ${request.id}`);
    return false;
  } finally {
    removeRequest(request.id);
  }
}
