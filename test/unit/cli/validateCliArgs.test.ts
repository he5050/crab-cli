/**
 * CLI 参数互斥约束验证单元测试
 *
 * 测试重点:
 *   - --sse 与 --acp 互斥
 *   - --task 与 --ask 互斥
 *   - --yolo 与 --c-yolo 语义重叠（仅警告）
 *   - --sse 与 --sse-daemon 互斥
 *   - --task 与 --task-execute 互斥
 *   - --ask 与 --task-execute 互斥
 *   - --timeout 必须为正整数
 *   - --max-tool-rounds 必须为正整数
 *   - 无冲突时正常通过
 */
import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { __resetLifecycleForTest } from "@/cli/core/lifecycle";

describe("validateCliArgs", () => {
  let exitCode: number | undefined;
  let restoreExit: (() => void) | undefined;

  beforeEach(() => {
    __resetLifecycleForTest();
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

  function makeParsed(overrides: Record<string, string | boolean | undefined> = {}): any {
    return {
      mode: "tui",
      positionals: [],
      values: overrides,
      ssePort: undefined,
      sseAll: false,
    };
  }

  test("无冲突时正常通过", async () => {
    const { validateCliArgs } = await import("@/cli/core/orchestrator");
    const parsed = makeParsed({});
    validateCliArgs(parsed);
    expect(exitCode).toBeUndefined();
  });

  test("--sse 和 --acp 同时使用时报错退出", async () => {
    const { validateCliArgs } = await import("@/cli/core/orchestrator");
    const parsed = makeParsed({ sse: true, acp: true });
    try {
      validateCliArgs(parsed);
    } catch {
      /* process.exit mock */
    }
    expect(exitCode).toBe(1);
  });

  test("--task 和 --ask 同时使用时报错退出", async () => {
    const { validateCliArgs } = await import("@/cli/core/orchestrator");
    const parsed = makeParsed({ task: "do something", ask: "hello" });
    try {
      validateCliArgs(parsed);
    } catch {
      /* process.exit mock */
    }
    expect(exitCode).toBe(1);
  });

  test("--yolo 和 --c-yolo 同时使用时输出警告但不退出", async () => {
    const { validateCliArgs } = await import("@/cli/core/orchestrator");
    const warnSpy = mock(() => {});
    const originalWarn = console.warn;
    console.warn = warnSpy;
    try {
      const parsed = makeParsed({ yolo: true, "c-yolo": true });
      validateCliArgs(parsed);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("--c-yolo"));
      expect(exitCode).toBeUndefined();
    } finally {
      console.warn = originalWarn;
    }
  });

  test("--sse 和 --sse-daemon 同时使用时报错退出", async () => {
    const { validateCliArgs } = await import("@/cli/core/orchestrator");
    const parsed = makeParsed({ sse: true, "sse-daemon": true });
    try {
      validateCliArgs(parsed);
    } catch {
      /* process.exit mock */
    }
    expect(exitCode).toBe(1);
  });

  test("--task 和 --task-execute 同时使用时报错退出", async () => {
    const { validateCliArgs } = await import("@/cli/core/orchestrator");
    const parsed = makeParsed({ task: "new task", "task-execute": "task-123" });
    try {
      validateCliArgs(parsed);
    } catch {
      /* process.exit mock */
    }
    expect(exitCode).toBe(1);
  });

  test("--ask 和 --task-execute 同时使用时报错退出", async () => {
    const { validateCliArgs } = await import("@/cli/core/orchestrator");
    const parsed = makeParsed({ ask: "hello", "task-execute": "task-456" });
    try {
      validateCliArgs(parsed);
    } catch {
      /* process.exit mock */
    }
    expect(exitCode).toBe(1);
  });

  test("--timeout 为非正整数时报错退出", async () => {
    const { validateCliArgs } = await import("@/cli/core/orchestrator");
    const parsed = makeParsed({ timeout: "abc" });
    try {
      validateCliArgs(parsed);
    } catch {
      /* process.exit mock */
    }
    expect(exitCode).toBe(1);
  });

  test("--max-tool-rounds 为零或负数时报错退出", async () => {
    const { validateCliArgs } = await import("@/cli/core/orchestrator");
    const parsed = makeParsed({ "max-tool-rounds": "-5" });
    try {
      validateCliArgs(parsed);
    } catch {
      /* process.exit mock */
    }
    expect(exitCode).toBe(1);
  });

  test("多个违规同时存在时一次性报告全部错误", async () => {
    const { validateCliArgs } = await import("@/cli/core/orchestrator");
    const originalStderrWrite = process.stderr.write;
    let captured = "";
    process.stderr.write = ((chunk: any) => {
      captured += chunk.toString();
      return true;
    }) as typeof process.stderr.write;

    try {
      const parsed = makeParsed({ sse: true, acp: true, timeout: "abc", "max-tool-rounds": "-1" });
      try {
        validateCliArgs(parsed);
      } catch {
        /* process.exit mock */
      }
      expect(exitCode).toBe(1);
      // 应包含 3 个错误（sse+acp, timeout, max-tool-rounds），且消息头含错误数量
      expect(captured).toContain("3 个错误");
      expect(captured).toContain("--sse");
      expect(captured).toContain("--timeout");
      expect(captured).toContain("--max-tool-rounds");
    } finally {
      process.stderr.write = originalStderrWrite;
    }
  });
});
