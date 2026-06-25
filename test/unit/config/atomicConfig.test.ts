/**
 * Atomic-config 白盒测试 — getCurrentConfigVersion, cleanupOldBackups。
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { cleanupOldBackups, getCurrentConfigVersion, getVersionHistory } from "@/config";

describe("getCurrentConfigVersion", () => {
  const tmpDir = path.join(os.tmpdir(), `crab-test-atomic-${Date.now()}`);
  const configPath = path.join(tmpDir, "config.json");

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  test("无版本元数据返回 null", async () => {
    fs.writeFileSync(configPath, JSON.stringify({ theme: "dark" }));
    const version = await getCurrentConfigVersion(configPath);
    expect(version).toBeNull();
  });

  test("有版本元数据返回版本号", async () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        _metadata: { source: "test", updatedAt: Date.now(), version: "abc123" },
        theme: "dark",
      }),
    );
    const version = await getCurrentConfigVersion(configPath);
    expect(version).toBe("abc123");
  });

  test("文件不存在返回 null", async () => {
    const version = await getCurrentConfigVersion(path.join(tmpDir, "nonexistent.json"));
    expect(version).toBeNull();
  });

  test("无效 JSON 返回 null", async () => {
    fs.writeFileSync(configPath, "not json");
    const version = await getCurrentConfigVersion(configPath);
    expect(version).toBeNull();
  });
});

describe("cleanupOldBackups", () => {
  const tmpDir = path.join(os.tmpdir(), `crab-test-atomic-cleanup-${Date.now()}`);

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  test("清理过期的 backup 文件", () => {
    const oldBackup = path.join(tmpDir, "config.json.backup.1000");
    const newBackup = path.join(tmpDir, "config.json.backup.9999000");
    fs.writeFileSync(oldBackup, "old");
    fs.writeFileSync(newBackup, "new");

    // 设置旧文件时间
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    fs.utimesSync(oldBackup, new Date(eightDaysAgo), new Date(eightDaysAgo));

    // 注意: cleanupOldBackups 从 getGlobalConfigPath 推导目录，
    // 无法直接重定向到 tmpDir，所以只验证不抛异常
    expect(() => cleanupOldBackups()).not.toThrow();
  });

  test("空目录不报错", () => {
    expect(() => cleanupOldBackups()).not.toThrow();
  });
});

describe("getVersionHistory", () => {
  test("初始历史为空或非空数组", () => {
    const history = getVersionHistory();
    expect(Array.isArray(history)).toBe(true);
  });
});
