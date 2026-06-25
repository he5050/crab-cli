/**
 * [Loop 管理器]
 *
 * 职责:
 *   - 管理定时任务的创建、启动和取消
 *   - 解析时间格式(如 "5m", "1h", "30s", "every 2h")
 *   - 定时触发任务执行
 *   - 限制最大活跃 Loop 数量
 *
 * 模块功能:
 *   - createLoop: 创建新的定时 Loop
 *   - startLoop: 启动 Loop 的定时执行
 *   - cancelLoop: 取消指定的 Loop
 *   - listLoops: 列出所有 Loop
 *   - listTaskSummaries: 获取所有 Loop 关联的任务摘要
 *   - formatLoopSummary: 格式化 Loop 摘要
 *   - stopAll: 停止所有 Loop
 *   - parseLoopSchedule: 解析时间格式字符串
 *
 * 使用场景:
 *   - 用户通过 /loop 命令创建定时任务
 *   - 需要周期性执行某些操作
 *   - 定时触发 AI 会话处理特定提示词
 *
 * 边界:
 *   1. 最多支持 5 个活跃 Loop
 *   2. 时间解析仅支持 h/m/s 单位
 *   3. Loop 与 Task 是关联关系，非包含关系
 *   4. 进程退出时 Loop 不会自动恢复
 *
 * 流程:
 *   1. 用户输入时间格式和提示词
 *   2. parseLoopSchedule 解析时间格式
 *   3. createLoop 创建 Loop 记录
 *   4. startLoop 启动定时器
 *   5. 定时触发创建 Task 执行
 */

import { createLogger } from "@/core/logging/logger";
import { iconLoading } from "@/core/icons/icon";
import { shortUuid } from "@/core/id";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { globalBus, type EventBus } from "@/bus/core/eventBus";
import { LoopEvents } from "@/bus/events/loopEvents";
import type { AppConfigSchema } from "@/schema/config";
import type { TaskManager } from "../task/manager";
import { createInternalError } from "@/core/errors/appError";
import { calculateNextCronRun, scheduleLabel } from "./schedule";
import type { LoopExecutionRecord, LoopRecord, LoopScheduleInput, LoopStats } from "./schedule";

const log = createLogger("task:loop");

interface LoopManagerDeps {
  taskManager?: TaskManager;
}

const loopManagerDeps: LoopManagerDeps = {};

async function getTaskManager(): Promise<TaskManager> {
  if (loopManagerDeps.taskManager) {
    return loopManagerDeps.taskManager;
  }
  const mod = await import("../task/manager");
  return mod.taskManager;
}

export function __setLoopManagerDepsForTesting(overrides: Partial<LoopManagerDeps>): void {
  Object.assign(loopManagerDeps, overrides);
}

export function __resetLoopManagerDepsForTesting(): void {
  loopManagerDeps.taskManager = undefined;
}

export { calculateNextCronRun, parseLoopSchedule, scheduleLabel, validateCron } from "./schedule";
export type { LoopExecutionRecord, LoopRecord, LoopScheduleInput, LoopStats } from "./schedule";

/** 默认最大活跃 Loop 数 */
const DEFAULT_MAX_ACTIVE_LOOPS = 10;

/** 每条历史记录文件最大条目数 */
const MAX_HISTORY_PER_LOOP = 200;

/** 历史记录文件名模板 */
const HISTORY_FILE_TEMPLATE = (loopId: string) => `history_${loopId}.json`;

// ─── LoopManager ─────────────────────────────────────────────

const LOOPS_FILE = "loops.json";

export class LoopManager {
  private loops = new Map<string, LoopRecord>();
  private projectDir: string | null = null;
  private maxActive = DEFAULT_MAX_ACTIVE_LOOPS;
  private _config: AppConfigSchema | null = null;
  private readonly eventBus?: EventBus;

  /** 执行历史缓存(loopId → records，懒加载) */
  private historyCache = new Map<string, LoopExecutionRecord[]>();

  constructor(eventBus?: EventBus) {
    this.eventBus = eventBus;
  }

  private getEventBus(): EventBus {
    return this.eventBus ?? globalBus;
  }

  setProjectDir(dir: string): void {
    this.projectDir = dir;
  }

  setMaxActive(n: number): void {
    this.maxActive = Math.max(1, Math.min(50, n));
  }

  setConfig(config: AppConfigSchema): void {
    this._config = config;
  }

  getLoop(loopId: string): LoopRecord | undefined {
    return this.loops.get(loopId);
  }

