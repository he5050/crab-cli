/**
 * parseCliArgs 边界值单元测试
 *
 * 测试重点:
 *   - --sse-port 各种无效输入（字符串、负数、超大值、零）
 *   - --sse-port 有效输入
 *   - 非数字 timeout/max-tool-rounds（CLI 层面的解析，不含 validateCliArgs）
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { parseCliArgs } from "@/cli/core/orchestrator";

describe("parseCliArgs boundary values", () => {
  let exitCode: number | undefined;
  let restoreExit: (() => void) | undefined;

  beforeEach(() => {
    exitCode = undefined;
    const originalExit = process.exit;
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error(`EXIT_${code}`);
    }) as typeof process.exit;
    restoreExit = () => {
      process.exit = originalExit;
    };
  });

  afterEach(() => {
    restoreExit?.();
  });

  describe("--sse-port", () => {
    test("有效端口号 3000 正常解析", () => {
      const result = parseCliArgs(["--sse", "--sse-port", "3000"]);
      expect(result.ssePort).toBe(3000);
    });

    test("有效端口号 1 正常解析", () => {
      const result = parseCliArgs(["--sse", "--sse-port", "1"]);
      expect(result.ssePort).toBe(1);
    });

    test("有效端口号 65535 正常解析", () => {
      const result = parseCliArgs(["--sse", "--sse-port", "65535"]);
      expect(result.ssePort).toBe(65535);
    });

    test("无效端口 -1 报错退出（使用 = 语法传参）", () => {
      try {
        parseCliArgs(["--sse", "--sse-port=-1"]);
      } catch {
        /* exit */
      }
      expect(exitCode).toBe(1);
    });

    test("无效端口 0 报错退出", () => {
      try {
        parseCliArgs(["--sse", "--sse-port", "0"]);
      } catch {
        /* exit */
      }
      expect(exitCode).toBe(1);
    });

    test("无效端口 65536 报错退出", () => {
      try {
        parseCliArgs(["--sse", "--sse-port", "65536"]);
      } catch {
        /* exit */
      }
      expect(exitCode).toBe(1);
    });

    test("无效端口 abc 报错退出", () => {
      try {
        parseCliArgs(["--sse", "--sse-port", "abc"]);
      } catch {
        /* exit */
      }
      expect(exitCode).toBe(1);
    });

    test("无效端口 3.14 报错退出", () => {
      try {
        parseCliArgs(["--sse", "--sse-port", "3.14"]);
      } catch {
        /* exit */
      }
      expect(exitCode).toBe(1);
    });

    test("无 --sse-port 时 ssePort 为 undefined", () => {
      const result = parseCliArgs(["--sse"]);
      expect(result.ssePort).toBeUndefined();
    });
  });
});
