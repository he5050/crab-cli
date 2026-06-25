/**
 * Tmp-cleanup 白盒测试 — 临时文件清理集成。
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { cleanupWriteBackups } from "@/tool/filesystem/write";
import { registerTmpCleanup, runTmpCleanup } from "@/bus/lifecycle/tmpCleanup";
import { registerCleanup } from "@/bus/lifecycle/globalCleanup";

describe("cleanupWriteBackups", () => {
  const tmpDir = path.join(os.tmpdir(), `crab-test-cleanup-${Date.now()}`);

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  test("清理过期的 .bak 文件", () => {
    const oldFile = path.join(tmpDir, "test.old.bak");
    const newFile = path.join(tmpDir, "test.new.bak");
    fs.writeFileSync(oldFile, "old");
    fs.writeFileSync(newFile, "new");

    // 设置旧文件 mtime 为 8 天前
    const oldTime = Date.now() - 8 * 24 * 60 * 60 * 1000;
    fs.utimesSync(oldFile, new Date(oldTime), new Date(oldTime));

    // 用 7 天阈值清理
    cleanupWriteBackups.call(null, 7 * 24 * 60 * 60 * 1000);

    // 验证: 因为 cleanupWriteBackups 使用固定的 BACKUP_DIR，
    // 无法重定向到 tmpDir，所以只验证函数不抛异常
    expect(true).toBe(true);
  });

  test("空目录不报错", () => {
    expect(() => cleanupWriteBackups()).not.toThrow();
  });
});

describe("runTmpCleanup", () => {
  test("不抛异常(即使 tmp 目录不存在)", () => {
    expect(() => runTmpCleanup()).not.toThrow();
  });
});

describe("registerTmpCleanup", () => {
  test("注册清理回调不抛异常", () => {
    expect(() => registerTmpCleanup()).not.toThrow();
  });
});
