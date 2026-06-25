/**
 * Task Runner 模块
 *
 * 职责:
 *   - 管理后台任务的生命周期
 *   - 持久化任务记录到磁盘
 *   - 提供任务列表查询和状态跟踪
 *   - 协调任务进程状态同步
 *
 * 模块功能:
 *   - listTasks(): 列出所有后台任务
 *   - getTask(): 获取指定任务详情
 *   - registerTask(): 注册新任务
 *   - setTaskPid(): 设置任务进程 PID
 *   - completeTask(): 标记任务完成
 *   - TaskRecord: 任务记录类型定义
 *   - 任务历史自动清理(保留 200 条/30 天)
 *   - 进程存活检测和状态协调
 *
 * 使用场景:
 *   - 后台异步执行长时间任务
 *   - 任务状态监控和查询
 *   - 跨进程任务状态共享
 *   - 任务历史记录和审计
 *
 * 边界:
 *   1. 任务执行委托给 HeadlessRunner，本模块仅管理状态
 *   2. 任务记录持久化到项目目录 .crab/tasks/
 *   3. 通过磁盘文件实现跨进程可见性
 *   4. 最大保留 200 个已完成任务，超过自动清理
 *   5. 30 天前的已完成任务自动清理
 *
 * 流程:
 *   1. 从磁盘加载任务记录到内存
 *   2. 协调运行中任务状态(检查进程存活)
 *   3. 清理过期任务历史
 *   4. 注册新任务时写入磁盘
 *   5. 任务状态变更时更新磁盘记录
 *   6. 查询时优先从内存读取，必要时同步磁盘
 */
import { createLogger } from "@/core/logging/logger";
import { getProjectCrabDir } from "@/config";
import { InternalError } from "@/core/errors/appError";
import { isProcessAlive } from "@/core/utilities";
import fs from "node:fs";
import path from "node:path";
import type { AsyncTask, TaskStatus } from "@/mission/type";

const log = createLogger("task-runner");

export interface TaskRecord {
  id: string;
  prompt: string;
  status: TaskStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  updatedAt?: number;
  error?: string;
  pid?: number;
  result?: string;
  tokenUsage?: {
    input: number;
    output: number;
  };
  sessionId?: string;
  description?: string;
  model?: string;
}

export interface CompleteTaskOptions {
  result?: string;
  tokenUsage?: {
    input: number;
    output: number;
  };
  sessionId?: string;
}

interface PersistedTaskRecord extends AsyncTask {
  pid?: number;
  updatedAt?: number;
}

/** 任务存储 */
const tasks = new Map<string, TaskRecord>();
let loadedFromDisk = false;
const MAX_TERMINAL_TASKS = 200;
const TERMINAL_TASK_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const TASK_STORE_LOCK_WAIT_MS = 2000;
const TASK_STORE_LOCK_POLL_MS = 10;
const TASK_STORE_LOCK_STALE_MS = 30_000;

function getTaskStorePath(): string {
  return path.join(getProjectCrabDir(process.cwd()), "tasks");
}

function ensureTaskStoreDir(): void {
  fs.mkdirSync(getTaskStorePath(), { recursive: true });
}

function getTaskPath(id: string): string {
  return path.join(getTaskStorePath(), `${id}.json`);
}

function getTaskStoreLockPath(): string {
  return path.join(getProjectCrabDir(process.cwd()), "tasks.lock");
}

function sleepSync(ms: number): void {
  Bun.sleepSync(ms);
}

