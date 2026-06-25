// ─── 上下文压缩 ──────────────────────────────────────────────────
export { findSplitIndex, maybeCompact, truncateToolOutputs, DEFAULT_COMPACTION_CONFIG } from "./compaction";
export type { CompactionConfig, CompactionResult } from "./compaction";

// ─── Token 估算（由 @core/tokenCounter 统一提供）────────────────────
export { estimateMessagesTokens, estimateTokens } from "@/session/token/tokenCounterRef";

// ─── 压缩计数（测试/监控用）──────────────────────────────────────
export {
  clearAllCompactionCounts,
  clearCompactionCount,
  getCompactionCount,
  getTrackedCompactionSessionCount,
} from "./compaction";
