/**
 * 配置来源测试。
 *
 * 测试目标:
 *   - 验证 config 来源(XDG_CONFIG_HOME、项目 .crab、用户配置)的解析优先级
 *
 * 测试用例:
 *   - 各来源独立可用
 *   - 多来源并存时按优先级合并
 *   - 缺失来源时的回退
 */
import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cleanupTestDir } from "../../helpers/testPaths";

let tempDir = "";
let originalXdgConfigHome: string | undefined;
let originalCwd = process.cwd();
let originalApiKey: string | undefined;
let originalModel: string | undefined;
let originalProvider: string | undefined;
let originalDev: string | undefined;

afterEach(async () => {
  if (originalXdgConfigHome !== undefined) {
    process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
  } else {
    delete process.env.XDG_CONFIG_HOME;
  }
  if (originalApiKey !== undefined) {
    process.env.CRAB_API_KEY = originalApiKey;
  } else {
    delete process.env.CRAB_API_KEY;
  }
  if (originalModel !== undefined) {
    process.env.CRAB_MODEL = originalModel;
  } else {
    delete process.env.CRAB_MODEL;
  }
  if (originalProvider !== undefined) {
    process.env.CRAB_PROVIDER = originalProvider;
  } else {
    delete process.env.CRAB_PROVIDER;
  }
  if (originalDev !== undefined) {
    process.env.CRAB_DEV = originalDev;
  } else {
    delete process.env.CRAB_DEV;
  }
  process.chdir(originalCwd);
  cleanupTestDir(tempDir);
  tempDir = "";

  const configModule = await import("@/config/loader/config");
  configModule.resetConfigCache();
});

describe("config-sources", () => {
  test("source labels 与 profile/project/env 分层后的 merged config 一致", async () => {
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
    originalApiKey = process.env.CRAB_API_KEY;
    originalModel = process.env.CRAB_MODEL;
    originalProvider = process.env.CRAB_PROVIDER;
    originalDev = process.env.CRAB_DEV;
    originalCwd = process.cwd();

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-sources-"));
    const configDir = path.join(tempDir, "crab");
    const profilesDir = path.join(configDir, "profiles");
    const projectDir = path.join(tempDir, "project");
    const projectCrabDir = path.join(projectDir, ".crab");
    fs.mkdirSync(profilesDir, { recursive: true });
    fs.mkdirSync(projectCrabDir, { recursive: true });

    process.env.XDG_CONFIG_HOME = tempDir;
    process.chdir(projectDir);

    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify(
        {
          defaultProvider: { model: "global-model", provider: "openai" },
          devMode: false,
          profile: "work",
          providerConfig: {
            openai: {
              apiKey: "global-key",
              requestMethod: "chat",
            },
          },
          theme: "dark",
        },
        null,
        2,
      ),
      "utf8",
    );

    fs.writeFileSync(
      path.join(profilesDir, "work.json"),
      JSON.stringify(
        {
          defaultProvider: { model: "profile-model", provider: "anthropic" },
          providerConfig: {
            anthropic: {
              apiKey: "profile-key",
              requestMethod: "chat",
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    fs.writeFileSync(
      path.join(projectCrabDir, "config.json"),
      JSON.stringify(
        {
          devMode: true,
          theme: "light",
        },
        null,
        2,
      ),
      "utf8",
    );

    process.env.CRAB_API_KEY = "env-key";
    process.env.CRAB_MODEL = "env-model";
    process.env.CRAB_PROVIDER = "anthropic";
    process.env.CRAB_DEV = "1";

    const configModule = await import("@/config/loader/config.ts");
    configModule.resetConfigCache();
    const sourcesModule = await import("@/config/loader/configSources.ts");

    const config = await configModule.loadConfig();
    const providerSource = await sourcesModule.getConfigSource("provider");
    const modelSource = await sourcesModule.getConfigSource("model");
    const apiKeySource = await sourcesModule.getConfigSource("apiKey");
    const themeSource = await sourcesModule.getConfigSource("theme");
    const devModeSource = await sourcesModule.getConfigSource("devMode");
    const profileSource = await sourcesModule.getConfigSource("profile");

    expect(config.defaultProvider.provider).toBe("anthropic");
    expect(providerSource.source).toBe("env");

    expect(config.defaultProvider.model).toBe("env-model");
    expect(modelSource.source).toBe("env");

    expect(config.providerConfig.anthropic?.apiKey).toBe("env-key");
    expect(apiKeySource.source).toBe("env");

    expect(config.theme).toBe("light");
    expect(themeSource.source).toBe("project");

    expect(config.devMode).toBe(true);
    expect(devModeSource.source).toBe("env");

    expect(config.profile).toBe("work");
    expect(profileSource.source).toBe("global");
  });
});
