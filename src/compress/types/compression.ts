/**
 * 压缩结果类型定义
 *
 * 定义 AI 摘要压缩和子代理压缩的返回结果结构。
 */
import type { ModelMessage } from "ai";

/** AI 摘要压缩结果 */
export interface CompressionResult {
  /** 压缩后的摘要文本 */
  summary: string;
  /** Token 使用量 */
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  /** 保留的消息(未压缩的近期消息) */
  preservedMessages?: ModelMessage[];
  /** 保留消息在原始数组中的起始索引 */
  preservedMessageStartIndex?: number;
  /** Hook 是否失败 */
  hookFailed?: boolean;
  /** Hook 错误详情 */
  hookErrorDetails?: {
    type: "warning" | "error";
    exitCode: number;
    command: string;
    output?: string;
    error?: string;
  };
}

/** 子代理压缩结果 */
export interface SubAgentCompressionResult {
  /** 是否执行了压缩 */
  compressed: boolean;
  /** 压缩后的消息数组 */
  messages: ModelMessage[];
  /** 压缩前的估算 token 数 */
  beforeTokens?: number;
  /** 压缩后的估算 token 数 */
  afterTokensEstimate?: number;
}
