/**
 * configTestCommand.validate 单元测试
 *
 * 测试重点:
 *   - 空 providerId 触发 exitWithError
 *   - undefined providerId 正常通过（测试全部 Provider）
 *   - 有效 providerId 正常通过（测试单个 Provider）
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { __resetLifecycleForTest } from "@/cli/core/lifecycle";
import type { ParsedCliArgs } from "@/cli/type";

// 触发命令注册（commands.ts 的副作用导入）
await import("@/cli/core/commands");

describe("configTestCommand validate", () => {
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

  test("空字符串 providerId 报错退出", async () => {
    const { getAllCommands } = await import("@/cli/core/commandRegistry");
    const configTest = getAllCommands().find((c) => c.mode === "config-test");
    expect(configTest).toBeDefined();
    expect(configTest!.validate).toBeDefined();

    const parsed = {
      mode: "config-test" as const,
      positionals: ["config", "test", ""],
      values: {},
      ssePort: undefined,
      sseAll: false,
    };
    try {
      configTest!.validate!(parsed as ParsedCliArgs);
    } catch {
      /* process.exit mock */
    }
    expect(exitCode).toBe(1);
  });

  test("纯空白 providerId 报错退出", async () => {
    const { getAllCommands } = await import("@/cli/core/commandRegistry");
    const configTest = getAllCommands().find((c) => c.mode === "config-test")!;

    const parsed = {
      mode: "config-test" as const,
      positionals: ["config", "test", "   "],
      values: {},
      ssePort: undefined,
      sseAll: false,
    };
    try {
      configTest.validate!(parsed as ParsedCliArgs);
    } catch {
      /* process.exit mock */
    }
    expect(exitCode).toBe(1);
  });

  test("undefined providerId 不触发校验（测试全部）", async () => {
    const { getAllCommands } = await import("@/cli/core/commandRegistry");
    const configTest = getAllCommands().find((c) => c.mode === "config-test")!;

    const parsed = {
      mode: "config-test" as const,
      positionals: ["config", "test"],
      values: {},
      ssePort: undefined,
      sseAll: false,
    };
    configTest.validate!(parsed as ParsedCliArgs);
    expect(exitCode).toBeUndefined();
  });

  test("有效 providerId 不触发校验", async () => {
    const { getAllCommands } = await import("@/cli/core/commandRegistry");
    const configTest = getAllCommands().find((c) => c.mode === "config-test")!;

    const parsed = {
      mode: "config-test" as const,
      positionals: ["config", "test", "openai"],
      values: {},
      ssePort: undefined,
      sseAll: false,
    };
    configTest.validate!(parsed as ParsedCliArgs);
    expect(exitCode).toBeUndefined();
  });
});
