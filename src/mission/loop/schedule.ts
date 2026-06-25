export interface LoopRecord {
  /** Loop ID */
  id: string;
  /** 执行提示词 */
  prompt: string;
  /** 人类可读描述 */
  description?: string;

  // ── 调度方式(三选一)──
  /** 固定间隔(毫秒) */
  intervalMs?: number;
  /** 可读间隔标签，如 "5m" */
  intervalLabel?: string;
  /** Cron 表达式(5 字段:分 时 日 月 星期) */
  cronExpr?: string;
  /** 一次性延迟(毫秒) */
  delayMs?: number;

  // ── 状态 ──
  /** 是否活跃(运行中) */
  active: boolean;
  /** 是否启用(暂停/恢复控制) */
  enabled: boolean;
  /** 创建时间 */
  createdAt: number;
  /** 下次执行时间 */
  nextRunAt: number;
  /** 上次执行时间 */
  lastRunAt?: number;
  /** 上次执行的 Task ID */
  lastTaskId?: string;
  /** 关联会话 */
  sessionId?: string;
  /** 累计执行次数 */
  runCount: number;

  // ── 运行时(不持久化)──
  _timer?: ReturnType<typeof setInterval | typeof setTimeout>;
}

/** 单次执行历史记录 */
export interface LoopExecutionRecord {
  /** Loop ID */
  loopId: string;
  /** 执行时间戳 */
  executedAt: number;
  /** 创建的 Task ID */
  taskId?: string;
  /** 执行结果 */
  status: "success" | "skipped" | "error";
  /** 错误信息(status=error 时) */
  error?: string;
}

/** Loop 统计信息 */
export interface LoopStats {
  /** Loop ID */
  loopId: string;
  /** 总执行次数 */
  totalRuns: number;
  /** 成功次数 */
  successCount: number;
  /** 跳过次数(上次任务仍在运行) */
  skippedCount: number;
  /** 失败次数 */
  errorCount: number;
  /** 最近 N 次执行记录 */
  recentHistory: LoopExecutionRecord[];
  /** 平均执行间隔(毫秒，基于最近 10 次成功执行) */
  avgIntervalMs?: number;
}

export type LoopScheduleInput = {
  prompt: string;
  description?: string;
} & (
  | { intervalMs: number; intervalLabel: string; cronExpr?: undefined; delayMs?: undefined }
  | { cronExpr: string; intervalMs?: undefined; intervalLabel?: undefined; delayMs?: undefined }
  | { delayMs: number; intervalMs?: undefined; intervalLabel?: undefined; cronExpr?: undefined }
);

export function scheduleLabel(loop: LoopRecord): string {
  if (loop.intervalLabel) {
    return loop.intervalLabel;
  }
  if (loop.cronExpr) {
    return `cron(${loop.cronExpr})`;
  }
  if (loop.delayMs) {
    return `delay ${loop.delayMs}ms`;
  }
  return "unknown";
}

/** 验证 cron 表达式基本格式(5 字段:分 时 日 月 星期) */
export function validateCron(cron: string): { valid: boolean; error?: string } {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    return { error: `Cron 表达式需要 5 个字段(分 时 日 月 星期)，当前 ${parts.length} 个`, valid: false };
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  const check = (field: string, label: string, min: number, max: number): string | null => {
    if (field === "*") {
      return null;
    }
    if (field.startsWith("*/")) {
      const step = parseInt(field.slice(2), 10);
      if (isNaN(step) || step < 1 || step > max) {
        return `${label} 步进值无效: ${field}`;
      }
      return null;
    }
    if (field.includes("-")) {
      const [rawA, rawB] = field.split("-");
      const a = Number(rawA);
      const b = Number(rawB);
      if (isNaN(a) || isNaN(b) || a < min || b > max || a > b) {
        return `${label} 范围无效: ${field}`;
      }
      return null;
    }
    if (field.includes(",")) {
      for (const v of field.split(",")) {
        const n = parseInt(v, 10);
        if (isNaN(n) || n < min || n > max) {
          return `${label} 值无效: ${v}`;
        }
      }
      return null;
    }
    const n = parseInt(field, 10);
    if (isNaN(n) || n < min || n > max) {
      return `${label} 值 ${field} 超出范围 [${min}-${max}]`;
    }
    return null;
  };

  const checks = [
    check(minute!, "分钟", 0, 59),
    check(hour!, "小时", 0, 23),
    check(dayOfMonth!, "日", 1, 31),
    check(month!, "月", 1, 12),
    check(dayOfWeek!, "星期", 0, 6),
  ];

  const error = checks.find((e) => e !== null);
  return error ? { error, valid: false } : { valid: true };
}

/** 解析单个 cron 字段为匹配值集合 */
function parseCronField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>();

  if (field === "*") {
    for (let i = min; i <= max; i++) values.add(i);
    return values;
  }

  if (field.startsWith("*/")) {
    const step = parseInt(field.slice(2), 10);
    for (let i = min; i <= max; i += step) values.add(i);
    return values;
  }

  if (field.includes(",")) {
    for (const part of field.split(",")) {
      if (part.includes("-")) {
        const seg = part.split("-").map(Number);
        const a = seg[0] ?? min;
        const b = seg[1] ?? max;
        for (let i = a; i <= b; i++) values.add(i);
      } else {
        values.add(parseInt(part, 10));
      }
    }
    return values;
  }

  if (field.includes("-")) {
    const seg = field.split("-").map(Number);
    const a = seg[0] ?? min;
    const b = seg[1] ?? max;
    for (let i = a; i <= b; i++) values.add(i);
    return values;
  }

  values.add(parseInt(field, 10));
  return values;
}

