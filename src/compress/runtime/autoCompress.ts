/**
 * AutoCompress
 *
 * 职责:
 *   - 监控 Token 使用率
 *   - 达到阈值时自动触发压缩
 *   - 支持失败重试(指数退避)
 *   - 提供压缩状态回调
 *
 * 模块功能:
 *   - shouldAutoCompress: 检查是否应该自动压缩
 *   - performAutoCompression: 执行自动压缩(含重试)
 *   - CompressionStatus: 压缩状态类型
 *   - CompressionResult: 压缩结果类型
 *   - MAX_RETRIES: 最大重试次数
 *   - RETRY_BASE_DELAY: 重试基础延迟
 *
 * 使用场景:
 *   - 对话过程中 Token 使用率监控
 *   - 自动触发上下文压缩
 *   - 压缩失败后的自动重试
 *   - UI 显示压缩进度
 *
 * 边界:
 *   1. 需要配置 autoCompressThreshold 阈值
 *   2. 最大重试次数为 3 次
 *   3. 重试延迟指数退避
 *   4. 压缩状态通过回调通知
 *
 * 流程:
 *   1. 计算当前 Token 使用率
 *   2. 检查是否达到阈值
 *   3. 触发压缩并更新状态
 *   4. 失败时等待后重试
 *   5. 达到最大重试次数后放弃
 */
import type { AppConfigSchema } from "@/schema/config";
import type { ModelMessage } from "ai";
import { createLogger } from "@/core/logging/logger";
import { globalBus } from "@/bus";
import { CompressEvents } from "@/bus/events/compressEvents";
import { estimateMessagesTokens } from "../conversation";
import { compressionCoordinator } from "../core/compressionCoordinator";

/**
 * 延迟加载 compressor 模块 — 打破 autoCompress ↔ compressor 循环依赖。
 * 当 compressor.ts 被加载时，其传递依赖链会触发 autoCompress.ts 加载，
 * 此时 compressor 的导出尚未就绪。通过 getter 延迟到首次实际使用时加载。
 */
let _lazyCompressor: typeof import("../core/compressor") | null = null;
function getCompressorDeps() {
  if (!_lazyCompressor) {
    _lazyCompressor = require("../core/compressor") as typeof import("../core/compressor");
  }
  return _lazyCompressor;
}
import { getTokenPercentage } from "../overflow/overflow";
import type { CompressionResult, CompressionStatus } from "../types";
import { DEFAULT_COMPRESS_CONFIG } from "../types";
import { createStandardCompactStrategy } from "../strategies/compactStrategy";
import { performHybridCompression } from "../strategies/hybridCompress";
import { createIncrementalCompressor } from "../strategies/incrementalCompressor";

const log = createLogger("compress:auto");

/** 错误提示自动消失时间 */
const ERROR_DISMISS_MS = 5000;

const autoCompressDeps: Record<string, unknown> = {
  compressionCoordinator,
  createIncrementalCompressor,
  /** 延迟加载 defaultCompressor — 避免循环依赖 */
  get defaultCompressor() {
    return getCompressorDeps().defaultCompressor;
  },
  defaultConfig: DEFAULT_COMPRESS_CONFIG,
  estimateMessagesTokens,
  getTokenPercentage,
  performHybridCompression,
  setTimeout: globalThis.setTimeout.bind(globalThis),
  /** 延迟加载 truncateOversizedToolResults — 避免循环依赖 */
  get truncateOversizedToolResults() {
    return getCompressorDeps().truncateOversizedToolResults;
  },
};

