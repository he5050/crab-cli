/**
 * 压缩错误处理测试。
 *
 * 测试用例:
 *   - createCompressionError 创建正确错误类型
 *   - toCompressionFailure 转换错误载荷
 */
import { describe, expect, test } from "bun:test";
import { createCompressionError, toCompressionFailure } from "@/compress/core/errors";

describe("createCompressionError", () => {
  test("too_few_messages 创建用户错误", () => {
    const error = createCompressionError("too_few_messages", "消息太少", {
      sessionId: "s1",
      messageCount: 2,
    });

    expect(error.message).toBe("消息太少");
    expect(error.code).toMatch(/^USER-/);
    expect(error.context).toBeDefined();
    expect(error.context.compressionReason).toBe("too_few_messages");
    expect(error.context.sessionId).toBe("s1");
  });

  test("empty_result 创建内部错误", () => {
    const error = createCompressionError("empty_result", "空结果", {
      sessionId: "s1",
      strategy: "standard",
    });

    expect(error.message).toBe("空结果");
    expect(error.code).toMatch(/^INTERNAL-/);
    expect(error.context.compressionReason).toBe("empty_result");
  });

  test("exception 创建内部错误", () => {
    const error = createCompressionError("exception", "出错了", {
      sessionId: "s1",
    });

    expect(error.message).toBe("出错了");
    expect(error.code).toMatch(/^INTERNAL-/);
    expect(error.context.compressionReason).toBe("exception");
  });

  test("支持 cause 参数", () => {
    const cause = new Error("原始错误");
    const error = createCompressionError(
      "exception",
      "包装错误",
      {
        sessionId: "s1",
      },
      cause,
    );

    expect(error.cause).toBe(cause);
  });

  test("context 支持额外字段", () => {
    const error = createCompressionError("too_few_messages", "消息太少", {
      sessionId: "s1",
      messageCount: 2,
      extraField: "extra",
    });

    expect(error.context.extraField).toBe("extra");
  });
});

describe("toCompressionFailure", () => {
  test("转换为 CompressionFailure 载荷", () => {
    const error = createCompressionError("too_few_messages", "消息太少", {
      sessionId: "s1",
    });

    const failure = toCompressionFailure(error);
    expect(failure).toEqual({
      error: "消息太少",
      errorCode: error.code,
    });
  });

  test("empty_result 转换", () => {
    const error = createCompressionError("empty_result", "空结果", {
      sessionId: "s1",
    });

    const failure = toCompressionFailure(error);
    expect(failure.errorCode).toMatch(/^INTERNAL-/);
  });

  test("exception 转换", () => {
    const error = createCompressionError("exception", "出错了", {
      sessionId: "s1",
    });

    const failure = toCompressionFailure(error);
    expect(failure.errorCode).toMatch(/^INTERNAL-/);
  });
});
