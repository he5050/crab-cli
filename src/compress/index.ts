/**
 * Compress Module — 上下文压缩引擎
 *
 * 职责:
 *   - 整合所有压缩策略:AI 摘要、工具结果截断、混合压缩、子代理压缩
 *   - 提供统一的压缩接口和类型定义
 *   - 管理压缩配置和状态
 *   - 协调各种压缩策略的执行
 *
 * 目录结构:
 *   - types/       — 类型定义(压缩结果、策略、配置、状态)
 *   - core/        — 核心压缩器和服务入口
 *   - strategies/  — 压缩策略实现(标准/混合/增量)
 *   - runtime/     — 运行时调度(自动压缩、任务队列、子代理)
 *   - overflow/    — Token 溢出检测和提示词
 *   - protection/  — 内存保护和流式压缩
 *   - utils/       — 辅助工具(轻量 Agent)
 *
 * 使用场景:
 *   - 会话上下文超过 Token 限制时进行压缩
 *   - 需要保留关键信息同时减少 Token 使用量
 *   - 多轮对话后的上下文管理
 *   - 长工具执行结果的截断处理
 *
 * 边界:
 *   1. 仅对消息历史进行压缩，不修改原始消息
 *   2. 压缩策略可配置，支持多种算法
 *   3. 自动压缩有触发阈值，避免频繁压缩
 *   4. 子代理压缩需要额外的 Agent 资源
 *
 * 流程:
 *   1. 检测上下文是否溢出(overflow)
 *   2. 根据配置选择合适的压缩策略
 *   3. 执行压缩(AI 摘要/截断/混合)
 *   4. 更新会话消息历史
 *   5. 发布压缩完成事件
 */

// ─── 类型 ───────────────────────────────────────────────────
export type {
  CompressionResult,
  SubAgentCompressionResult,
  CompressionStatus,
  CompressConfig,
  CompactStrategyKind,
  CompactStrategySelectionInput,
  CompactStrategyInput,
  CompactStrategyResult,
  CompactStrategy,
  CompressionEntry,
  IncrementalCompressionState,
  StrategySelectionConfig,
} from "./types/index";

export { DEFAULT_COMPRESS_CONFIG, DEFAULT_STRATEGY_SELECTION_CONFIG } from "./types/index";

// ─── 错误处理 ──────────────────────────────────────────────
export {
  createCompressionError,
  toCompressionFailure,
  type CompressionErrorReason,
  type CompressionErrorContext,
  type CompressionFailure,
} from "./core/errors";

// ─── 主压缩器 ──────────────────────────────────────────────
export { Compressor, defaultCompressor, callLlmForSummary, compressWithCustomPrompt } from "./core/compressor";
export {
  cleanOrphanedToolCalls,
  findPreserveStartIndex,
  findRecentRoundsStartIndex,
  truncateOversizedToolResults,
} from "./core/compressor";

// ─── 压缩服务 ──────────────────────────────────────────────
export {
  compactSession,
  hybridCompactSession,
  type CompactResult,
  type CompactSessionOptions,
} from "./core/compressService";

// ─── 协调器 ────────────────────────────────────────────────
export { compressionCoordinator } from "./core/compressionCoordinator";

// ─── 策略压缩 ──────────────────────────────────────────────
export { createCompactStrategy, selectCompactStrategyKind } from "./strategies/compactStrategy";

// ─── 混合压缩 ──────────────────────────────────────────────
export { performHybridCompression } from "./strategies/hybridCompress";

// ─── 自动压缩（@internal: 当前无外部消费者，仅供运行时内部使用）───────────
/** @internal 自动压缩触发检测 */
export { shouldAutoCompress } from "./runtime/autoCompress";
/** @internal 自动压缩执行（含重试） */
export { performAutoCompression } from "./runtime/autoCompress";

// ─── 子代理压缩 ────────────────────────────────────────────
export { SubAgentCompressor, subAgentCompressor } from "./runtime/subAgentCompressor";

// ─── 压缩队列（@internal: 当前无外部消费者，规划中功能）────────────
/** @internal 压缩任务优先级队列 */
export { compressionQueue } from "./runtime/compressionQueue";

// ─── 运行时 ────────────────────────────────────────────────
export { createConversationCompressor, autoCompactMessages } from "./runtime/compressionRuntime";
export type { MessageCompressor } from "@/conversation/core/llmLoop";

// ─── 溢出检测 ──────────────────────────────────────────────
export {
  getContextWindowSize,
  isOverflow,
  getTokenPercentage,
  getCompressionAdvice,
  getAdaptiveKeepRounds,
} from "./overflow/overflow";

// ─── 提示词 ────────────────────────────────────────────────
export { COMPRESSION_PROMPT, SUB_AGENT_COMPRESSION_PROMPT, serializeMessagesForCompression } from "./overflow/prompt";

// ─── 内存保护（@internal: 当前无外部消费者，通用基础设施预留）────────
/** @internal 内存监控器实例 */
export { memoryMonitor } from "./protection/memoryProtection";
/** @internal 内存监控器类 */
export { MemoryMonitor } from "./protection/memoryProtection";
/** @internal 自适应分块器类 */
export { AdaptiveChunker, createAdaptiveChunker, createMemoryMonitor } from "./protection/memoryProtection";
export type { MemoryStatus, MemoryLevel, MemoryMonitorConfig } from "./protection/memoryProtection";

// ─── 流式压缩（@internal: 当前无外部消费者，通用基础设施预留）──────────
/** @internal 流式压缩器 */
export { StreamingCompressor, createStreamingCompress, chunkIterator } from "./protection/streamingCompress";
export type {
  StreamingCompressConfig,
  StreamingProgress,
  StreamingCompressResult,
} from "./protection/streamingCompress";

// ─── Compact Agent（@internal: 当前无外部消费者，轻量 AI 调用封装）──────────
/** @internal 轻量压缩 Agent */
export { CompactAgent, compactAgent } from "./utils";

// ─── 会话触发层（由 conversation 子模块提供，re-export 供外部统一引用）──
export { maybeCompact, truncateToolOutputs, DEFAULT_COMPACTION_CONFIG } from "./conversation";
export type { CompactionConfig, CompactionResult } from "./conversation";
