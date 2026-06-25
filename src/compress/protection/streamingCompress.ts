/**
 * 流式压缩 — 支持大型数据集的流式压缩处理。
 *
 * 职责:
 *   - 将大型数据集分块处理
 *   - 流式输出中间结果
 *   - 支持进度回调
 *   - 支持取消操作
 *
 * 使用场景:
 *   - 超长会话的压缩
 *   - 避免一次性加载所有数据到内存
 *   - 需要边处理边输出的场景
 *
 * 边界:
 *   1. 分块处理，每个块独立压缩
 *   2. 结果可以流式返回或最后一起返回
 *   3. 支持进度跟踪
 */

import { createLogger } from "@/core/logging/logger";
import { type AdaptiveChunker, createAdaptiveChunker, createMemoryMonitor, memoryMonitor } from "./memoryProtection";

const log = createLogger("compress:streaming");

// ─── 类型定义 ─────────────────────────────────────────────────────

/** 流式压缩配置 */
export interface StreamingCompressConfig<T, R = void> {
  /** 数据源 */
  items: T[];
  /** 分块大小(基准值，实际会动态调整) */
  baseChunkSize?: number;
  /** 分块处理函数。返回 R 或 R[] 时将收集到 results 数组 */
  processChunk: (chunk: T[], chunkIndex: number) => Promise<R | R[] | void>;
  /** 进度回调 */
  onProgress?: (progress: StreamingProgress) => void;
  /** 是否启用自适应分块 */
  adaptiveChunking?: boolean;
  /** 最大并发块数 */
  maxConcurrency?: number;
}

/** 流式压缩进度 */
export interface StreamingProgress {
  /** 已处理项数 */
  processed: number;
  /** 总项数 */
  total: number;
  /** 当前块索引 */
  currentChunk: number;
  /** 总块数 */
  totalChunks: number;
  /** 完成百分比 */
  percentage: number;
  /** 是否完成 */
  done: boolean;
  /** 错误信息(如果有) */
  error?: string;
}

/** 流式压缩结果 */
export interface StreamingCompressResult<T> {
  /** 是否成功 */
  success: boolean;
  /** 处理后的数据 */
  results: T[];
  /** 最终进度 */
  finalProgress: StreamingProgress;
  /** 错误信息 */
  error?: string;
}

// ─── 流式压缩器 ──────────────────────────────────────────────────

/**
 * 流式压缩处理器
 */
export class StreamingCompressor<T, R = void> {
  private config: StreamingCompressConfig<T, R>;
  private cancelled: boolean = false;
  private paused: boolean = false;
  private chunker: AdaptiveChunker<T>;

  constructor(config: StreamingCompressConfig<T, R>) {
    this.config = {
      adaptiveChunking: true,
      baseChunkSize: 100,
      maxConcurrency: 2,
      ...config,
    };
    // adaptiveChunking=false 时使用固定分块器，避免 MemoryMonitor 影响 chunkSize
    this.chunker = this.config.adaptiveChunking
      ? createAdaptiveChunker(memoryMonitor, this.config.baseChunkSize!)
      : createAdaptiveChunker(createMemoryMonitor({ autoGC: false }), this.config.baseChunkSize!);
    this.chunker.setItems(config.items);
  }

  /**
   * 执行流式压缩
   */
  async execute(): Promise<StreamingCompressResult<R>> {
    const { items } = this.config;
    const results: R[] = [];
    this.cancelled = false;

    const totalChunks = this.chunker.getChunkCount();
    let processed = 0;
    let currentChunk = 0;

    log.debug(`流式压缩开始: ${items.length} 项, ${totalChunks} 块`);

    try {
      for (const chunk of this.chunker.iterateChunks()) {
        // 检查是否取消
        if (this.cancelled) {
          log.info("流式压缩已取消");
          return this.createResult(results, false, "已取消", processed, currentChunk, totalChunks);
        }

        // 检查是否暂停
        while (this.paused) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          if (this.cancelled) {
            log.info("流式压缩已取消");
            return this.createResult(results, false, "已取消", processed, currentChunk, totalChunks);
          }
        }

        // 处理当前块并收集结果
        const chunkResult = await this.config.processChunk(chunk, currentChunk);
        if (chunkResult !== undefined && chunkResult !== null) {
          if (Array.isArray(chunkResult)) {
            results.push(...chunkResult);
          } else {
            results.push(chunkResult as R);
          }
        }
        processed += chunk.length;

        // 进度回调
        const progress = this.createProgress(processed, currentChunk, totalChunks);
        this.config.onProgress?.(progress);

        currentChunk++;
      }

      log.debug(`流式压缩完成: ${processed} 项`);
      return this.createResult(results, true, undefined, processed, currentChunk, totalChunks);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.error(`流式压缩失败: ${error}`);
      return this.createResult(results, false, error, processed, currentChunk, totalChunks);
    }
  }

  /**
   * 取消压缩
   */
  cancel(): void {
    this.cancelled = true;
    log.debug("流式压缩取消请求");
  }

  /**
   * 暂停压缩
   */
  pause(): void {
    this.paused = true;
    log.debug("流式压缩已暂停");
  }

  /**
   * 恢复压缩
   */
  resume(): void {
    this.paused = false;
    log.debug("流式压缩已恢复");
  }

  /**
   * 创建进度对象
   */
  private createProgress(processed: number, currentChunk: number, totalChunks: number): StreamingProgress {
    return {
      currentChunk,
      done: processed >= this.config.items.length,
      percentage: this.config.items.length > 0 ? Math.round((processed / this.config.items.length) * 100) : 0,
      processed,
      total: this.config.items.length,
      totalChunks,
    };
  }

  /**
   * 创建结果对象
   */
  private createResult(
    results: R[],
    success: boolean,
    error: string | undefined,
    processed: number,
    currentChunk: number,
    totalChunks: number,
  ): StreamingCompressResult<R> {
    return {
      error,
      finalProgress: this.createProgress(processed, currentChunk, totalChunks),
      results,
      success,
    };
  }
}

// ─── 工厂函数 ────────────────────────────────────────────────────

/**
 * 创建流式压缩任务
 */
export function createStreamingCompress<T, R = void>(config: StreamingCompressConfig<T, R>): StreamingCompressor<T, R> {
  return new StreamingCompressor(config);
}

/**
 * 简单的分块迭代器
 *
 * @param items 要分块的数据
 * @param chunkSize 每块大小
 * @param adaptive 是否启用自适应(基于内存)
 */
export function* chunkIterator<T>(
  items: T[],
  chunkSize: number,
  adaptive: boolean = true,
): Generator<T[], void, unknown> {
  const monitor = memoryMonitor;
  let size = chunkSize;

  for (let i = 0; i < items.length; i += size) {
    // 自适应调整
    if (adaptive) {
      size = monitor.getRecommendedChunkSize(chunkSize);
    }
    yield items.slice(i, i + size);
  }
}
