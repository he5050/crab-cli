/**
 * 路径配置测试。
 *
 * 测试用例:
 *   - 配置路径解析
 *   - 路径别名
 *   - 相对路径处理
 */
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

function clearPathsCache() {
  mock.restore();
  try {
    delete require.cache[require.resolve("@/config/paths")];
  } catch {}
}

describe("配置路径", () => {
  const origXdgConfig = process.env.XDG_CONFIG_HOME;
  const origXdgData = process.env.XDG_DATA_HOME;

  beforeEach(() => {
    clearPathsCache();
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_DATA_HOME;
  });

  afterAll(() => {
    if (origXdgConfig) {
      process.env.XDG_CONFIG_HOME = origXdgConfig;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }
    if (origXdgData) {
      process.env.XDG_DATA_HOME = origXdgData;
    } else {
      delete process.env.XDG_DATA_HOME;
    }
  });

  test("getConfigDir 默认在 ~/.crab", async () => {
    const { getConfigDir } = await import("@/config/paths");
    const dir = getConfigDir();
    expect(dir).toContain(".crab");
    expect(dir.length).toBeGreaterThan(0);
  });

  test("getConfigDir 支持 XDG_CONFIG_HOME", async () => {
    process.env.XDG_CONFIG_HOME = "/tmp/xdg-test";
    const { getConfigDir } = await import("@/config/paths");
    const dir = getConfigDir();
    expect(dir).toBe("/tmp/xdg-test/crab");
  });

  test("getGlobalConfigPath 包含 config.json", async () => {
    const { getGlobalConfigPath } = await import("@/config/paths");
    const path = getGlobalConfigPath();
    expect(path).toContain("config.json");
    expect(path).toContain(".crab");
  });

  test("getGlobalMcpConfigPath 包含 mcp.json", async () => {
    const { getGlobalMcpConfigPath } = await import("@/config/paths");
    const path = getGlobalMcpConfigPath();
    expect(path).toContain("mcp.json");
    expect(path).toContain(".crab");
  });

  test("getDataDir 默认在 ~/.local/share/crab", async () => {
    const { getDataDir } = await import("@/config/paths");
    const dir = getDataDir();
    expect(dir).toContain("crab");
  });

  test("getDataDir 支持 XDG_DATA_HOME", async () => {
    process.env.XDG_DATA_HOME = "/tmp/xdg-data-test";
    const { getDataDir } = await import("@/config/paths");
    const dir = getDataDir();
    expect(dir).toBe("/tmp/xdg-data-test/crab");
  });

  test("getProjectConfigPath 无项目配置时返回 null", async () => {
    const { getProjectConfigPath } = await import("@/config/paths");
    const result = getProjectConfigPath("/tmp");
    expect(result).toBeNull();
  });
});
