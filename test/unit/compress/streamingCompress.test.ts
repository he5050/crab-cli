/**
 * StreamingCompressor 测试。
 *
 * 测试用例:
 *   - 基本执行流程
 *   - 进度追踪
 *   - 取消操作
 *   - 暂停/恢复
 *   - 错误处理
 *   - chunkIterator
 */
import { describe, expect, test } from "bun:test";
import { createStreamingCompress, chunkIterator } from "@/compress/protection/streamingCompress";

describe("StreamingCompressor", () => {
  test("基本执行成功", async () => {
    const compressor = createStreamingCompress<string, string>({
      items: ["a", "b", "c"],
      baseChunkSize: 10,
      maxConcurrency: 1,
      processChunk: async (chunk) => chunk.join(","),
    });

    const result = await compressor.execute();
    expect(result.success).toBe(true);
    // 自适应分块可能将 3 个元素分成 1 或多块，但拼接结果应包含所有元素
    const joined = result.results.join(",");
    expect(joined).toBe("a,b,c");
    expect(result.error).toBeUndefined();
  });

  test("进度回调正确触发", async () => {
    const progressUpdates: number[] = [];

    const compressor = createStreamingCompress<string, void>({
      items: Array.from({ length: 10 }, (_, i) => `item-${i}`),
      baseChunkSize: 3,
      maxConcurrency: 1,
      onProgress: (p) => progressUpdates.push(p.percentage),
      processChunk: async () => {},
    });

    await compressor.execute();
    // 应该有多次进度更新，最后一次应该接近 100%
    expect(progressUpdates.length).toBeGreaterThan(0);
    expect(progressUpdates[progressUpdates.length - 1]).toBe(100);
  });

  test("cancel 取消执行", async () => {
    let processedCount = 0;

    const compressor = createStreamingCompress<string, void>({
      items: Array.from({ length: 100 }, (_, i) => `item-${i}`),
      baseChunkSize: 1,
      maxConcurrency: 1,
      processChunk: async () => {
        processedCount++;
        // 模拟处理耗时
        await new Promise((resolve) => setTimeout(resolve, 1));
      },
    });

    // 立即取消
    setTimeout(() => compressor.cancel(), 5);

    const result = await compressor.execute();
    expect(result.success).toBe(false);
    expect(result.error).toBe("已取消");
    // 不应处理全部 100 个
    expect(processedCount).toBeLessThan(100);
  });

  test("空数组直接完成", async () => {
    const compressor = createStreamingCompress<string, string>({
      items: [],
      baseChunkSize: 10,
      processChunk: async () => "result",
    });

    const result = await compressor.execute();
    expect(result.success).toBe(true);
    expect(result.results).toEqual([]);
  });

  test("processChunk 返回 undefined 时不收集", async () => {
    const compressor = createStreamingCompress<number, string>({
      items: [1, 2, 3],
      baseChunkSize: 10,
      processChunk: async () => undefined,
    });

    const result = await compressor.execute();
    expect(result.success).toBe(true);
    expect(result.results).toEqual([]);
  });

  test("processChunk 返回数组时展平收集", async () => {
    const compressor = createStreamingCompress<number, number>({
      items: [1, 2, 3],
      baseChunkSize: 10,
      processChunk: async (chunk) => chunk.map((n) => n * 2),
    });

    const result = await compressor.execute();
    expect(result.success).toBe(true);
    expect(result.results).toEqual([2, 4, 6]);
  });

  test("processChunk 抛出错误时执行失败", async () => {
    const compressor = createStreamingCompress<string, void>({
      items: ["a", "b"],
      baseChunkSize: 1,
      processChunk: async () => {
        throw new Error("处理失败");
      },
    });

    const result = await compressor.execute();
    expect(result.success).toBe(false);
    expect(result.error).toBe("处理失败");
  });

  test("finalProgress 包含完整信息", async () => {
    const compressor = createStreamingCompress<string, void>({
      items: ["a", "b"],
      baseChunkSize: 1,
      processChunk: async () => {},
    });

    const result = await compressor.execute();
    expect(result.finalProgress.total).toBe(2);
    expect(result.finalProgress.processed).toBe(2);
    expect(result.finalProgress.done).toBe(true);
  });
});

describe("chunkIterator", () => {
  test("基本分块迭代", () => {
    const items = [1, 2, 3, 4, 5];
    const chunks = [...chunkIterator(items, 2, false)];

    expect(chunks).toEqual([[1, 2], [3, 4], [5]]);
  });

  test("单个元素分块", () => {
    const items = [1];
    const chunks = [...chunkIterator(items, 2, false)];
    expect(chunks).toEqual([[1]]);
  });

  test("空数组返回空", () => {
    const chunks = [...chunkIterator([], 2, false)];
    expect(chunks).toEqual([]);
  });

  test("chunkSize 大于数组长度", () => {
    const items = [1, 2];
    const chunks = [...chunkIterator(items, 10, false)];
    expect(chunks).toEqual([[1, 2]]);
  });

  test("chunkSize 为 1", () => {
    const items = [1, 2, 3];
    const chunks = [...chunkIterator(items, 1, false)];
    expect(chunks).toEqual([[1], [2], [3]]);
  });

  test("adaptive=true 返回结果长度与原始一致", () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const allItems: number[] = [];
    for (const chunk of chunkIterator(items, 10, true)) {
      allItems.push(...chunk);
    }
    expect(allItems).toEqual(items);
  });
});
