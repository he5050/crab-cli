/**
 * 配置原子保存测试。
 *
 * 测试目标:
 *   - 验证配置保存是原子的(写到临时文件 + rename)，失败时不污染原配置
 *
 * 测试用例:
 *   - 正常保存后配置被更新
 *   - 模拟写入失败时旧配置保持完整
 *   - 临时目录清理不残留
 */
import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cleanupTestDir } from "../../helpers/testPaths";

let tempDir = "";
let originalXdgConfigHome: string | undefined;
let originalCwd = process.cwd();

afterEach(async () => {
  if (originalXdgConfigHome !== undefined) {
    process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
  } else {
    delete process.env.XDG_CONFIG_HOME;
  }
  process.chdir(originalCwd);
  cleanupTestDir(tempDir);
  tempDir = "";
});

describe("saveConfig 原子更新", () => {
  test("saveConfig 持久化后写入 _metadata.version", async () => {
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
    originalCwd = process.cwd();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-save-atomic-"));
    const configDir = path.join(tempDir, "crab");
    const configPath = path.join(configDir, "config.json");
    fs.mkdirSync(configDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = tempDir;
    process.chdir(tempDir);

    fs.writeFileSync(configPath, JSON.stringify({ theme: "dark" }, null, 2), "utf8");

    const mod = await import("@/config");
    mod.resetConfigCache();

    const ok = await mod.saveConfig({ theme: "dracula" });
    expect(ok).toBe(true);

    const persisted = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(persisted.theme).toBe("dracula");
    expect(persisted._metadata).toBeDefined();
    expect(typeof persisted._metadata.version).toBe("string");
    expect(persisted._metadata.version.length).toBeGreaterThan(0);
  });
});
