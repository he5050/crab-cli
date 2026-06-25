/**
 * 计划任务工具 — 委托给 LoopManager 的薄包装层。
 *
 * 职责:
 *   - 将 AI 的 scheduler 操作转换为 LoopManager 调用
 *   - 提供 cron / delay 两种调度方式的参数适配
 *
 * 边界:
 *   1. 权限:scheduler
 *   2. 所有状态管理和持久化由 LoopManager 负责
 *   3. 不维护自有 Map 或持久化文件
 */
import { z } from "zod";
import { defineTool } from "@/tool/types";
import { createLogger } from "@/core/logging/logger";
import { loopManager, loopDaemonManager, validateCron } from "@/mission";
import type { LoopRecord, LoopScheduleInput } from "@/mission/type";

const log = createLogger("tool:scheduler");

function formatLoopForResponse(loop: LoopRecord): Record<string, unknown> {
  const { _timer, ...rest } = loop;
  return {
    ...rest,
    id: toPublicTaskId(loop.id),
    loopId: loop.id,
    schedule: formatSchedule(loop),
  };
}

function toPublicTaskId(loopId: string): string {
  return loopId.startsWith("sch_") ? loopId : `sch_${loopId}`;
}

function toLoopId(taskId?: string): string | undefined {
  return taskId?.startsWith("sch_") ? taskId.slice(4) : taskId;
}

function formatSchedule(loop: LoopRecord): string {
  if (loop.cronExpr) {
    return `cron(${loop.cronExpr})`;
  }
  if (loop.delayMs !== undefined) {
    return `delay ${loop.delayMs}ms`;
  }
  if (loop.intervalLabel) {
    return loop.intervalLabel;
  }
  if (loop.intervalMs !== undefined) {
    return `interval ${loop.intervalMs}ms`;
  }
  return "unknown";
}

