/**
 * Protection — 内存保护和流式压缩
 */
export {
  memoryMonitor,
  MemoryMonitor,
  AdaptiveChunker,
  createMemoryMonitor,
  createAdaptiveChunker,
  type MemoryStatus,
  type MemoryLevel,
  type MemoryMonitorConfig,
} from "./memoryProtection";

export {
  StreamingCompressor,
  createStreamingCompress,
  chunkIterator,
  type StreamingCompressConfig,
  type StreamingProgress,
  type StreamingCompressResult,
} from "./streamingCompress";
