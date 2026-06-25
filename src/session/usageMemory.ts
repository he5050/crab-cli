/**
 * @deprecated 此模块已迁移至 @/tool/usageMemory。
 * 此文件保留为 re-export 以兼容旧 import 路径，将在下一大版本移除。
 */
export {
  type UsageMemoryKind,
  type UsageMemorySource,
  type UsageMemoryRecord,
  type UsageMemoryStore,
  type RecordUsageInput,
  type UsageBoost,
  type UsageMemoryCandidate,
  extractIntentKeywords,
  recordUsageMemory,
  readUsageMemory,
  getUsageBoost,
  getUsageCandidates,
  clearUsageMemoryForTest,
  __usageMemoryPathsForTest,
} from "@/tool/usageMemory";
