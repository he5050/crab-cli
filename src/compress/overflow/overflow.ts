/**
 * Overflow
 *
 * 职责:
 *   - 判断 token 使用量是否超过模型限制
 *   - 提供模型上下文窗口大小查询
 *   - 计算 token 使用百分比
 *   - 提供压缩建议
 *
 * 模块功能:
 *   - getContextWindowSize: 获取模型的上下文窗口大小
 *   - isOverflow: 检查 token 使用量是否溢出
 *   - getTokenPercentage: 计算 token 使用百分比
 *   - getCompressionAdvice: 获取压缩建议
 *   - MODEL_CONTEXT_WINDOWS: 常见模型上下文窗口映射
 *
 * 使用场景:
 *   - 检测上下文是否溢出
 *   - 计算当前 token 使用率
 *   - 决定是否需要压缩
 *   - 获取压缩紧急程度建议
 *
 * 边界:
 *   1. 未知模型使用默认上下文窗口(128k)
 *   2. 默认溢出阈值为 90%
 *   3. 支持前缀匹配模型 ID
 *
 * 流程:
 *   1. 获取模型上下文窗口大小
 *   2. 计算当前 token 使用率
 *   3. 判断是否超过阈值
 *   4. 返回压缩建议
 */
// ─── 常见模型的上下文窗口大小 ─────────────────────────────────

/** 模型上下文窗口映射 */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // Claude
  "claude-3-5-sonnet": 200_000,
  "claude-3-5-haiku": 200_000,
  "claude-3-opus": 200_000,
  "claude-sonnet-4-6": 200_000,
  "claude-opus-4-8": 200_000,
  "claude-haiku-4-5": 200_000,
  // GPT
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
  "gpt-4-turbo": 128_000,
  o1: 200_000,
  o3: 200_000,
  // Gemini
  "gemini-2.5-pro": 1_000_000,
  "gemini-2.5-flash": 1_000_000,
  "gemini-2.0-flash": 1_000_000,
};

/** 默认上下文窗口大小(未知模型时使用) */
const DEFAULT_CONTEXT_WINDOW = 128_000;

/** 默认溢出阈值(占窗口的百分比) */
const DEFAULT_OVERFLOW_PERCENTAGE = 90;

/**
 * 获取模型的上下文窗口大小。
 *
 * @param modelId - 模型 ID(如 "claude-3-5-sonnet")
 * @returns 上下文窗口 token 数
 */
export function getContextWindowSize(modelId: string): number {
  const lower = modelId.toLowerCase();

  // 精确匹配
  if (MODEL_CONTEXT_WINDOWS[lower]) {
    return MODEL_CONTEXT_WINDOWS[lower]!;
  }

  // 前缀匹配
  for (const [prefix, size] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (lower.startsWith(prefix)) {
      return size;
    }
  }

  return DEFAULT_CONTEXT_WINDOW;
}

/**
 * 检查 token 使用量是否溢出。
 *
 * @param tokens - 当前 token 使用量
 * @param modelId - 模型 ID
 * @param thresholdPercent - 溢出阈值百分比(默认 90%)
 * @returns true 表示已溢出
 */
export function isOverflow(
  tokens: number,
  modelId: string,
  thresholdPercent: number = DEFAULT_OVERFLOW_PERCENTAGE,
): boolean {
  const windowSize = getContextWindowSize(modelId);
  const threshold = Math.floor((windowSize * thresholdPercent) / 100);
  return tokens >= threshold;
}

/**
 * 计算当前 token 使用量占模型窗口的百分比。
 *
 * @returns 百分比值(0-100)
 */
export function getTokenPercentage(tokens: number, modelId: string): number {
  const windowSize = getContextWindowSize(modelId);
  return Math.min(100, Math.round((tokens / windowSize) * 100));
}

/**
 * 根据上下文使用率自适应调整保留轮数。
 *
 * 使用率越高，保留的轮数越少(更激进的压缩)。
 * 共享给主会话 compaction 和子代理 compressor。
 *
 * @param percentage - 当前 token 使用百分比 (0-100)
 * @param defaultKeepRounds - 默认保留轮数
 * @returns 调整后的保留轮数
 */
export function getAdaptiveKeepRounds(percentage: number, defaultKeepRounds: number): number {
  if (percentage >= 95) {
    return 1;
  }
  if (percentage >= 85) {
    return 2;
  }
  if (percentage >= 80) {
    return 3;
  }
  return defaultKeepRounds;
}

/**
 * 根据当前使用百分比返回压缩建议。
 *
 * @param percentage - 当前 token 使用百分比 (0-100)
 * @returns 压缩建议（是否需要压缩及紧急程度）
 */
export function getCompressionAdvice(percentage: number): {
  shouldCompress: boolean;
  urgency: "low" | "medium" | "high";
} {
  if (percentage >= 90) {
    return { shouldCompress: true, urgency: "high" };
  }
  if (percentage >= 80) {
    return { shouldCompress: true, urgency: "medium" };
  }
  if (percentage >= 70) {
    return { shouldCompress: true, urgency: "low" };
  }
  return { shouldCompress: false, urgency: "low" };
}
