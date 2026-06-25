/**
 * 业务遥测类型模块 — 定义面向业务分析的指标结构。
 *
 * 职责:
 *   - 描述聊天/工具/搜索/压缩等核心场景的遥测负载形状
 *   - 提供跨模块一致的指标契约，便于 BI/上报
 *
 * 模块功能:
 *   - ChatBusinessTelemetry: 单轮聊天的执行结果与用量
 *   - ToolBusinessTelemetry: 工具调用的执行结果
 *   - SearchBusinessTelemetry: 搜索流程的执行结果
 *   - CompressionBusinessTelemetry: 上下文压缩流程的执行结果
 *
 * 使用场景:
 *   - Telemetry 上报前的结构化打点
 *   - 业务指标聚合(成功率、用量、退出原因分布)
 *
 * 边界:
 *   1. 仅定义类型，不含运行时逻辑
 *   2. status / mode 等枚举使用字符串字面量(与 telemetry.ts 对齐)
 *   3. 退出原因 exitReason 由调用方传入，含义不强制
 *
 * 流程:
 *   1. 业务模块按本文件类型构造对象
 *   2. 交给 telemetry 层统一上报
 *   3. 下游消费方按类型反序列化聚合
 */
export interface ChatBusinessTelemetry {
  provider?: string;
  model?: string;
  status: "success" | "error" | "aborted";
  exitReason: string;
  round?: number;
  durationMs?: number;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
    cachedTokens?: number;
  };
}

export interface ToolBusinessTelemetry {
  toolName: string;
  success: boolean;
  exitReason: string;
  durationMs?: number;
  sensitive?: boolean;
  error?: string;
}

export interface SearchBusinessTelemetry {
  mode: string;
  status: "success" | "error";
  exitReason: string;
  durationMs?: number;
  total?: number;
  cached?: boolean;
  agentReviewEnabled?: boolean;
  error?: string;
}

export interface CompressionBusinessTelemetry {
  mode: "compact" | "hybrid" | "incremental";
  status: "success" | "error";
  exitReason: string;
  durationMs?: number;
  messageCount?: number;
  tokensBefore?: number;
  tokensAfter?: number;
  error?: string;
}
