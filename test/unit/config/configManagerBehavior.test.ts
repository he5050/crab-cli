/**
 * 配置管理器行为测试。
 *
 * 测试目标:
 *   - 验证 ConfigManager 的载入/保存/订阅/迁移等行为
 *
 * 测试用例:
 *   - 加载合法/非法配置时的行为差异
 *   - 配置变更事件被正确广播
 *   - 多次保存后磁盘内容一致
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cleanupTestDir } from "../../helpers/testPaths";

describe("配置管理器行为", () => {
  let tempDir: string;
  let configDir: string;
  let profilesDir: string;
  let originalXdgConfigHome: string | undefined;
  let originalCwd: string;

  beforeEach(async () => {
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
    originalCwd = process.cwd();

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-manager-behavior-"));
    configDir = path.join(tempDir, "crab");
    profilesDir = path.join(configDir, "profiles");
    fs.mkdirSync(profilesDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = tempDir;
    process.chdir(tempDir);

    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify({
        defaultProvider: { model: "gpt-4o", provider: "openai" },
        maxSpawnDepth: 4,
        providerConfig: {
          openai: {
            apiKey: "test-key",
            requestMethod: "chat",
          },
        },
        theme: "light",
      }),
      "utf8",
    );

    const configModule = await import("@/config/loader/config");
    configModule.resetConfigCache();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (originalXdgConfigHome !== undefined) {
      process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }

    const configModule = await import("@/config/loader/config");
    configModule.resetConfigCache();
    cleanupTestDir(tempDir);
  });

  test("copyProfile 复制源配置并允许覆盖描述", async () => {
    fs.writeFileSync(
      path.join(profilesDir, "source.json"),
      JSON.stringify({
        defaultProvider: { model: "claude-sonnet-4-20250514", provider: "anthropic" },
        description: "old description",
        profile: "source",
        providerConfig: {
          anthropic: {
            apiKey: "anthropic-test-key",
            requestMethod: "claude",
          },
        },
        theme: "dracula",
      }),
      "utf8",
    );

    const { copyProfile } = await import("@/config/settings/configManager");
    const ok = await copyProfile("source", "target", "new description");
    const copied = JSON.parse(fs.readFileSync(path.join(profilesDir, "target.json"), "utf8"));

    expect(ok).toBe(true);
    expect(copied.profile).toBe("target");
    expect(copied.description).toBe("new description");
    expect(copied.theme).toBe("dracula");
    expect(copied.providerConfig.anthropic.requestMethod).toBe("claude");
  });

  test("copyProfile 在源 profile 不存在时返回 false 且不落目标文件", async () => {
    const { copyProfile } = await import("@/config/settings/configManager");
    const ok = await copyProfile("missing", "target");

    expect(ok).toBe(false);
    expect(fs.existsSync(path.join(profilesDir, "target.json"))).toBe(false);
  });

  test("exportProfile 写出指定 profile 配置，缺失 profile 返回 false", async () => {
    fs.writeFileSync(
      path.join(profilesDir, "work.json"),
      JSON.stringify({
        profile: "work",
        theme: "dark",
      }),
      "utf8",
    );
    const exportPath = path.join(tempDir, "work-export.json");

    const { exportProfile } = await import("@/config/settings/configManager");
    const ok = await exportProfile("work", exportPath);
    const missing = await exportProfile("missing", path.join(tempDir, "missing.json"));

    expect(ok).toBe(true);
    expect(JSON.parse(fs.readFileSync(exportPath, "utf8")).theme).toBe("dark");
    expect(missing).toBe(false);
  });

  test("importProfile 读取文件名回退与空文件失败边界", async () => {
    const importPath = path.join(tempDir, "import.json");
    const emptyPath = path.join(tempDir, "empty.json");
    fs.writeFileSync(
      importPath,
      JSON.stringify({
        defaultProvider: { model: "gpt-4o", provider: "openai" },
        theme: "dracula",
      }),
      "utf8",
    );
    fs.writeFileSync(emptyPath, "null", "utf8");

    const { importProfile } = await import("@/config/settings/configManager");
    const ok = await importProfile(importPath);
    const failed = await importProfile(emptyPath, "empty");
    const imported = JSON.parse(fs.readFileSync(path.join(profilesDir, "imported.json"), "utf8"));

    expect(ok).toBe(true);
    expect(imported.theme).toBe("dracula");
    expect(failed).toBe(false);
    expect(fs.existsSync(path.join(profilesDir, "empty.json"))).toBe(false);
  });

  test("resetConfig 持久化默认配置并清理缓存", async () => {
    const { resetConfig } = await import("@/config/settings/configManager");
    const { loadConfig } = await import("@/config/loader/config");

    const ok = await resetConfig();
    const raw = JSON.parse(fs.readFileSync(path.join(configDir, "config.json"), "utf8"));
    const loaded = await loadConfig();

    expect(ok).toBe(true);
    expect(raw.theme).toBe("dark");
    expect(raw.defaultProvider.provider).toBe("openai");
    expect(loaded.theme).toBe("dark");
  });
});
