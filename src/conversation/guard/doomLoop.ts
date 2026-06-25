/**
 * 死循环检测 — 多维度检测策略。
 *
 * 策略一:连续相同工具+参数重复(原有逻辑)
 * 策略二:基于窗口的序列重复检测(捕获交替循环、参数微变)
 * 策略三:总轮次兜底(防止任何形式的长时间死循环)
 *
 * 从 conversationHandler.ts 提取的独立逻辑，无外部依赖。
 */

const DEFAULT_DOOM_LOOP_THRESHOLD = 5;
const DEFAULT_SEQUENCE_WINDOW_SIZE = 8;
const DEFAULT_MAX_TOTAL_ROUNDS = 50;

export interface DoomLoopState {
  recentToolCalls: { toolName: string; args: string }[];
  /** 总工具调用轮次计数器(跨所有工具) */
  totalToolRounds: number;
}

/**
 * 创建新的 DoomLoopState
 */
export function createDoomLoopState(): DoomLoopState {
  return { recentToolCalls: [], totalToolRounds: 0 };
}

/**
 * 策略一:连续相同工具+参数重复检测(原有逻辑)。
 * 当连续 threshold 次调用完全相同的工具和参数时触发。
 */
export function detectExactRepeat(state: DoomLoopState, toolName: string, args: string, threshold: number): boolean {
  if (state.recentToolCalls.length < threshold) {
    return false;
  }

  // 检查最近 threshold 次是否全部与当前调用相同
  const recentWindow = state.recentToolCalls.slice(-threshold);
  return recentWindow.every((tc) => tc.toolName === toolName && tc.args === args);
}

/**
 * 策略二:基于窗口的序列重复检测。
 * 检查最近的工具调用序列是否出现过相同的模式(允许捕获交替循环)。
 * 例如:A→B→A→B→A→B 在序列中重复。
 */
export function detectSequenceRepeat(state: DoomLoopState, windowSize: number): boolean {
  const recent = state.recentToolCalls;
  if (recent.length < windowSize * 2) {
    return false;
  }

  // 提取工具名序列(忽略参数差异，专注于交替模式)
  const lastChunk = recent.slice(-windowSize).map((tc) => tc.toolName);
  const prevChunk = recent.slice(-windowSize * 2, -windowSize).map((tc) => tc.toolName);

  // 单一工具名的长序列不视为“交替/序列重复”，交给其它策略处理。
  if (new Set(lastChunk).size < 2) {
    return false;
  }

  // 检查两个窗口的工具名序列是否相同
  if (lastChunk.length !== prevChunk.length) {
    return false;
  }
  return lastChunk.every((name, idx) => name === prevChunk[idx]);
}

/**
 * 策略三:总轮次兜底。
 * 任何形式的长对话都有安全上限。
 */
export function detectMaxRoundsExceeded(totalRounds: number, maxRounds: number): boolean {
  return totalRounds >= maxRounds;
}

/**
 * 综合死循环检测:记录调用并执行多维度检测。
 *
 * @returns 检测结果描述，undefined 表示未检测到死循环
 */
export function detectDoomLoop(
  state: DoomLoopState,
  toolName: string,
  args: unknown,
  options?: {
    exactThreshold?: number;
    sequenceWindowSize?: number;
    maxTotalRounds?: number;
  },
): { doomed: boolean; reason?: string } {
  const argsStr = JSON.stringify(args);
  const exactThreshold = options?.exactThreshold ?? DEFAULT_DOOM_LOOP_THRESHOLD;
  const sequenceWindowSize = options?.sequenceWindowSize ?? DEFAULT_SEQUENCE_WINDOW_SIZE;
  const maxTotalRounds = options?.maxTotalRounds ?? DEFAULT_MAX_TOTAL_ROUNDS;

  // 记录本次调用
  state.recentToolCalls.push({ args: argsStr, toolName });
  state.totalToolRounds++;

  // 维护滑动窗口
  const maxWindow = Math.max(exactThreshold * 2, sequenceWindowSize * 2);
  if (state.recentToolCalls.length > maxWindow) {
    state.recentToolCalls = state.recentToolCalls.slice(-maxWindow);
  }

  // 策略三:总轮次兜底(最高优先级)
  if (detectMaxRoundsExceeded(state.totalToolRounds, maxTotalRounds)) {
    return {
      doomed: true,
      reason: `工具调用总轮次已达上限 (${maxTotalRounds})，疑似死循环`,
    };
  }

  // 策略一:连续相同调用检测
  if (detectExactRepeat(state, toolName, argsStr, exactThreshold)) {
    return {
      doomed: true,
      reason: `检测到死循环: ${toolName} 已连续调用 ${exactThreshold} 次且参数相同`,
    };
  }

  // 策略二:序列重复检测
  if (detectSequenceRepeat(state, sequenceWindowSize)) {
    return {
      doomed: true,
      reason: `检测到交替循环模式: 最近 ${sequenceWindowSize} 次工具调用序列出现重复`,
    };
  }

  return { doomed: false };
}

export { DEFAULT_DOOM_LOOP_THRESHOLD, DEFAULT_SEQUENCE_WINDOW_SIZE, DEFAULT_MAX_TOTAL_ROUNDS };
