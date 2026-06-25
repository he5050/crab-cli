/**
 * Config import 命令单元测试
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { configImportCommand } from "@/command/config/import";

describe("configImportCommand", () => {
  const tmpDir = path.join(os.tmpdir(), "crab-config-import-test");

  beforeEach(() => {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
    process.env.OPENAI_API_KEY = "sk-test-key-12345";
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("should exit with error when file not found", async () => {
    const originalExit = process.exit;
    let exitCode: number | undefined;
    process.exit = ((code: number) => {
      exitCode = code;
      throw new Error(`process.exit(${code})`);
    }) as any;

    try {
      await configImportCommand("/nonexistent/path/config.json");
    } catch {
      expect(exitCode).toBe(1);
    } finally {
      process.exit = originalExit;
    }
  });

  test("should exit with error when file contains invalid JSON", async () => {
    const invalidPath = path.join(tmpDir, "invalid.json");
    fs.writeFileSync(invalidPath, "not valid json {");

    const originalExit = process.exit;
    let exitCode: number | undefined;
    process.exit = ((code: number) => {
      exitCode = code;
      throw new Error(`process.exit(${code})`);
    }) as any;

    try {
      await configImportCommand(invalidPath);
    } catch {
      expect(exitCode).toBe(1);
    } finally {
      process.exit = originalExit;
    }
  });

  test("should import valid config with merge mode", async () => {
    const validPath = path.join(tmpDir, "valid.json");
    fs.writeFileSync(
      validPath,
      JSON.stringify({
        defaultProvider: { provider: "openai", model: "gpt-4o" },
      }),
    );

    const originalExit = process.exit;
    process.exit = (() => {
      throw new Error("process.exit(0)");
    }) as any;

    try {
      await configImportCommand(validPath, { force: true });
    } catch {
      // Expected - process.exit(0)
    } finally {
      process.exit = originalExit;
    }
  });

  test("should import valid config with no-merge (replace) mode", async () => {
    const validPath = path.join(tmpDir, "valid-replace.json");
    fs.writeFileSync(
      validPath,
      JSON.stringify({
        defaultProvider: { provider: "openai", model: "gpt-4o-mini" },
      }),
    );

    const originalExit = process.exit;
    process.exit = (() => {
      throw new Error("process.exit(0)");
    }) as any;

    try {
      await configImportCommand(validPath, { force: true, merge: false });
    } catch {
      // Expected - process.exit(0)
    } finally {
      process.exit = originalExit;
    }
  });
});
