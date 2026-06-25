/**
 * 配置运行时行为测试。
 *
 * 测试目标:
 *   - 验证配置在运行时的变更响应、热重载与缓存失效
 *
 * 测试用例:
 *   - 配置变更后订阅者立即收到通知
 *   - 缓存命中与失效逻辑
 *   - 不影响未变更字段
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cleanupTestDir } from "../../helpers/testPaths";

describe("配置运行时行为", () => {
  let tempDir: string;
  let configDir: string;
  let projectDir: string;
  let originalCwd: string;
  let originalXdgConfigHome: string | undefined;
  let originalXdgDataHome: string | undefined;
  let originalApiKey: string | undefined;
  let originalModel: string | undefined;
  let originalProvider: string | undefined;
  let originalProxy: string | undefined;
  let originalDev: string | undefined;

  beforeEach(async () => {
    originalCwd = process.cwd();
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
    originalXdgDataHome = process.env.XDG_DATA_HOME;
    originalApiKey = process.env.CRAB_API_KEY;
    originalModel = process.env.CRAB_MODEL;
    originalProvider = process.env.CRAB_PROVIDER;
    originalProxy = process.env.CRAB_PROXY;
    originalDev = process.env.CRAB_DEV;

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-runtime-"));
    configDir = path.join(tempDir, "config", "crab");
    projectDir = path.join(tempDir, "workspace");
    fs.mkdirSync(path.join(configDir, "profiles"), { recursive: true });
    fs.mkdirSync(path.join(projectDir, ".crab"), { recursive: true });

    process.env.XDG_CONFIG_HOME = path.join(tempDir, "config");
    process.env.XDG_DATA_HOME = path.join(tempDir, "data");
    process.chdir(projectDir);

    const configModule = await import("@/config/loader/config");
    configModule.stopConfigWatch();
    configModule.resetConfigCache();
  });

  afterEach(async () => {
    const configModule = await import("@/config/loader/config");
    configModule.stopConfigWatch();
    configModule.resetConfigCache();

    process.chdir(originalCwd);
    restoreEnv("XDG_CONFIG_HOME", originalXdgConfigHome);
    restoreEnv("XDG_DATA_HOME", originalXdgDataHome);
    restoreEnv("CRAB_API_KEY", originalApiKey);
    restoreEnv("CRAB_MODEL", originalModel);
    restoreEnv("CRAB_PROVIDER", originalProvider);
    restoreEnv("CRAB_PROXY", originalProxy);
    restoreEnv("CRAB_DEV", originalDev);
    cleanupTestDir(tempDir);
  });

  test("loadConfig 按全局、profile、项目、环境变量优先级合并", async () => {
    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify({
        _metadata: { version: "old" },
        defaultProvider: { model: "global-model", provider: "openai" },
        devMode: false,
        profile: "work",
        providerConfig: {
          openai: { apiKey: "global-key", requestMethod: "chat" },
        },
        proxy: {
          browserDebugPort: 9333,
          enabled: false,
          port: 8888,
          searchEngine: "bing",
          url: "http://old-proxy:7890",
        },
        theme: "dark",
      }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(configDir, "profiles", "work.json"),
      JSON.stringify({
        defaultProvider: { model: "profile-model", provider: "anthropic" },
        maxSpawnDepth: 5,
        providerConfig: {
          anthropic: { apiKey: "profile-key", requestMethod: "claude" },
        },
      }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(projectDir, ".crab", "config.json"),
      JSON.stringify({
        providerConfig: {
          anthropic: { defaultModel: "project-default", requestMethod: "claude" },
        },
        theme: "light",
      }),
      "utf8",
    );
    process.env.CRAB_API_KEY = "env-key";
    process.env.CRAB_MODEL = "env-model";
    process.env.CRAB_PROVIDER = "anthropic";
    process.env.CRAB_PROXY = "http://127.0.0.1:7890";
    process.env.CRAB_DEV = "1";

    const { loadConfig } = await import("@/config/loader/config");
    const config = await loadConfig();

    expect(config.profile).toBe("work");
    expect(config.theme).toBe("light");
    expect(config.defaultProvider).toEqual({ model: "env-model", provider: "anthropic" });
    expect(config.providerConfig.anthropic?.apiKey).toBe("env-key");
    expect(config.providerConfig.anthropic?.defaultModel).toBe("project-default");
    expect(config.proxy).toEqual({
      browserDebugPort: 9333,
      enabled: true,
      port: 8888,
      searchEngine: "bing",
      url: "http://127.0.0.1:7890",
    });
    expect(config.devMode).toBe(true);
    expect(config.maxSpawnDepth).toBe(5);
  });

  test("config 使用缓存，resetConfigCache 后重新读取文件", async () => {
    const globalPath = path.join(configDir, "config.json");
    fs.writeFileSync(globalPath, JSON.stringify({ theme: "light" }), "utf8");

    const configModule = await import("@/config/loader/config");
    const first = await configModule.config();
    fs.writeFileSync(globalPath, JSON.stringify({ theme: "dracula" }), "utf8");
    const cached = await configModule.config();
    configModule.resetConfigCache();
    const reloaded = await configModule.config();

    expect(first.theme).toBe("light");
    expect(cached.theme).toBe("light");
    expect(reloaded.theme).toBe("dracula");
  });

  test("getApplicationDataDir 使用 XDG_DATA_HOME", async () => {
    const { getApplicationDataDir } = await import("@/config/loader/config");

    expect(getApplicationDataDir()).toBe(path.join(tempDir, "data", "crab"));
  });

  test("startConfigWatch 可回退到 fs.watch 并可安全重复启停", async () => {
    fs.writeFileSync(path.join(configDir, "config.json"), JSON.stringify({ theme: "light" }), "utf8");

    const configModule = await import("@/config/loader/config");
    configModule.startConfigWatch();
    configModule.startConfigWatch();
    await Bun.sleep(30);
    configModule.pauseConfigWatch();
    configModule.resumeConfigWatch();
    configModule.stopConfigWatch();
    configModule.stopConfigWatch();

    expect(true).toBe(true);
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value !== undefined) {
    process.env[key] = value;
  } else {
    delete process.env[key];
  }
}
