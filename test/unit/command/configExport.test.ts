/**
 * Config export 命令单元测试
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { configExportCommand } from "@/command/config/export";

describe("configExportCommand", () => {
  const tmpDir = path.join(os.tmpdir(), "crab-config-export-test");

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

  test("should export config to stdout", async () => {
    const originalLog = console.log;
    let output = "";
    console.log = (s: string) => {
      output = s;
    };
    try {
      await configExportCommand({ format: "json" });
      const parsed = JSON.parse(output);
      expect(parsed).toBeDefined();
      expect(typeof parsed).toBe("object");
    } finally {
      console.log = originalLog;
    }
  });

  test("should export config to file", async () => {
    const outputPath = path.join(tmpDir, "exported-config.json");
    await configExportCommand({ output: outputPath, format: "pretty" });
    expect(fs.existsSync(outputPath)).toBe(true);
    const content = fs.readFileSync(outputPath, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed).toBeDefined();
  });

  test("should sanitize sensitive fields when requested", async () => {
    const originalLog = console.log;
    let output = "";
    console.log = (s: string) => {
      output = s;
    };
    try {
      await configExportCommand({ format: "json", sanitize: true });
      const parsed = JSON.parse(output);
      // Check that apiKey fields are redacted
      if (parsed.providerConfig) {
        for (const provider of Object.values(parsed.providerConfig as Record<string, any>)) {
          if (provider.apiKey !== undefined) {
            expect(provider.apiKey).toBe("***REDACTED***");
          }
        }
      }
    } finally {
      console.log = originalLog;
    }
  });

  test("should export config to nested directory", async () => {
    const nestedDir = path.join(tmpDir, "nested", "deep", "dir");
    const outputPath = path.join(nestedDir, "exported-config.json");
    await configExportCommand({ output: outputPath, format: "pretty" });
    expect(fs.existsSync(outputPath)).toBe(true);
    const content = fs.readFileSync(outputPath, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed).toBeDefined();
  });
});
