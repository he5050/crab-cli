/**
 * 深度合并测试。
 *
 * 测试用例:
 *   - 对象深度合并
 *   - 数组合并策略
 *   - 嵌套对象合并
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { cleanupTestDir, createGlobalTmpTestDir } from "../../helpers/testPaths";

describe("深合并追加策略测试", () => {
  let tmpDir: string;
  let configDir: string;
  let origXdgConfig: string | undefined;
  let origCwd: string;

  beforeEach(() => {
    origXdgConfig = process.env.XDG_CONFIG_HOME;
    origCwd = process.cwd();
    tmpDir = createGlobalTmpTestDir("crab-merge-");
    configDir = path.join(tmpDir, "crab");
    fs.mkdirSync(configDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = tmpDir;
  });

  afterEach(async () => {
    process.chdir(origCwd);
    if (origXdgConfig !== undefined) {
      process.env.XDG_CONFIG_HOME = origXdgConfig;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }

    const { resetConfigCache } = await import("@/config/loader/config");
    resetConfigCache();
    cleanupTestDir(tmpDir);
  });

  test("agents 追加而非覆盖", async () => {
    // 全局配置
    const globalConfigPath = path.join(configDir, "config.json");
    fs.writeFileSync(
      globalConfigPath,
      JSON.stringify({
        agents: [{ mode: "primary", name: "global-agent", prompt: "global" }],
      }),
    );

    // 创建项目目录 + 项目级配置
    const projectDir = path.join(tmpDir, "project");
    const projectCrabDir = path.join(projectDir, ".crab");
    fs.mkdirSync(projectCrabDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectCrabDir, "config.json"),
      JSON.stringify({
        agents: [{ mode: "subagent", name: "project-agent", prompt: "project" }],
      }),
    );
    process.chdir(projectDir);

    const { resetConfigCache } = await import("@/config/loader/config");
    resetConfigCache();
    const { loadConfig } = await import("@/config/loader/config");
    const cfg = await loadConfig();
    expect(cfg.agents.length).toBe(2);
    expect(cfg.agents.map((a: { name: string }) => a.name)).toEqual(["global-agent", "project-agent"]);
  });

  test("providerConfig 深合并", async () => {
    // 全局配置
    const globalConfigPath = path.join(configDir, "config.json");
    fs.writeFileSync(
      globalConfigPath,
      JSON.stringify({
        providerConfig: { openai: { apiKey: "key1", requestMethod: "chat" } },
      }),
    );

    // 项目级配置
    const projectDir = path.join(tmpDir, "project");
    const projectCrabDir = path.join(projectDir, ".crab");
    fs.mkdirSync(projectCrabDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectCrabDir, "config.json"),
      JSON.stringify({
        providerConfig: { openai: { baseURL: "https://custom.api.com", requestMethod: "chat" } },
      }),
    );
    process.chdir(projectDir);

    const { resetConfigCache } = await import("@/config/loader/config");
    resetConfigCache();
    const { loadConfig } = await import("@/config/loader/config");
    const cfg = await loadConfig();
    expect(cfg.providerConfig.openai?.baseURL).toBe("https://custom.api.com");
  });
});
