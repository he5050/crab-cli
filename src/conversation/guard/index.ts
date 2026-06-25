// ─── 死循环检测 ──────────────────────────────────────────────────
export {
  createDoomLoopState,
  DEFAULT_DOOM_LOOP_THRESHOLD,
  DEFAULT_SEQUENCE_WINDOW_SIZE,
  DEFAULT_MAX_TOTAL_ROUNDS,
  detectDoomLoop,
} from "./doomLoop";
export type { DoomLoopState } from "./doomLoop";

// ─── 死循环策略 ──────────────────────────────────────────────────
export { resolveDoomLoopThreshold, checkDoomLoop } from "./doomLoopPolicy";
export type { DoomLoopConfig, DoomLoopCheckResult } from "./doomLoopPolicy";

// ─── 处理锁与超时 ─────────────────────────────────────────────────
export { ProcessingGuard } from "./processingGuard";
export type { ProcessingGuardOptions } from "./processingGuard";
