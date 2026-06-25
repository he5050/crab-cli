/**
 * Config export→import 集成测试
 *
 * 测试重点:
 *   - 导出→导入往返数据一致性
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { configExportCommand } from "@/command/config/export";
import { configImportCommand } from "@/command/config/import";
import { loadConfig } from "@/config";

describe("config export→import roundtrip", () => {
  const tmpDir = path.join(os.tmpdir(), "crab-config-roundtrip-test");

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

  test("should roundtrip config data consistently", async () => {
    const exportPath = path.join(tmpDir, "exported.json");
    const importPath = path.join(tmpDir, "reimported.json");

    // 1. Export current config
    await configExportCommand({ output: exportPath, format: "json" });
    expect(fs.existsSync(exportPath)).toBe(true);

    const exportedContent = fs.readFileSync(exportPath, "utf-8");
    const exportedConfig = JSON.parse(exportedContent);
    expect(exportedConfig.defaultProvider).toBeDefined();

    // 2. Modify the exported config
    const modifiedConfig = {
      ...exportedConfig,
      defaultProvider: { ...exportedConfig.defaultProvider, model: "gpt-4-turbo" },
    };
    fs.writeFileSync(importPath, JSON.stringify(modifiedConfig, null, 2));

    // 3. Import the modified config with replace mode
    const originalExit = process.exit;
    process.exit = (() => {
      throw new Error("process.exit(0)");
    }) as any;

    try {
      await configImportCommand(importPath, { force: true, merge: false });
    } catch {
      // Expected - process.exit(0)
    } finally {
      process.exit = originalExit;
    }

    // 4. Verify the config was updated
    const reloadedConfig = await loadConfig();
    expect(reloadedConfig.defaultProvider.model).toBe("gpt-4-turbo");
  });
});