  /**
   * 创建新的定时 Loop。
   */
  createLoop(schedule: LoopScheduleInput): LoopRecord {
    if (this.loops.size >= this.maxActive) {
      throw createInternalError("INTERNAL_ERROR", `最多支持 ${this.maxActive} 个活跃 Loop。请先取消一些。`);
    }

    const id = shortUuid().slice(0, 8);
    const now = Date.now();
    const nextRunAt = schedule.intervalMs
      ? now + schedule.intervalMs
      : schedule.cronExpr
        ? calculateNextCronRun(schedule.cronExpr)
        : schedule.delayMs
          ? now + schedule.delayMs
          : now + 60_000;

    const loop: LoopRecord = {
      active: true,
      createdAt: now,
      cronExpr: schedule.cronExpr,
      delayMs: schedule.delayMs,
      description: schedule.description,
      enabled: true,
      id,
      intervalLabel: schedule.intervalLabel,
      intervalMs: schedule.intervalMs,
      nextRunAt,
      prompt: schedule.prompt,
      runCount: 0,
    };

    this.loops.set(id, loop);
    this.saveToDisk();

    log.info(`Loop 已创建: ${id}, schedule=${scheduleLabel(loop)}, prompt=${schedule.prompt.slice(0, 40)}`);

    return loop;
  }

  /**
   * 启动 Loop 的定时执行。
   * 支持三种调度模式:固定间隔、cron 表达式、一次性延迟。
   */
  startLoop(loopId: string, config?: AppConfigSchema): void {
    const resolved = config ?? this._config;
    if (!resolved) {
      log.warn(`Loop ${loopId}: 无法启动，缺少 config`);
      return;
    }

    const loop = this.loops.get(loopId);
    if (!loop || !loop.active) {
      return;
    }

    if (loop._timer) {
      this.clearLoopTimer(loop);
    }

    if (loop.intervalMs !== undefined) {
      this.startIntervalLoop(loop, resolved);
    } else if (loop.cronExpr !== undefined) {
      this.startCronLoop(loop, resolved);
    } else if (loop.delayMs !== undefined) {
      this.startDelayLoop(loop, resolved);
    }
  }

