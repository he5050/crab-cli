/**
 * 构建配置测试。
 *
 * 测试目标:
 *   - 验证根 build 配置将 ssh2 作为外置依赖
 */
import { describe, expect, test } from "bun:test";

describe("Build 配置", () => {
  test("root build 配置将 ssh2 作为外置依赖", async () => {
    const mod = await import("@/build");
    expect(typeof mod.createBuildOptions).toBe("function");

    const options = mod.createBuildOptions();
    expect(Array.isArray(options.external)).toBe(true);
    expect(options.external).toContain("ssh2");
  });
});
