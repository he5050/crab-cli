/**
 * 插件来源验证测试
 *
 * 测试场景:
 *   1. 白名单为空时，允许任意来源
 *   2. 白名单非空时，仅允许白名单内来源
 *   3. 插件缺少 source 字段时拒绝加载
 *   4. 插件来源不在白名单时拒绝加载
 *   5. 插件来源在白名单时允许加载
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { PluginLoader } from "@/extension/plugin/pluginLoader";

describe("插件来源验证", () => {
  const testPluginDir = join(process.cwd(), "test-plugins-source");

  beforeEach(() => {
    // 创建测试目录
    mkdirSync(testPluginDir, { recursive: true });
  });

  afterEach(() => {
    // 清理测试目录
    rmSync(testPluginDir, { force: true, recursive: true });
  });

  /**
   * 创建测试插件
   */
  function createTestPlugin(name: string, source?: string) {
    const pluginPath = join(testPluginDir, name);
    mkdirSync(pluginPath, { recursive: true });

    const packageJson = {
      carbonConfig: {
        type: "tool",
        ...(source ? { source } : {}),
      },
      main: "index.js",
      name,
      version: "1.0.0",
    };

    writeFileSync(join(pluginPath, "package.json"), JSON.stringify(packageJson, null, 2));
    writeFileSync(join(pluginPath, "index.js"), "module.exports = {};");
  }

  it("白名单为空时，允许任意来源", async () => {
    createTestPlugin("plugin-no-source");
    createTestPlugin("plugin-with-source", "unknown-source");

    const loader = new PluginLoader({
      allowedSources: [], // 空白名单
      pluginDir: testPluginDir,
    });

    const plugins = await loader.discover();
    expect(plugins.length).toBe(2);
  });

  it("白名单非空时，缺少 source 字段的插件被拒绝", async () => {
    createTestPlugin("plugin-no-source");

    const loader = new PluginLoader({
      allowedSources: ["official", "verified"],
      pluginDir: testPluginDir,
    });

    const plugins = await loader.discover();
    expect(plugins.length).toBe(0);
  });

  it("插件来源不在白名单时拒绝加载", async () => {
    createTestPlugin("plugin-untrusted", "untrusted-source");

    const loader = new PluginLoader({
      allowedSources: ["official", "verified"],
      pluginDir: testPluginDir,
    });

    const plugins = await loader.discover();
    expect(plugins.length).toBe(0);
  });

  it("插件来源在白名单时允许加载", async () => {
    createTestPlugin("plugin-official", "official");
    createTestPlugin("plugin-verified", "verified");

    const loader = new PluginLoader({
      allowedSources: ["official", "verified"],
      pluginDir: testPluginDir,
    });

    const plugins = await loader.discover();
    expect(plugins.length).toBe(2);

    const sources = plugins.map((p) => p.metadata.source).toSorted();
    expect(sources).toEqual(["official", "verified"]);
  });

  it("混合场景:部分通过部分拒绝", async () => {
    createTestPlugin("plugin-official", "official");
    createTestPlugin("plugin-untrusted", "untrusted");
    createTestPlugin("plugin-no-source");

    const loader = new PluginLoader({
      allowedSources: ["official"],
      pluginDir: testPluginDir,
    });

    const plugins = await loader.discover();
    expect(plugins.length).toBe(1);
    expect(plugins[0]?.metadata.id).toBe("plugin-official");
  });

  it("load() 方法同样遵守白名单", async () => {
    createTestPlugin("plugin-untrusted", "untrusted");

    const loader = new PluginLoader({
      allowedSources: ["official"],
      pluginDir: testPluginDir,
    });

    const pluginPath = join(testPluginDir, "plugin-untrusted");
    const result = await loader.load(pluginPath);

    expect(result.success).toBe(false);
    expect(result.error).toContain("不在白名单内");
  });

  it("load() 方法允许白名单内插件", async () => {
    createTestPlugin("plugin-official", "official");

    const loader = new PluginLoader({
      allowedSources: ["official"],
      pluginDir: testPluginDir,
    });

    const pluginPath = join(testPluginDir, "plugin-official");
    const result = await loader.load(pluginPath);

    expect(result.success).toBe(true);
    expect(result.module).toBeDefined();
  });
});
