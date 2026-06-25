/**
 * 压缩配置类型定义
 *
 * 定义压缩模块的配置接口和默认值。
 * CompressConfig 和 conversation/compaction.ts 中的 CompactionConfig
 * 共享相同的基础字段（tokenThreshold / keepRecentTurns / toolOutputTruncateLength），
 * 但分属不同层级（执行层 vs 触发层），详见 README。
 */

/** 压缩配置公共基础字段（CompressConfig 和 CompactionConfig 共享） */
export interface BaseCompressionConfig {
  /** Token 阈值，超过此值触发压缩。默认 80_000 */
  tokenThreshold: number;
  /** 压缩后保留的近期消息轮次。默认 4 */
  keepRecentTurns: number;
  /** 工具输出截断长度(字符)。默认 2000 */
  toolOutputTruncateLength: number;
}

/** 压缩模块配置（执行层） */
export interface CompressConfig extends BaseCompressionConfig {
  /** 自动压缩百分比阈值。默认 80 */
  autoCompressThreshold: number;
  /** 最大重试次数。默认 3 */
  maxRetries: number;
  /** 重试基础延迟(毫秒)。默认 1000 */
  retryBaseDelay: number;
}

/** 默认压缩配置 */
export const DEFAULT_COMPRESS_CONFIG: CompressConfig = {
  autoCompressThreshold: 80,
  keepRecentTurns: 4,
  maxRetries: 3,
  retryBaseDelay: 1000,
  tokenThreshold: 80_000,
  toolOutputTruncateLength: 2000,
};
