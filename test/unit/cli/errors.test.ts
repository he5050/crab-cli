/**
 * CLI 错误处理模块单元测试
 *
 * 测试重点:
 *   - createCliError 的各种 kind 映射到正确的 AppError domain/code
 *   - formatCliError 的输出格式
 *   - writeCliError 的错误输出行为
 *   - exitWithError 的统一退出流程
 */
import { describe, expect, test } from "bun:test";
import { createCliError, formatCliError, writeCliError, exitWithError, getCliErrorMessage } from "@/cli/errors";

describe("createCliError", () => {
  test("invalid-parameter creates USER error", () => {
    const error = createCliError({
      kind: "invalid-parameter",
      message: "测试参数错误",
    });
    expect(error.code).toMatch(/^USER-\d+$/); // USER-xxx 格式
    expect(error.domain).toBe("USER");
    expect(error.message).toBe("测试参数错误");
  });

  test("invalid-path creates SYSTEM error", () => {
    const error = createCliError({
      kind: "invalid-path",
      message: "路径不存在",
    });
    expect(error.code).toMatch(/^SYSTEM-\d+$/);
    expect(error.domain).toBe("SYSTEM");
  });

  test("resource-conflict creates USER error", () => {
    const error = createCliError({
      kind: "resource-conflict",
      message: "资源已存在",
    });
    expect(error.code).toMatch(/^USER-\d+$/);
    expect(error.domain).toBe("USER");
  });

  test("resource-not-found creates USER error", () => {
    const error = createCliError({
      kind: "resource-not-found",
      message: "资源未找到",
    });
    expect(error.code).toMatch(/^USER-\d+$/);
    expect(error.domain).toBe("USER");
  });

  test("unavailable creates TOOL error", () => {
    const error = createCliError({
      kind: "unavailable",
      message: "服务不可用",
    });
    expect(error.code).toMatch(/^TOOL-\d+$/);
    expect(error.domain).toBe("TOOL");
  });

  test("write-failed creates SYSTEM error", () => {
    const error = createCliError({
      kind: "write-failed",
      message: "写入失败",
    });
    expect(error.code).toMatch(/^SYSTEM-\d+$/);
    expect(error.domain).toBe("SYSTEM");
  });

  test("internal creates INTERNAL error", () => {
    const error = createCliError({
      kind: "internal",
      message: "内部错误",
    });
    expect(error.code).toMatch(/^INTERNAL-\d+$/);
    expect(error.domain).toBe("INTERNAL");
  });

  test("preserves cause and context", () => {
    const cause = new Error("root cause");
    const context = { key: "value" };
    const error = createCliError({
      kind: "internal",
      message: "wrapper",
      cause,
      context,
    });
    expect(error.cause).toBe(cause);
    expect(error.context).toEqual(context);
  });
});

describe("formatCliError", () => {
  test("formats error with code and message", () => {
    const error = createCliError({
      kind: "invalid-parameter",
      message: "测试错误",
    });
    const formatted = formatCliError(error);
    expect(formatted).toContain("测试错误");
    expect(formatted).toMatch(/USER-\d+/);
  });

  test("includes cause when requested", () => {
    const cause = new Error("root cause");
    const error = createCliError({
      kind: "internal",
      message: "wrapper",
      cause,
    });
    const formatted = formatCliError(error, { includeCause: true });
    expect(formatted).toContain("wrapper");
    expect(formatted).toContain("root cause");
  });

  test("excludes cause by default", () => {
    const cause = new Error("root cause");
    const error = createCliError({
      kind: "internal",
      message: "wrapper",
      cause,
    });
    const formatted = formatCliError(error);
    expect(formatted).toContain("wrapper");
    expect(formatted).not.toContain("root cause");
  });

  test("handles plain Error (non-AppError) via toAppError fallback", () => {
    const formatted = formatCliError(new Error("普通错误"));
    expect(formatted).toContain("普通错误");
  });

  test("handles string input via toAppError fallback", () => {
    const formatted = formatCliError("字符串错误");
    expect(typeof formatted).toBe("string");
    expect(formatted.length).toBeGreaterThan(0);
  });
});

describe("writeCliError", () => {
  test("writes to stderr by default", () => {
    const originalStderrWrite = process.stderr.write;
    let captured = "";
    process.stderr.write = ((chunk: any) => {
      captured += chunk.toString();
      return true;
    }) as typeof process.stderr.write;

    try {
      const error = createCliError({
        kind: "invalid-parameter",
        message: "test error",
      });
      writeCliError(error);
      expect(captured).toContain("test error");
      expect(captured).toMatch(/\n$/); // ends with newline
    } finally {
      process.stderr.write = originalStderrWrite;
    }
  });

  test("uses custom write function when provided", () => {
    let captured = "";
    const customWrite = (message: string) => {
      captured = message;
    };

    const error = createCliError({
      kind: "internal",
      message: "custom output",
    });
    writeCliError(error, { write: customWrite });
    expect(captured).toContain("custom output");
  });
});

describe("getCliErrorMessage", () => {
  test("returns message from AppError", () => {
    const error = createCliError({
      kind: "invalid-parameter",
      message: "参数错误消息",
    });
    expect(getCliErrorMessage(error)).toBe("参数错误消息");
  });

  test("returns message from plain Error", () => {
    expect(getCliErrorMessage(new Error("普通错误"))).toBe("普通错误");
  });

  test("returns stringified message for non-Error input", () => {
    expect(getCliErrorMessage("字符串错误")).toBe("字符串错误");
  });

  test("handles null/undefined input", () => {
    const msgNull = getCliErrorMessage(null);
    const msgUndef = getCliErrorMessage(undefined);
    expect(typeof msgNull).toBe("string");
    expect(typeof msgUndef).toBe("string");
  });
});

describe("exitWithError", () => {
  test("calls process.exit after writing error", () => {
    const originalExit = process.exit;
    let exitCalled = false;
    let exitCode: number | undefined;

    process.exit = ((code?: number) => {
      exitCalled = true;
      exitCode = code;
      throw new Error(`process.exit(${code}) called`); // prevent actual exit
    }) as typeof process.exit;

    try {
      expect(() => {
        exitWithError("invalid-parameter", "test error", { test: true }, 2);
      }).toThrow("process.exit(2) called");

      expect(exitCalled).toBe(true);
      expect(exitCode).toBe(2);
    } finally {
      process.exit = originalExit;
    }
  });

  test("uses default exit code 1", () => {
    const originalExit = process.exit;
    let exitCode: number | undefined;

    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error(`process.exit(${code}) called`);
    }) as typeof process.exit;

    try {
      expect(() => {
        exitWithError("internal", "test error");
      }).toThrow();

      expect(exitCode).toBe(1);
    } finally {
      process.exit = originalExit;
    }
  });
});