export function __setAutoCompressDepsForTesting(overrides: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(overrides)) {
    Object.defineProperty(autoCompressDeps, key, {
      value,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }
}

export function __resetAutoCompressDepsForTesting(): void {
  autoCompressDeps.estimateMessagesTokens = estimateMessagesTokens;
  autoCompressDeps.compressionCoordinator = compressionCoordinator;
  autoCompressDeps.getTokenPercentage = getTokenPercentage;
  autoCompressDeps.defaultConfig = DEFAULT_COMPRESS_CONFIG;
  autoCompressDeps.setTimeout = globalThis.setTimeout.bind(globalThis);
  // Reset lazy cache so next access re-loads the real module
  _lazyCompressor = null;
  autoCompressDeps.performHybridCompression = performHybridCompression;
  autoCompressDeps.createIncrementalCompressor = createIncrementalCompressor;
  // Restore lazy getters (delete override value, re-define getter)
  delete autoCompressDeps.defaultCompressor;
  delete autoCompressDeps.truncateOversizedToolResults;
  Object.defineProperty(autoCompressDeps, "defaultCompressor", {
    get() {
      return getCompressorDeps().defaultCompressor;
    },
    configurable: true,
    enumerable: true,
  });
  Object.defineProperty(autoCompressDeps, "truncateOversizedToolResults", {
    get() {
      return getCompressorDeps().truncateOversizedToolResults;
    },
    configurable: true,
    enumerable: true,
  });
}

/**
 * 检查 token 使用率是否达到阈值。
 */
export function shouldAutoCompress(
  percentage: number,
  threshold: number = autoCompressDeps.defaultConfig.autoCompressThreshold,
): boolean {
  return percentage >= threshold;
}

/**
 * 执行自动压缩(含自动重试)。
 *
 * 当上下文使用率超过阈值时调用。失败后自动重试(指数退避)，
 * 最多重试 MAX_RETRIES 次。
 *
 * @param messages - 对话历史消息
 * @param appConfig - 应用配置
 * @param modelId - 模型 ID(用于计算百分比)
 * @param sessionId - 会话 ID
 * @param onStatusUpdate - 压缩状态回调(用于 UI 显示)
 * @returns 压缩结果
 */
export async function performAutoCompression(
  messages: ModelMessage[],
  appConfig: AppConfigSchema,
  modelId: string,
  sessionId?: string,
  onStatusUpdate?: (status: CompressionStatus | null) => void,
): Promise<CompressionResult | null> {
  const tokens = autoCompressDeps.estimateMessagesTokens(messages);
  const percentage = autoCompressDeps.getTokenPercentage(tokens, modelId);
  const { maxRetries } = autoCompressDeps.defaultConfig;
  const { retryBaseDelay } = autoCompressDeps.defaultConfig;

  if (!shouldAutoCompress(percentage)) {
    log.debug(`Token 使用率 ${percentage}% 未达阈值，跳过自动压缩`);
    return null;
  }

  log.info(`触发自动压缩: token 使用率 ${percentage}%`);

  globalBus.publish(CompressEvents.CompressStarted, {
    percentage,
    sessionId,
    tokenCount: tokens,
  });

  let lastError = "";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      onStatusUpdate?.({
        progress: attempt > 0 ? (attempt / maxRetries) * 100 : undefined,
        sessionId,
        step: "compressing",
      });

      const strategy = createStandardCompactStrategy({
        compressWithAI: (strategyMessages, strategyConfig, strategySessionId) =>
          autoCompressDeps.defaultCompressor.compressWithAI(strategyMessages, strategyConfig, strategySessionId),
        createIncrementalCompressor: autoCompressDeps.createIncrementalCompressor,
        estimateMessagesTokens: autoCompressDeps.estimateMessagesTokens,
        performHybridCompression: autoCompressDeps.performHybridCompression,
        truncateOversizedToolResults: autoCompressDeps.truncateOversizedToolResults,
      });
      const result = await strategy.compact({
        appConfig,
        messages,
        sessionId,
        tokensBefore: tokens,
      });

      if (result.compressed && result.rawResult && "summary" in result.rawResult) {
        globalBus.publish(CompressEvents.CompressCompleted, {
          compressionRatio: `${Math.round(((tokens - autoCompressDeps.estimateMessagesTokens(messages)) / tokens) * 100)}%`,
          method: "ai-summary",
          sessionId,
          tokensAfter: autoCompressDeps.estimateMessagesTokens(messages),
          tokensBefore: tokens,
        });
        onStatusUpdate?.({
          sessionId,
          step: "completed",
          tokensSaved: tokens - autoCompressDeps.estimateMessagesTokens(messages),
        });
        return result.rawResult;
      }

      // Null 且非失败 → 跳过(如消息太少)
      onStatusUpdate?.(null);
      return null;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Unknown error";

      if (attempt < maxRetries) {
        const retryDelay = retryBaseDelay * 2 ** attempt;
        globalBus.publish(CompressEvents.CompressRetrying, {
          attempt: attempt + 1,
          error: lastError,
          maxRetries,
          sessionId,
        });
        log.warn(`自动压缩失败 (attempt ${attempt + 1}/${maxRetries}): ${lastError}，${retryDelay}ms 后重试`);

        onStatusUpdate?.({
          maxRetries,
          message: lastError,
          retryAttempt: attempt + 1,
          sessionId,
          step: "retrying",
        });

        await new Promise((resolve) => autoCompressDeps.setTimeout(resolve, retryDelay));
        continue;
      }
    }
  }

  // 所有重试耗尽
  log.error(`自动压缩失败: ${maxRetries} 次重试后仍失败: ${lastError}`);
  globalBus.publish(CompressEvents.CompressFailed, {
    error: lastError,
    method: "ai-summary",
    sessionId,
  });

  onStatusUpdate?.({
    message: `压缩失败 (${maxRetries} 次重试): ${lastError}`,
    sessionId,
    step: "failed",
  });

  // 错误提示自动消失
  if (onStatusUpdate) {
    autoCompressDeps.setTimeout(() => onStatusUpdate(null), ERROR_DISMISS_MS);
  }

  return null;
}
