/**
 * 流保护测试。
 *
 * 测试用例:
 *   - 流超时保护
 *   - 流错误处理
 *   - 流资源释放
 */
import { describe, expect, test } from "bun:test";
import { consumeStream, isStreamLocked, isStreamUsable } from "@/core/streams";

describe("Stream Guards — 流类型守卫", () => {
  test("isStreamUsable 返回 false 当 stream 为 null", () => {
    expect(isStreamUsable(null)).toBe(false);
  });

  test("isStreamUsable 返回 false 当 stream 为 undefined", () => {
    expect(isStreamUsable(undefined)).toBe(false);
  });

  test("isStreamUsable 返回 true 对于未锁定的 ReadableStream", () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue("test");
        controller.close();
      },
    });
    expect(isStreamUsable(stream)).toBe(true);
  });

  test("isStreamLocked 返回 true 当流被读取后", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue("test");
        controller.close();
      },
    });

    // 获取 reader 后流被锁定
    const reader = stream.getReader();
    expect(isStreamLocked(stream)).toBe(true);

    await reader.cancel();
  });

  test("consumeStream 成功消费流", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("Hello "));
        controller.enqueue(new TextEncoder().encode("World"));
        controller.close();
      },
    });

    const chunks: string[] = [];
    const success = await consumeStream(stream, (chunk) => {
      chunks.push(chunk);
    });

    expect(success).toBe(true);
    expect(chunks.join("")).toBe("Hello World");
  });

  test("consumeStream 返回 false 当 stream 为 null", async () => {
    const chunks: string[] = [];
    const success = await consumeStream(null, (chunk) => {
      chunks.push(chunk);
    });

    expect(success).toBe(false);
    expect(chunks.length).toBe(0);
  });
});
