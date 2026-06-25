/**
 * 开发模式测试。
 *
 * 测试用例:
 *   - 开发模式切换
 *   - 调试信息输出
 *   - 性能监控
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { isDevMode } from "@/config/devMode";

describe("Dev Mode — 开发模式", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // 清理环境变量
    delete process.env.CRAB_DEV;
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    // 恢复原始环境
    process.env = originalEnv;
  });

  test("isDevMode 返回 false 当无环境变量", () => {
    expect(isDevMode()).toBe(false);
  });

  test("isDevMode 返回 true 当 CRAB_DEV=development", () => {
    process.env.CRAB_DEV = "development";
    expect(isDevMode()).toBe(true);
  });

  test("isDevMode 返回 true 当 CRAB_DEV=dev", () => {
    process.env.CRAB_DEV = "dev";
    expect(isDevMode()).toBe(true);
  });

  test("isDevMode 返回 true 当 CRAB_DEV=1", () => {
    process.env.CRAB_DEV = "1";
    expect(isDevMode()).toBe(true);
  });

  test("isDevMode 返回 true 当 NODE_ENV=development", () => {
    process.env.NODE_ENV = "development";
    expect(isDevMode()).toBe(true);
  });

  test("isDevMode 返回 false 当 NODE_ENV=production", () => {
    process.env.NODE_ENV = "production";
    expect(isDevMode()).toBe(false);
  });
});
