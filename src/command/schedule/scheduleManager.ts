/**
 * 定时任务管理器 — 管理基于 cron 表达式的定时任务。
 *
 * 职责:
 *   - 创建/删除/列出定时任务
 *   - 使用 cron 表达式调度
 *   - 持久化到 ~/.crab/schedules.json
 *   - 后台定时触发，通过通知提醒
 *
 * 模块功能:
 *   - createSchedule: 创建定时任务
 *   - deleteSchedule: 删除定时任务
 *   - listSchedules: 列出所有定时任务
 *   - getSchedule: 获取单个定时任务
 *   - startScheduler: 启动后台调度器
 *   - stopScheduler: 停止后台调度器
 *
 * 使用场景:
 *   - crab --schedule "0 9 * * *" "检查 PR 状态"
 *   - 定时执行 AI 任务
 *
 * 边界:
 *   1. 仅管理调度配置，实际执行委托给 mission/loop 模块
 *   2. 持久化文件: ~/.crab/schedules.json
 *   3. 最大活跃调度数: 20
 */
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@/core/logging/logger";
import { getDataDir } from "@/config";
import { calculateNextCronRun, validateCron } from "@/mission";
import { shortUuid } from "@/core/id";
import { globalBus } from "@/bus";
import { AppEvent } from "@/bus";

const log = createLogger("schedule");

// ─── 类型定义 ─────────────────────────────────────────────────

export interface ScheduleRecord {
  /** 唯一 ID */
  id: string;
  /** Cron 表达式 */
  cronExpr: string;
  /** 任务提示词 */
  prompt: string;
  /** 是否启用 */
  enabled: boolean;
  /** 创建时间 */
  createdAt: number;
  /** 下次执行时间 */
  nextRunAt: number;
  /** 上次执行时间 */
  lastRunAt?: number;
  /** 累计执行次数 */
  runCount: number;
  /** 可选描述 */
  description?: string;
}

// ─── 持久化 ──────────────────────────────────────────────────

const SCHEDULES_FILE = "schedules.json";
const MAX_SCHEDULES = 20;

function getSchedulesFilePath(): string {
  return path.join(getDataDir(), SCHEDULES_FILE);
}

function loadSchedules(): ScheduleRecord[] {
  const filePath = getSchedulesFilePath();
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as ScheduleRecord[];
  } catch (error) {
    log.error(`加载定时任务失败: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

function saveSchedules(schedules: ScheduleRecord[]): void {
  const filePath = getSchedulesFilePath();
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(schedules, null, 2), "utf8");
  } catch (error) {
    log.error(`保存定时任务失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ─── CRUD 操作 ───────────────────────────────────────────────

/**
 * 创建定时任务。
 */
export function createSchedule(cronExpr: string, prompt: string, description?: string): ScheduleRecord {
  const validation = validateCron(cronExpr);
  if (!validation.valid) {
    throw new Error(`Cron 表达式无效: ${validation.error}`);
  }

  const schedules = loadSchedules();
  if (schedules.length >= MAX_SCHEDULES) {
    throw new Error(`最多支持 ${MAX_SCHEDULES} 个定时任务，请先删除一些。`);
  }

  const id = shortUuid().slice(0, 8);
  const now = Date.now();
  const nextRunAt = calculateNextCronRun(cronExpr);

  const record: ScheduleRecord = {
    createdAt: now,
    cronExpr,
    description,
    enabled: true,
    id,
    nextRunAt,
    prompt,
    runCount: 0,
  };

  schedules.push(record);
  saveSchedules(schedules);

  log.info(`定时任务已创建: ${id}, cron=${cronExpr}, prompt=${prompt.slice(0, 40)}`);
  return record;
}

/**
 * 删除定时任务。
 */
export function deleteSchedule(id: string): boolean {
  const schedules = loadSchedules();
  const index = schedules.findIndex((s) => s.id === id);
  if (index === -1) {
    return false;
  }
  schedules.splice(index, 1);
  saveSchedules(schedules);
  log.info(`定时任务已删除: ${id}`);
  return true;
}

/**
 * 列出所有定时任务。
 */
export function listSchedules(): ScheduleRecord[] {
  return loadSchedules().sort((a, b) => a.nextRunAt - b.nextRunAt);
}

/**
 * 获取单个定时任务。
 */
export function getSchedule(id: string): ScheduleRecord | null {
  const schedules = loadSchedules();
  return schedules.find((s) => s.id === id) ?? null;
}

/**
 * 启用/禁用定时任务。
 */
export function toggleSchedule(id: string, enabled: boolean): ScheduleRecord | null {
  const schedules = loadSchedules();
  const schedule = schedules.find((s) => s.id === id);
  if (!schedule) {
    return null;
  }
  schedule.enabled = enabled;
  if (enabled) {
    schedule.nextRunAt = calculateNextCronRun(schedule.cronExpr);
  }
  saveSchedules(schedules);
  log.info(`定时任务 ${id} 已${enabled ? "启用" : "禁用"}`);
  return schedule;
}

// ─── 后台调度器 ──────────────────────────────────────────────

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
const CHECK_INTERVAL_MS = 60_000; // 每分钟检查一次

/**
 * 启动后台调度器。
 * 每分钟检查一次是否有到期的定时任务，到期时通过通知提醒。
 */
export function startScheduler(): void {
  if (schedulerTimer) {
    return;
  }

  log.info("定时任务调度器已启动");

  schedulerTimer = setInterval(async () => {
    try {
      await checkAndTriggerSchedules();
    } catch (error) {
      log.error(`调度器检查异常: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, CHECK_INTERVAL_MS);

  // 不阻止进程退出
  schedulerTimer.unref();
}

/**
 * 停止后台调度器。
 */
export function stopScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    log.info("定时任务调度器已停止");
  }
}

/**
 * 检查并触发到期的定时任务。
 */
async function checkAndTriggerSchedules(): Promise<void> {
  const schedules = loadSchedules();
  const now = Date.now();

  for (const schedule of schedules) {
    if (!schedule.enabled) {
      continue;
    }

    if (schedule.nextRunAt <= now) {
      log.info(`定时任务 ${schedule.id} 已到期，触发执行`);

      // 通过事件总线通知
      globalBus.publish(AppEvent.Toast, {
        message: `定时任务触发: ${schedule.prompt.slice(0, 60)}`,
        variant: "info",
      });

      // 尝试通过 mission/loop 创建任务执行
      try {
        const { loopManager } = await import("@/mission");
        const config = (await import("@/config")).DEFAULT_CONFIG;
        loopManager.setConfig(config);

        // 创建一次性 loop 来执行任务
        const loop = loopManager.createLoop({
          delayMs: 0,
          prompt: schedule.prompt,
        });
        loopManager.startLoop(loop.id, config);
      } catch (error) {
        log.warn(`定时任务 ${schedule.id} 执行失败: ${error instanceof Error ? error.message : String(error)}`);
      }

      // 更新执行记录
      schedule.lastRunAt = now;
      schedule.runCount += 1;
      schedule.nextRunAt = calculateNextCronRun(schedule.cronExpr);
    }
  }

  saveSchedules(schedules);
}