/** 计划任务工具：管理 cron 定时任务和一次性延迟执行 */
export const schedulerTool = defineTool({
  description:
    "管理计划任务。支持 cron 表达式的定时任务和一次性延迟执行。" +
    "任务到时间后会自动执行指定的 prompt。" +
    "支持创建、查看、暂停、恢复、删除任务。" +
    "history 查看执行历史，stats 查看统计信息(成功/跳过/失败次数、平均间隔)。" +
    "daemon_status/daemon_start/daemon_stop/daemon_resume/daemon_logs 管理后台 loop daemon 状态。",
  execute: async ({ action, taskId, prompt, cron, delay, description, limit }) => {
    try {
      switch (action) {
        case "create": {
          return handleCreate(prompt, cron, delay, description);
        }
        case "list": {
          return handleList();
        }
        case "status": {
          return handleStatus(taskId);
        }
        case "pause": {
          return handlePause(taskId);
        }
        case "resume": {
          return handleResume(taskId);
        }
        case "delete": {
          return handleDelete(taskId);
        }
        case "history": {
          return handleHistory(taskId, limit);
        }
        case "stats": {
          return handleStats(taskId);
        }
        case "daemon_status": {
          return handleDaemonStatus();
        }
        case "daemon_start": {
          return handleDaemonStart();
        }
        case "daemon_stop": {
          return handleDaemonStop();
        }
        case "daemon_resume": {
          return handleDaemonResume();
        }
        case "daemon_logs": {
          return handleDaemonLogs(limit);
        }
        default: {
          return { error: `未知操作: ${action}`, success: false };
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error(`Scheduler 操作失败: ${action}`, { error: msg });
      return { error: msg, success: false };
    }
  },
  name: "scheduler",
  parameters: z.object({
    action: z
      .enum([
        "create",
        "list",
        "status",
        "pause",
        "resume",
        "delete",
        "history",
        "stats",
        "daemon_status",
        "daemon_start",
        "daemon_stop",
        "daemon_resume",
        "daemon_logs",
      ])
      .describe(
        "操作:create/list/status/pause/resume/delete/history/stats/daemon_status/daemon_start/daemon_stop/daemon_resume/daemon_logs",
      ),
    cron: z.string().optional().describe("Cron 表达式，如 '0 9 * * *'(每天 9 点)。create 时与 delay 二选一"),
    delay: z.number().optional().describe("延迟执行的秒数。create 时与 cron 二选一"),
    description: z.string().optional().describe("任务描述"),
    limit: z.number().optional().describe("返回的历史记录条数(默认 50)"),
    prompt: z.string().optional().describe("到时间后执行的 prompt(create 时必填)"),
    taskId: z.string().optional().describe("任务 ID(status/pause/resume/delete 时使用)"),
  }),
  permission: "scheduler",
  builtin: true,
});

function handleCreate(prompt?: string, cron?: string, delay?: number, description?: string): Record<string, unknown> {
  if (!prompt) {
    return { error: "创建任务需要提供 prompt", success: false };
  }
  if (!cron && delay === undefined) {
    return { error: "需要提供 cron 或 delay 参数", success: false };
  }

  if (cron) {
    const validation = validateCron(cron);
    if (!validation.valid) {
      return { error: `Cron 表达式无效: ${validation.error}`, success: false };
    }
  }

  let schedule: LoopScheduleInput;
  if (cron) {
    schedule = { cronExpr: cron, description, prompt };
  } else {
    const delayMs = (delay ?? 0) * 1000;
    schedule = { delayMs, description, prompt };
  }

  const loop = loopManager.createLoop(schedule);
  loopManager.startLoop(loop.id);

  log.info(`计划任务已创建: ${loop.id}`);
  return {
    action: "create",
    message: `计划任务 ${loop.id} 已创建并启动。`,
    success: true,
    task: formatLoopForResponse(loop),
  };
}

function handleList(): Record<string, unknown> {
  const loops = loopManager.listLoops();
  return {
    action: "list",
    success: true,
    tasks: loops.map(formatLoopForResponse),
    total: loops.length,
  };
}

function handleStatus(taskId?: string): Record<string, unknown> {
  if (!taskId) {
    return { error: "查询状态需要提供 taskId", success: false };
  }
  const loopId = toLoopId(taskId)!;
  const loop = loopManager.getLoop(loopId);
  if (!loop) {
    return { error: `任务不存在: ${taskId}`, success: false };
  }
  return { action: "status", success: true, task: formatLoopForResponse(loop) };
}

function handlePause(taskId?: string): Record<string, unknown> {
  if (!taskId) {
    return { error: "暂停任务需要提供 taskId", success: false };
  }
  const loopId = toLoopId(taskId)!;
  const ok = loopManager.pauseLoop(loopId);
  if (!ok) {
    return { error: `任务不存在或无法暂停: ${taskId}`, success: false };
  }
  const loop = loopManager.getLoop(loopId);
  return { action: "pause", success: true, task: loop ? formatLoopForResponse(loop) : { id: taskId } };
}

function handleResume(taskId?: string): Record<string, unknown> {
  if (!taskId) {
    return { error: "恢复任务需要提供 taskId", success: false };
  }
  const loopId = toLoopId(taskId)!;
  const ok = loopManager.resumeLoop(loopId);
  if (!ok) {
    return { error: `任务不存在或无法恢复: ${taskId}`, success: false };
  }
  const loop = loopManager.getLoop(loopId);
  return { action: "resume", success: true, task: loop ? formatLoopForResponse(loop) : { id: taskId } };
}

function handleDelete(taskId?: string): Record<string, unknown> {
  if (!taskId) {
    return { error: "删除任务需要提供 taskId", success: false };
  }
  const loop = loopManager.cancelLoop(toLoopId(taskId)!);
  if (!loop) {
    return { error: `任务不存在: ${taskId}`, success: false };
  }
  return { action: "delete", success: true, task: formatLoopForResponse(loop) };
}

function handleHistory(taskId?: string, limit?: number): Record<string, unknown> {
  if (!taskId) {
    return { error: "查询历史需要提供 taskId", success: false };
  }
  const loopId = toLoopId(taskId)!;
  const loop = loopManager.getLoop(loopId);
  if (!loop) {
    return { error: `任务不存在: ${taskId}`, success: false };
  }
  const records = loopManager.getHistory(loopId, limit);
  return { action: "history", loopId, records, success: true, taskId: toPublicTaskId(loopId), total: records.length };
}

function handleStats(taskId?: string): Record<string, unknown> {
  if (!taskId) {
    return { error: "查询统计需要提供 taskId", success: false };
  }
  const stats = loopManager.getStats(toLoopId(taskId)!);
  if (!stats) {
    return { error: `任务不存在: ${taskId}`, success: false };
  }
  return { action: "stats", stats, success: true };
}

function handleDaemonStatus(): Record<string, unknown> {
  return { action: "daemon_status", daemon: loopDaemonManager.status(), success: true };
}

function handleDaemonStart(): Record<string, unknown> {
  const daemon = loopDaemonManager.markRunning();
  loopManager.restoreActiveLoops();
  return {
    action: "daemon_start",
    daemon,
    message: "Loop daemon 状态已标记为运行，并已尝试恢复 active loop。",
    success: true,
  };
}

function handleDaemonStop(): Record<string, unknown> {
  loopManager.suspendTimers();
  const daemon = loopDaemonManager.stop();
  return {
    action: "daemon_stop",
    daemon,
    message: "Loop daemon 已停止，active loop 状态已保留，可 resume 恢复。",
    success: true,
  };
}

function handleDaemonResume(): Record<string, unknown> {
  const daemon = loopDaemonManager.resume();
  loopManager.restoreActiveLoops();
  return {
    action: "daemon_resume",
    daemon,
    message: "Loop daemon 已恢复，并已尝试恢复 active loop。",
    success: true,
  };
}

function handleDaemonLogs(limit?: number): Record<string, unknown> {
  const logs = loopDaemonManager.readLogs(limit);
  return {
    action: "daemon_logs",
    logs,
    success: true,
    total: logs.length,
  };
}
