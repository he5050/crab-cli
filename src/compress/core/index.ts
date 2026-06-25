/**
 * Core — 核心压缩器和服务入口
 */
export {
  Compressor,
  defaultCompressor,
  cleanOrphanedToolCalls,
  findPreserveStartIndex,
  findRecentRoundsStartIndex,
  truncateOversizedToolResults,
  callLlmForSummary,
  compressWithCustomPrompt,
} from "./compressor";

export {
  compactSession,
  hybridCompactSession,
  type CompactResult,
  type CompactSessionOptions,
} from "./compressService";

export { compressionCoordinator, CompressionCoordinator } from "./compressionCoordinator";

export {
  createCompressionError,
  toCompressionFailure,
  type CompressionErrorReason,
  type CompressionErrorContext,
  type CompressionFailure,
} from "./errors";
