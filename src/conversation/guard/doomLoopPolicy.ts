/**
 * 死循环策略 — 基于 doomLoop 检测结果生成后续循环控制策略。
 *
 * 职责:
 *   - 复用 doomLoop 检测能力，转换为对话循环可消费的策略判定
 *
 * 模块功能:
 *   - evaluateDoomLoopPolicy: 评估是否触发死循环策略
 */
import { DEFAULT_DOOM_LOOP_THRESHOLD, type DoomLoopState, detectDoomLoop } from "./doomLoop";

export interface DoomLoopConfig {
  doomLoopThreshold?: number;
}

export interface DoomLoopCheckResult {
  doomed: boolean;
  threshold: number;
  message?: string;
}

export function resolveDoomLoopThreshold(config?: DoomLoopConfig): number {
  const threshold = config?.doomLoopThreshold;
  if (typeof threshold !== "number" || !Number.isInteger(threshold) || threshold <= 0) {
    return DEFAULT_DOOM_LOOP_THRESHOLD;
  }
  return threshold;
}

export function checkDoomLoop(
  state: DoomLoopState,
  toolName: string,
  args: unknown,
  config?: DoomLoopConfig,
): DoomLoopCheckResult {
  const threshold = resolveDoomLoopThreshold(config);
  const result = detectDoomLoop(state, toolName, args, { exactThreshold: threshold });
  return {
    doomed: result.doomed,
    message: result.reason,
    threshold,
  };
}
