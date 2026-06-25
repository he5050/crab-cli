/**
 * 实例锁测试。
 *
 * 测试目标:
 *   - 验证 InstanceLockManager 在进程级别单实例锁的获取、释放与冲突处理
 *
 * 测试用例:
 *   - 正常获取与释放锁
 *   - 二次获取时检测到冲突并抛出或返回失败
 *   - 锁文件残留时的清理策略
 */
import { afterEach, describe, expect, mock, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cleanupTestDir } from "../../helpers/testPaths";
import { InstanceLockManager } from "@/core/concurrency/instanceLock";

let tempDir = "";

afterEach(() => {
  mock.restore();
  if (tempDir) {
    cleanupTestDir(tempDir);
    tempDir = "";
  }
});

describe("InstanceLockManager", () => {
  test("lock / isLocked / unlock 基本链路", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "instance-lock-"));
    const manager = new InstanceLockManager(tempDir);

    expect(manager.isLocked("project-a")).toBe(false);
    expect(manager.lock("project-a")).toBe(true);
    expect(manager.isLocked("project-a")).toBe(true);

    manager.unlock("project-a");
    expect(manager.isLocked("project-a")).toBe(false);
  });

  test("僵尸锁会在 isLocked 时被自动清理", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "instance-lock-stale-"));
    const manager = new InstanceLockManager(tempDir);
    const safeId = "project_stale";
    const locksDir = path.join(tempDir, "locks");
    fs.mkdirSync(locksDir, { recursive: true });
    const lockPath = path.join(locksDir, `${safeId}.lock`);
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 999_999, timestamp: Date.now() }), "utf8");

    const killSpy = mock(() => {
      throw Object.assign(new Error("no such process"), { code: "ESRCH" });
    });
    const originalKill = process.kill;
    process.kill = killSpy as typeof process.kill;

    try {
      expect(manager.isLocked("project stale")).toBe(false);
      expect(fs.existsSync(lockPath)).toBe(false);
    } finally {
      process.kill = originalKill;
    }
  });

  test("cleanupStaleLocks 会清掉无效锁文件和僵尸锁", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "instance-lock-cleanup-"));
    const manager = new InstanceLockManager(tempDir);
    const locksDir = path.join(tempDir, "locks");
    fs.mkdirSync(locksDir, { recursive: true });
    fs.writeFileSync(path.join(locksDir, "broken.lock"), "{not-json", "utf8");
    fs.writeFileSync(path.join(locksDir, "dead.lock"), JSON.stringify({ pid: 999_998, timestamp: Date.now() }), "utf8");

    const killSpy = mock(() => {
      throw Object.assign(new Error("no such process"), { code: "ESRCH" });
    });
    const originalKill = process.kill;
    process.kill = killSpy as typeof process.kill;

    try {
      expect(manager.cleanupStaleLocks()).toBe(2);
      expect(fs.readdirSync(locksDir)).toHaveLength(0);
    } finally {
      process.kill = originalKill;
    }
  });
});
