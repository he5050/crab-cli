/**
 * 定时任务倒计时 — 纯字符串渲染（headless）
 *
 * 用法: renderSchedulerCountdown(props) → 多行字符串
 */

// ─── 类型 ──────────────────────────────────────────────────

export interface SchedulerCountdownProps {
  description: string;
  totalDuration: number;
  remainingSeconds: number;
  terminalWidth?: number;
}

// ─── 工具函数 ──────────────────────────────────────────────

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function getProgressBar(progress: number, width: number): string {
  const filled = Math.round((progress / 100) * width);
  const empty = width - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

// ─── 公开 API ──────────────────────────────────────────────

/** 渲染倒计时为 ANSI 字符串（用于终端输出） */
export function renderSchedulerCountdown(props: SchedulerCountdownProps): string {
  const { description, totalDuration, remainingSeconds } = props;
  const terminalWidth = props.terminalWidth ?? 60;

  const barWidth = Math.max(20, terminalWidth - 30);
  const elapsedSeconds = totalDuration - remainingSeconds;
  const progress = Math.min(100, (elapsedSeconds / totalDuration) * 100);

  const maxDescWidth = Math.max(40, terminalWidth - 20);
  const displayDesc = description.length > maxDescWidth ? `${description.slice(0, maxDescWidth - 3)}...` : description;

  const lines: string[] = [];
  lines.push(`⏰ 预约任务`);
  lines.push(`  任务: ${displayDesc}`);
  lines.push(`  进度: ${getProgressBar(progress, barWidth)}`);
  lines.push(`  ${formatDuration(remainingSeconds)} / ${formatDuration(totalDuration)} (${Math.round(progress)}%)`);
  lines.push(`  AI 流程已暂停，等待倒计时结束...`);

  return lines.join("\n");
}