/**
 * 计算 cron 表达式的下次运行时间，返回毫秒时间戳。
 *
 * 支持完整的 5 字段 cron（分 时 日 月 星期）。
 * 字段格式：星号 / 数字 / 范围 N-M / 步进 星斜杠N / 逗号列表。
 * 标准 cron 规则：若日和星期均非星号则取 OR；否则仅使用非星号字段。
 */
export function calculateNextCronRun(cron: string): number {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return Date.now() + 60_000;

  const minutes = parseCronField(parts[0]!, 0, 59);
  const hours = parseCronField(parts[1]!, 0, 23);
  const months = parseCronField(parts[3]!, 1, 12);

  // 记录原始字段是否为通配符，用于决定日/星期的匹配策略
  const domIsWildcard = parts[2] === "*";
  const dowIsWildcard = parts[4] === "*";
  const daysOfMonth = parseCronField(parts[2]!, 1, 31);
  const daysOfWeek = parseCronField(parts[4]!, 0, 6);

  // 日匹配函数：两个都非通配时取 OR，否则只看非通配的那个
  const dayMatches = (day: number, weekday: number): boolean => {
    if (!domIsWildcard && !dowIsWildcard) {
      return daysOfMonth.has(day) || daysOfWeek.has(weekday);
    }
    if (!domIsWildcard) return daysOfMonth.has(day);
    if (!dowIsWildcard) return daysOfWeek.has(weekday);
    return true;
  };

  const start = new Date();
  start.setSeconds(0, 0);

  // 排序后的分钟/小时列表，用于快速查找
  const sortedMinutes = [...minutes].sort((a, b) => a - b);
  const sortedHours = [...hours].sort((a, b) => a - b);

  for (let monthOffset = 0; monthOffset < 24; monthOffset++) {
    const m = new Date(start.getFullYear(), start.getMonth() + monthOffset, 1, 0, 0, 0, 0);
    const daysInMonth = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();

    if (!months.has(m.getMonth() + 1)) continue;

    for (let day = 1; day <= daysInMonth; day++) {
      if (!dayMatches(day, new Date(m.getFullYear(), m.getMonth(), day).getDay())) continue;

      // 当天起始（00:00）
      const dayStart = new Date(m.getFullYear(), m.getMonth(), day, 0, 0, 0, 0);

      for (const hour of sortedHours) {
        const hourStart = new Date(dayStart);
        hourStart.setHours(hour);

        if (hourStart <= start) continue;

        // 在该小时内找第一个 > start 的匹配分钟
        for (const minute of sortedMinutes) {
          const t = new Date(hourStart);
          t.setMinutes(minute);
          if (t > start) return t.getTime();
        }
      }
    }
  }

  return Date.now() + 60_000;
}

// 解析时间格式。
// 支持: "5m", "1h", "30s", "8h30m", "every 2h", "cron */5 * * * * <prompt>"
export function parseLoopSchedule(
  input: string,
): { intervalMs: number; intervalLabel: string; prompt: string } | { cronExpr: string; prompt: string } | null {
  // "cron */5 * * * * <prompt>" 格式
  const cronMatch = input.match(/^cron\s+((?:\S+\s+){4}\S+)\s+(.+)$/i);
  if (cronMatch) {
    const expr = cronMatch[1]!.trim();
    const result = validateCron(expr);
    if (result.valid) {
      return { cronExpr: expr, prompt: cronMatch[2]! };
    }
  }

  // "every 2h <prompt>" 格式
  const everyMatch = input.match(/^every\s+(\d+h(?:\d+m)?|\d+m(?:\d+s)?|\d+s)\s+(.+)$/i);
  if (everyMatch) {
    const parsed = parseTimeString(everyMatch[1]!);
    if (parsed) {
      return { intervalLabel: parsed.label, intervalMs: parsed.ms, prompt: everyMatch[2]! };
    }
  }

  // "5m <prompt>" / "1h30m <prompt>" 格式
  const simpleMatch = input.match(/^(\d+h(?:\d+m)?|\d+m(?:\d+s)?|\d+s)\s+(.+)$/i);
  if (simpleMatch) {
    const parsed = parseTimeString(simpleMatch[1]!);
    if (parsed) {
      return { intervalLabel: parsed.label, intervalMs: parsed.ms, prompt: simpleMatch[2]! };
    }
  }

  return null;
}

function parseTimeString(s: string): { ms: number; label: string } | null {
  let totalMs = 0;
  let label = "";

  const hMatch = s.match(/(\d+)h/);
  if (hMatch) {
    totalMs += parseInt(hMatch[1]!, 10) * 3_600_000;
    label += `${hMatch[1]}h`;
  }

  const mMatch = s.match(/(\d+)m/);
  if (mMatch) {
    totalMs += parseInt(mMatch[1]!, 10) * 60_000;
    label += `${mMatch[1]}m`;
  }

  const sMatch = s.match(/(\d+)s/);
  if (sMatch) {
    totalMs += parseInt(sMatch[1]!, 10) * 1000;
    label += `${sMatch[1]}s`;
  }

  if (totalMs <= 0) {
    return null;
  }
  return { label: label || s, ms: totalMs };
}