function acquireTaskStoreLock(): () => void {
  const lockPath = getTaskStoreLockPath();
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + TASK_STORE_LOCK_WAIT_MS;

  while (true) {
    try {
      fs.mkdirSync(lockPath);
      fs.writeFileSync(
        path.join(lockPath, "owner.json"),
        JSON.stringify({ acquiredAt: Date.now(), pid: process.pid }),
        "utf8",
      );
      return () => {
        fs.rmSync(lockPath, { force: true, recursive: true });
      };
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String((error as NodeJS.ErrnoException).code ?? "") : "";
      if (code !== "EEXIST") {
        throw error;
      }

      try {
        const stat = fs.statSync(lockPath);
        if (Date.now() - stat.mtimeMs > TASK_STORE_LOCK_STALE_MS) {
          fs.rmSync(lockPath, { force: true, recursive: true });
          continue;
        }
      } catch (error) {
        log.debug(`任务存储锁检查失败: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }

      if (Date.now() >= deadline) {
        throw new InternalError("INTERNAL-902", `后台任务存储锁等待超时: ${lockPath}`);
      }
      sleepSync(TASK_STORE_LOCK_POLL_MS);
    }
  }
}

function toTaskRecord(record: PersistedTaskRecord): TaskRecord {
  return {
    completedAt: record.completedAt,
    createdAt: record.createdAt,
    description: record.description,
    error: record.error,
    id: record.id,
    model: record.model,
    pid: record.pid,
    prompt: record.prompt,
    result: record.result,
    sessionId: record.sessionId,
    startedAt: record.startedAt,
    status: record.status,
    tokenUsage: record.tokenUsage,
    updatedAt: record.updatedAt ?? record.completedAt ?? record.startedAt ?? record.createdAt,
  };
}

function readTaskStoreUnlocked(): TaskRecord[] {
  try {
    const dir = getTaskStorePath();
    if (!fs.existsSync(dir)) {
      return [];
    }
    const files = fs.readdirSync(dir).filter((file) => file.endsWith(".json"));
    return files.flatMap((file) => {
      try {
        const content = fs.readFileSync(path.join(dir, file), "utf8");
        return [toTaskRecord(JSON.parse(content) as PersistedTaskRecord)];
      } catch (error) {
        log.warn(`读取后台任务文件失败 ${file}: ${error instanceof Error ? error.message : String(error)}`);
        return [];
      }
    });
  } catch (error) {
    log.warn(`读取后台任务存储失败: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

function readTaskStore(): TaskRecord[] {
  return readTaskStoreUnlocked();
}

function getTaskRecordTimestamp(record: TaskRecord): number {
  return record.updatedAt ?? record.completedAt ?? record.startedAt ?? record.createdAt;
}

function pruneTaskRecords(records: TaskRecord[], now = Date.now()): TaskRecord[] {
  const terminalTasks = records
    .filter((task) => task.status !== "running")
    .toSorted((a, b) => getTaskRecordTimestamp(b) - getTaskRecordTimestamp(a));

  const keepIds = new Set<string>();
  for (const task of terminalTasks.slice(0, MAX_TERMINAL_TASKS)) {
    if (now - getTaskRecordTimestamp(task) <= TERMINAL_TASK_RETENTION_MS) {
      keepIds.add(task.id);
    }
  }

  return records.filter((task) => task.status === "running" || keepIds.has(task.id));
}

function mergeTaskRecords(existing: TaskRecord[], incoming: TaskRecord[]): TaskRecord[] {
  const merged = new Map<string, TaskRecord>();
  for (const record of existing) {
    merged.set(record.id, record);
  }
  for (const record of incoming) {
    const current = merged.get(record.id);
    if (!current || getTaskRecordTimestamp(record) >= getTaskRecordTimestamp(current)) {
      merged.set(record.id, record);
    }
  }
  return [...merged.values()];
}

function writeTaskStore(records: TaskRecord[]): void {
  let releaseLock: (() => void) | undefined;
  try {
    releaseLock = acquireTaskStoreLock();
    ensureTaskStoreDir();
    const dir = getTaskStorePath();
    const mergedRecords = pruneTaskRecords(mergeTaskRecords(readTaskStoreUnlocked(), records));
    const keepIds = new Set(mergedRecords.map((record) => record.id));

    for (const file of fs.readdirSync(dir).filter((item) => item.endsWith(".json"))) {
      const taskId = file.slice(0, -5);
      if (!keepIds.has(taskId)) {
        fs.rmSync(path.join(dir, file), { force: true });
      }
    }

    for (const record of mergedRecords) {
      const persisted: PersistedTaskRecord = {
        completedAt: record.completedAt,
        createdAt: record.createdAt,
        description: record.description,
        error: record.error,
        id: record.id,
        model: record.model,
        pid: record.pid,
        prompt: record.prompt,
        result: record.result,
        sessionId: record.sessionId,
        startedAt: record.startedAt,
        status: record.status,
        tokenUsage: record.tokenUsage,
        updatedAt: record.updatedAt ?? record.completedAt ?? record.startedAt ?? record.createdAt,
      };
      const taskPath = getTaskPath(record.id);
      const tmpPath = `${taskPath}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(persisted, null, 2), "utf8");
      fs.renameSync(tmpPath, taskPath);
    }

    tasks.clear();
    for (const record of mergedRecords) {
      tasks.set(record.id, record);
    }
  } catch (error) {
    log.error(`写入后台任务存储失败: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    releaseLock?.();
  }
}

function syncFromDisk(): void {
  tasks.clear();
  for (const record of readTaskStore()) {
    tasks.set(record.id, record);
  }
  pruneTaskHistory();
  reconcileRunningTasks();
  loadedFromDisk = true;
}

function persistCurrentTasks(): void {
  pruneTaskHistory();
  writeTaskStore([...tasks.values()].toSorted((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt)));
}

function ensureLoaded(): void {
  if (!loadedFromDisk) {
    syncFromDisk();
  }
}

function reconcileRunningTasks(): void {
  let changed = false;
  for (const task of tasks.values()) {
    if (task.status !== "running") {
      continue;
    }
    if (!task.pid) {
      continue;
    }
    if (isProcessAlive(task.pid)) {
      continue;
    }

    task.status = "failed";
    task.completedAt = Date.now();
    task.updatedAt = task.completedAt;
    task.error = task.error ?? "后台任务进程已退出";
    changed = true;
  }

  if (changed) {
    persistCurrentTasks();
  }
}

function pruneTaskHistory(now = Date.now()): void {
  const pruned = pruneTaskRecords([...tasks.values()], now);
  tasks.clear();
  for (const task of pruned) {
    tasks.set(task.id, task);
  }
}

/**
 * 列出所有后台任务。
 */
export async function listTasks(): Promise<TaskRecord[]> {
  syncFromDisk();
  return [...tasks.values()].toSorted((a, b) => b.createdAt - a.createdAt);
}

/**
 * 获取指定任务。
 */
export function getTask(id: string): TaskRecord | undefined {
  syncFromDisk();
  return tasks.get(id);
}

/**
 * 创建并注册后台任务记录。
 */
export function registerTask(id: string, prompt: string): TaskRecord {
  ensureLoaded();
  const now = Date.now();
  const record: TaskRecord = {
    createdAt: now,
    id,
    prompt,
    status: "running",
    updatedAt: now,
  };
  tasks.set(id, record);
  persistCurrentTasks();
  return record;
}

/**
 * 为任务补充后台进程 PID。
 */
export function setTaskPid(id: string, pid: number): void {
  ensureLoaded();
  const task = tasks.get(id);
  if (!task) {
    return;
  }
  task.pid = pid;
  task.updatedAt = Date.now();
  persistCurrentTasks();
}

/**
 * 标记任务完成。
 */
export function completeTask(id: string, error?: string, options?: CompleteTaskOptions): void {
  ensureLoaded();
  const task = tasks.get(id);
  if (task) {
    task.status = error ? "failed" : "completed";
    task.completedAt = Date.now();
    task.updatedAt = task.completedAt;
    task.error = error;
    if (options?.result !== undefined) {
      task.result = options.result;
    }
    if (options?.tokenUsage) {
      task.tokenUsage = options.tokenUsage;
    }
    if (options?.sessionId) {
      task.sessionId = options.sessionId;
    }
    persistCurrentTasks();
  }
}

function formatTimestamp(ts?: number): string {
  if (!ts) {
    return "-";
  }
  return new Date(ts).toLocaleString();
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export function formatTaskRecordLine(task: TaskRecord): string {
  const meta: string[] = [];
  if (task.pid) {
    meta.push(`pid=${task.pid}`);
  }
  meta.push(`创建: ${formatTimestamp(task.createdAt)}`);
  meta.push(`更新: ${formatTimestamp(task.updatedAt)}`);

  let line = `  [${task.status}] ${task.id} — ${truncate(task.prompt, 60)} (${meta.join(" | ")})`;
  if (task.sessionId) {
    line += `\n    会话: ${task.sessionId}`;
  }
  if (task.result) {
    line += `\n    结果: ${truncate(task.result, 120)}`;
  }
  if (task.error) {
    line += `\n    错误: ${truncate(task.error, 120)}`;
  }
  return line;
}

export function formatTaskRecordDetail(task: TaskRecord): string {
  const lines = [
    "任务管理:",
    `  ID: ${task.id}`,
    `  状态: ${task.status}`,
    `  提示词: ${task.prompt}`,
    `  创建: ${formatTimestamp(task.createdAt)}`,
    `  更新: ${formatTimestamp(task.updatedAt)}`,
  ];

  if (task.pid) {
    lines.push(`  PID: ${task.pid}`);
  }
  if (task.completedAt) {
    lines.push(`  完成: ${formatTimestamp(task.completedAt)}`);
  }
  if (task.sessionId) {
    lines.push(`  会话: ${task.sessionId}`);
  }
  if (task.tokenUsage) {
    lines.push(`  Token: input=${task.tokenUsage.input}, output=${task.tokenUsage.output}`);
  }
  if (task.result) {
    lines.push(`  结果: ${truncate(task.result, 500)}`);
  }
  if (task.error) {
    lines.push(`  错误: ${truncate(task.error, 500)}`);
  }

  return lines.join("\n");
}
