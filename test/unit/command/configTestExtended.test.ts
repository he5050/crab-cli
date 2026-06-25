/**
 * Config test 命令扩展测试 — 覆盖成功路径和边界场景。
 *
 * 原有 configTest.test.ts 仅覆盖 Provider 不存在的错误路径，
 * 本文件补充：单 Provider 成功、全量成功。
 */
import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import type { configTestCommand } from "@/command/config/test";

let runTest: typeof configTestCommand;

const mockConsole: string[] = [];
let exitCode: number | undefined;
let originalLog: typeof console.log;
let originalExit: typeof process.exit;

beforeEach(async () => {
  mockConsole.length = 0;
  exitCode = undefined;
  originalLog = console.log;
  originalExit = process.exit;

  console.log = (...args: unknown[]) => {
    mockConsole.push(args.map(String).join(" "));
  };
  process.exit = ((code: number) => {
    exitCode = code;
    throw new Error(`process.exit(${code})`);
  }) as any;

  mock.module("@/config", () => ({
    loadConfig: () => ({
      providerConfig: {
        openai: { apiKey: "sk-test", requestMethod: "chat" as const },
        anthropic: { apiKey: "sk-ant-test", requestMethod: "claude" as const },
      },
    }),
  }));

  const realApi = await import("@/api");
  mock.module("@/api", () => ({
    ...(realApi as Record<string, unknown>),
    checkProviderHealth: () =>
      Promise.resolve({
        checkedAt: Date.now(),
        latencyMs: 100,
        providerId: "openai",
        status: "healthy" as const,
      }),
    checkAllProvidersHealth: () =>
      Promise.resolve([
        {
          checkedAt: Date.now(),
          latencyMs: 100,
          providerId: "openai",
          status: "healthy" as const,
        },
        {
          checkedAt: Date.now(),
          latencyMs: 200,
          providerId: "anthropic",
          status: "healthy" as const,
        },
      ]),
  }));

  const mod = await import("@/command/config/test");
  runTest = mod.configTestCommand;
});

afterEach(() => {
  console.log = originalLog;
  process.exit = originalExit;
});

describe("configTestCommand — 单 Provider 成功", () => {
  test("健康检查成功不调用 exit", async () => {
    await runTest("openai");

    expect(exitCode).toBeUndefined();
    const output = mockConsole.join("\n");
    expect(output).toContain("openai");
  });
});

describe("configTestCommand — 全量测试", () => {
  test("所有 Provider 健康不调用 exit", async () => {
    await runTest();

    expect(exitCode).toBeUndefined();
    const output = mockConsole.join("\n");
    expect(output).toContain("openai");
    expect(output).toContain("anthropic");
    expect(output).toContain("2/2");
  });
});
