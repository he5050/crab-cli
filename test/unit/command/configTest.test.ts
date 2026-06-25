/**
 * Config test 命令单元测试
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { configTestCommand } from "@/command/config/test";

describe("configTestCommand", () => {
  beforeEach(() => {
    // Reset env
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  test("should exit with error when provider not found", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const originalExit = process.exit;
    let exitCode: number | undefined;
    process.exit = ((code: number) => {
      exitCode = code;
      throw new Error(`process.exit(${code})`);
    }) as any;

    try {
      await configTestCommand("nonexistent-provider");
    } catch {
      expect(exitCode).toBe(1);
    } finally {
      process.exit = originalExit;
    }
  });
});