  private startIntervalLoop(loop: LoopRecord, config: AppConfigSchema): void {
    const intervalMs = loop.intervalMs!;
    loop._timer = setInterval(async () => {
      try {
        await this.executeLoopTask(loop, config, intervalMs);
      } catch (error) {
        log.error(`Loop ${loop.id} interval 回调异常: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, intervalMs);
    this.unrefTimer(loop);
  }

  private startCronLoop(loop: LoopRecord, config: AppConfigSchema): void {
    const scheduleNext = () => {
      if (!loop.active || !loop.enabled) {
        return;
      }
      const nextRun = calculateNextCronRun(loop.cronExpr!);
      const delayMs = Math.max(nextRun - Date.now(), 1000);
      loop.nextRunAt = nextRun;
      this.saveToDisk();
      loop._timer = setTimeout(async () => {
        await this.executeLoopTask(loop, config);
        scheduleNext();
      }, delayMs);
      this.unrefTimer(loop);
    };
    scheduleNext();
  }

  private startDelayLoop(loop: LoopRecord, config: AppConfigSchema): void {
    loop._timer = setTimeout(async () => {
      await this.executeLoopTask(loop, config);
      loop.active = false;
      this.saveToDisk();
    }, loop.delayMs!);
    this.unrefTimer(loop);
  }

  private async executeLoopTask(loop: LoopRecord, config: AppConfigSchema, nextInterval?: number): Promise<void> {
    const taskMgr = await getTaskManager();
    if (loop.lastTaskId) {
      const prevTask = taskMgr.get(loop.lastTaskId);
      if (prevTask && prevTask.status === "running") {
        log.info(`Loop ${loop.id}: 上次任务 ${loop.lastTaskId} 仍在运行，跳过`);
        this.recordHistory({ executedAt: Date.now(), loopId: loop.id, status: "skipped" });
        this.getEventBus().publish(LoopEvents.LoopExecuted, {
          loopId: loop.id,
          runCount: loop.runCount,
          status: "skipped",
        });
        return;
      }
    }

    log.info(`Loop ${loop.id}: 触发定时执行`);
    try {
      const taskId = await taskMgr.create(loop.prompt, config, {
        description: `Loop ${loop.id} (${scheduleLabel(loop)})`,
      });
      loop.lastTaskId = taskId;
      loop.lastRunAt = Date.now();
      loop.runCount += 1;
      if (nextInterval) {
        loop.nextRunAt = loop.lastRunAt + nextInterval;
      }

      this.recordHistory({ executedAt: loop.lastRunAt, loopId: loop.id, status: "success", taskId });

      this.getEventBus().publish(LoopEvents.LoopExecuted, {
        loopId: loop.id,
        runCount: loop.runCount,
        status: "success",
        taskId,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error(`Loop ${loop.id} 执行失败: ${msg}`);
      this.recordHistory({ error: msg, executedAt: Date.now(), loopId: loop.id, status: "error" });
      this.getEventBus().publish(LoopEvents.LoopExecuted, {
        error: msg,
        loopId: loop.id,
        runCount: loop.runCount,
        status: "error",
      });
    }
  }

  /** 安全清理定时器（兼容 setInterval 和 setTimeout） */
  private clearLoopTimer(loop: LoopRecord): void {
    if (loop._timer) {
      clearInterval(loop._timer);
      clearTimeout(loop._timer);
    }
    loop._timer = undefined;
  }

  private unrefTimer(loop: LoopRecord): void {
    if (loop._timer && typeof loop._timer === "object" && "unref" in loop._timer) {
      loop._timer.unref();
    }
  }

  /**
   * 取消 Loop。
   */
  cancelLoop(loopId: string): LoopRecord | null {
    const loop = this.loops.get(loopId);
    if (!loop) {
      return null;
    }

    this.clearLoopTimer(loop);
    loop.active = false;
    this.saveToDisk();

    log.info(`Loop 已取消: ${loopId}`);
    return loop;
  }

  /**
   * 暂停 Loop(保持 active，停止定时器)。
   */
  pauseLoop(loopId: string): boolean {
    const loop = this.loops.get(loopId);
    if (!loop || !loop.active) {
      return false;
    }

    this.clearLoopTimer(loop);
    loop.enabled = false;
    this.saveToDisk();

    log.info(`Loop 已暂停: ${loopId}`);
    return true;
  }

  /**
   * 恢复已暂停的 Loop。
   */
  resumeLoop(loopId: string, config?: AppConfigSchema): boolean {
    const loop = this.loops.get(loopId);
    if (!loop || !loop.active || loop.enabled) {
      return false;
    }

    const resolved = config ?? this._config;
    loop.enabled = true;
    if (resolved) {
      this.startLoop(loopId, resolved);
    } else {
      log.warn(`Loop ${loopId}: 已恢复 enabled 状态，但缺少 config，暂不启动定时器`);
    }
    this.saveToDisk();

    log.info(`Loop 已恢复: ${loopId}`);
    return true;
  }

  /**
   * 列出所有 Loop。
   */
  listLoops(): LoopRecord[] {
    return [...this.loops.values()].toSorted((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * 获取所有 Loop 关联的任务摘要。
   */
  listTaskSummaries(): string[] {
    const summaries: string[] = [];
    for (const loop of this.loops.values()) {
      const status = loop.active ? iconLoading : "⊘";
      const lastTask = loop.lastTaskId
        ? (() => {
            // 同步快照: 如果已注入测试替身则用之，否则返回占位文本
            const t = loopManagerDeps.taskManager?.get(loop.lastTaskId);
            return t ? ` → ${t.status}` : "";
          })()
        : "";
      summaries.push(`${status} ${loop.id} (${scheduleLabel(loop)}) "${loop.prompt.slice(0, 40)}"${lastTask}`);
    }
    return summaries;
  }

  /**
   * 格式化 Loop 摘要。
   */
  formatLoopSummary(loop: LoopRecord): string {
    const status = loop.active ? iconLoading : "⊘";
    const next = new Date(loop.nextRunAt).toLocaleString();
    const last = loop.lastTaskId ? ` (上次: ${loop.lastTaskId})` : "";
    const stats = this.getStats(loop.id);
    const statsLine =
      stats && stats.totalRuns > 0
        ? `\n  统计: ${stats.successCount} 成功 / ${stats.skippedCount} 跳过 / ${stats.errorCount} 失败`
        : "";
    return [
      `${status} Loop ${loop.id}`,
      `  间隔: ${scheduleLabel(loop)}`,
      `  提示词: ${loop.prompt.slice(0, 60)}`,
      `  下次执行: ${next}${last}`,
      `  累计执行: ${loop.runCount} 次${statsLine}`,
    ].join("\n");
  }

  /**
   * 停止所有 Loop。
   */
  stopAll(): void {
    for (const [, loop] of this.loops) {
      this.clearLoopTimer(loop);
      loop.active = false;
    }
    this.saveToDisk();
    log.info(`所有 Loop 已停止`);
  }

  /**
   * 挂起所有定时器，但保留 active/enabled 状态，供 daemon 停止后恢复。
   */
  suspendTimers(): void {
    for (const [, loop] of this.loops) {
      this.clearLoopTimer(loop);
    }
    this.saveToDisk();
    log.info("所有 Loop 定时器已挂起");
  }

  /**
   * 将所有 Loop 持久化到磁盘。
   */
  private saveToDisk(): void {
    if (!this.projectDir) {
      return;
    }
    const dir = join(this.projectDir, ".crab");
    try {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const data = [...this.loops.values()].map(({ _timer, ...rest }) => rest);
      writeFileSync(join(dir, LOOPS_FILE), JSON.stringify(data, null, 2), "utf8");
    } catch (error) {
      log.error(`Loop 持久化失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 从磁盘加载 Loop 记录(不启动定时器)。
   */
  loadFromDisk(projectDir: string): void {
    this.projectDir = projectDir;
    this.historyCache.clear();
    const filePath = join(projectDir, ".crab", LOOPS_FILE);
    if (!existsSync(filePath)) {
      return;
    }
    try {
      const raw = readFileSync(filePath, "utf8");
      const items = JSON.parse(raw) as Omit<LoopRecord, "_timer">[];
      for (const item of items) {
        this.loops.set(item.id, { ...item });
      }
      log.info(`从磁盘加载了 ${items.length} 个 Loop`);
    } catch (error) {
      log.error(`Loop 加载失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 获取指定 Loop 的执行历史。
   */
  getHistory(loopId: string, limit?: number): LoopExecutionRecord[] {
    const records = this.loadHistory(loopId);
    const n = limit ?? 50;
    return records.slice(-n);
  }

  /**
   * 获取指定 Loop 的统计信息。
   */
  getStats(loopId: string): LoopStats | null {
    const loop = this.loops.get(loopId);
    if (!loop) {
      return null;
    }

    const records = this.loadHistory(loopId);
    const successCount = records.filter((r) => r.status === "success").length;
    const skippedCount = records.filter((r) => r.status === "skipped").length;
    const errorCount = records.filter((r) => r.status === "error").length;

    const successRecords = records.filter((r) => r.status === "success");
    let avgIntervalMs: number | undefined;
    if (successRecords.length >= 2) {
      const recent = successRecords.slice(-10);
      const intervals: number[] = [];
      for (let i = 1; i < recent.length; i++) {
        intervals.push(recent[i]!.executedAt - recent[i - 1]!.executedAt);
      }
      avgIntervalMs =
        intervals.length > 0 ? Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length) : undefined;
    }

    return {
      avgIntervalMs,
      errorCount,
      loopId,
      recentHistory: records.slice(-20),
      skippedCount,
      successCount,
      totalRuns: records.length,
    };
  }

  /**
   * 清除指定 Loop 的执行历史。
   */
  clearHistory(loopId: string): boolean {
    this.historyCache.delete(loopId);
    if (!this.projectDir) {
      return false;
    }
    const filePath = join(this.projectDir, ".crab", "loops", HISTORY_FILE_TEMPLATE(loopId));
    try {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
        log.info(`Loop ${loopId} 执行历史已清除`);
      }
      return true;
    } catch (error) {
      log.error(`清除 Loop ${loopId} 历史失败: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /** 记录一次执行到内存缓存并异步持久化 */
  private recordHistory(record: LoopExecutionRecord): void {
    const { loopId } = record;
    if (!this.historyCache.has(loopId)) {
      this.historyCache.set(loopId, this.loadHistory(loopId));
    }
    const list = this.historyCache.get(loopId)!;
    list.push(record);
    if (list.length > MAX_HISTORY_PER_LOOP) {
      list.splice(0, list.length - MAX_HISTORY_PER_LOOP);
    }
    this.persistHistory(loopId, list);
  }

  /** 持久化历史记录到磁盘 */
  private persistHistory(loopId: string, records: LoopExecutionRecord[]): void {
    if (!this.projectDir) {
      return;
    }
    const dir = join(this.projectDir, ".crab", "loops");
    try {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(join(dir, HISTORY_FILE_TEMPLATE(loopId)), JSON.stringify(records, null, 2), "utf8");
    } catch (error) {
      log.error(`Loop ${loopId} 历史持久化失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** 从磁盘加载历史记录 */
  private loadHistory(loopId: string): LoopExecutionRecord[] {
    if (this.historyCache.has(loopId)) {
      return this.historyCache.get(loopId)!;
    }
    if (!this.projectDir) {
      return [];
    }
    const filePath = join(this.projectDir, ".crab", "loops", HISTORY_FILE_TEMPLATE(loopId));
    try {
      if (existsSync(filePath)) {
        const raw = readFileSync(filePath, "utf8");
        const records = JSON.parse(raw) as LoopExecutionRecord[];
        this.historyCache.set(loopId, records);
        return records;
      }
    } catch (error) {
      log.debug(`Loop ${loopId} 历史加载失败: ${error instanceof Error ? error.message : String(error)}`);
    }
    return [];
  }

  /**
   * 恢复所有 active && enabled 的 Loop 的定时器。
   */
  restoreActiveLoops(config?: AppConfigSchema): void {
    const resolved = config ?? this._config;
    if (!resolved) {
      log.warn("restoreActiveLoops: 缺少 config，跳过恢复");
      return;
    }
    for (const loop of this.loops.values()) {
      if (loop.active && loop.enabled) {
        this.startLoop(loop.id, resolved);
      }
    }
  }
}

/** 全局 Loop 管理器实例 */
export const loopManager = new LoopManager();
