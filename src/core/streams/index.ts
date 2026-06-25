/**
 * 流类型守卫 — 安全判断 ReadableStream 状态。
 *
 * 职责:
 *   - 检测流是否可读
 *   - 检测流是否已关闭
 *   - 检测流是否正在读取
 *   - 安全消费流内容
 *
 * 模块功能:
 *   - isStreamUsable: 检查流是否可用
 *   - isStreamLocked: 检查流是否被锁定
 *   - consumeStream: 安全消费流
 *   - ReadableStreamLike: 可读流类型
 *
 * 使用场景:
 *   - 流状态检测
 *   - 安全消费流数据
 *   - 防止流泄漏
 *
 * 边界:
 *   1. 仅提供状态检测，不操作流本身
 *   2. 消费流时会锁定流
 *   3. 不支持取消消费
 *
 * 流程:
 *   1. 检查流是否可用
 *   2. 获取流的 Reader
 *   3. 循环读取 chunks
 *   4. 处理每个 chunk
 *   5. 完成或出错时释放资源
 */
import { createLogger } from "@/core/logging/logger";

const log = createLogger("stream");

/** 表示一个可读流的类型守卫类型 */
export type ReadableStreamLike = ReadableStream<Uint8Array> | ReadableStream<string>;

/**
 * 检查流是否可以被安全消费。
 * 一个流是"可用"的当且仅当它不为 null/undefined 且未锁定(locked 为 false)。
 *
 * @param stream - 待检查的流
 * @returns 是否可用
 */
export function isStreamUsable(stream: ReadableStreamLike | null | undefined): stream is ReadableStreamLike {
  return stream !== null && stream !== undefined && !stream.locked;
}

/**
 * 检查流是否已关闭(locked 为 true 表示有读取者在消费)。
 *
 * @param stream - 待检查的流
 * @returns 是否正在被消费
 */
export function isStreamLocked(stream: ReadableStreamLike): boolean {
  return stream.locked;
}

/**
 * 安全地消费一个流，确保不会泄漏未锁定的流。
 *
 * @param stream - 待消费的流
 * @param processor - 处理每一 chunk 的函数
 * @returns 是否成功消费
 */
export async function consumeStream(
  stream: ReadableStreamLike | null | undefined,
  processor: (chunk: string) => void,
): Promise<boolean> {
  if (!isStreamUsable(stream)) {
    log.debug(`流不可用: ${stream === null ? "null" : stream === undefined ? "undefined" : "locked"}`);
    return false;
  }

  log.debug(`开始消费流`);
  let chunkCount = 0;

  try {
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const text = typeof value === "string" ? value : new TextDecoder().decode(value);
      processor(text);
      chunkCount++;
    }
    log.debug(`流消费完成: ${chunkCount} chunks`);
    return true;
  } catch (error) {
    log.error(`流消费失败: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
