/**
 * 配置错误处理测试。
 *
 * 测试用例:
 *   - 配置验证错误
 *   - 错误信息格式化
 *   - 错误恢复
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadConfig, resetConfigCache } from "@/config";
import { cleanupTestDir } from "../../helpers/testPaths";

describe("配置加载异常边界测试", () => {
  let tmpDir: string;
  let configDir: string;
  let origXdgConfig: string | undefined;
  let origCwd: string;

  beforeEach(() => {
    origXdgConfig = process.env.XDG_CONFIG_HOME;
    origCwd = process.cwd();
    // 在 /tmp 下深层嵌套，确保 getProjectConfigPath 向上遍历不会找到 ~/.crab/config.json
    tmpDir = fs.mkdtempSync("/tmp/crab-test-config-error-");
    configDir = path.join(tmpDir, "crab");
    fs.mkdirSync(configDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = tmpDir;
    process.chdir(tmpDir);
    resetConfigCache();
  });

  afterEach(() => {
    process.chdir(origCwd);
    cleanupTestDir(tmpDir);
    if (origXdgConfig !== undefined) {
      process.env.XDG_CONFIG_HOME = origXdgConfig;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }
  });

  test("配置文件不存在时返回默认配置", async () => {
    // 不创建任何 config.json → readJsonFile 返回 null
    const cfg = await loadConfig();
    expect(cfg.theme).toBe("dark");
    expect(cfg.profile).toBe("default");
  });

  test("配置文件 JSON 损坏时记录错误并返回默认配置", async () => {
    // 写入损坏的 JSON
    const configPath = path.join(configDir, "config.json");
    fs.writeFileSync(configPath, "{ invalid json !!!");

    const cfg = await loadConfig();
    expect(cfg.theme).toBe("dark");
  });
});
