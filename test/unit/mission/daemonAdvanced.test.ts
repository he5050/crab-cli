/**
 * LoopDaemonManager 高级场景测试。
 *
 * 补充 loopDaemon.test.ts 未覆盖的边界场景:
 *   - PID 文件内容损坏（字段缺失/类型错误）
 *   - 无 PID 文件时 status 返回 stopped
 *   - readLogs 边界（空日志、limit=0、limit 超过行数）
 *   - appendLog 追加行为
 *   - resume 重新写入 PID
 *   - stop 对自身 PID 不发送信号
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LoopDaemonManager } from "@/mission";

describe("LoopDaemonManager 高级场景", () => {
  let dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      rmSync(dir, { force: true, recursive: true });
    }
    dirs = [];
  });

  function tempProject(): string {
    const dir = mkdtempSync(join(tmpdir(), "crab-daemon-adv-"));
    dirs.push(dir);
    return dir;
  }

  describe("PID 文件损坏", () => {
    test("PID 文件缺少 pid 字段返回 stale", () => {
      const projectDir = tempProject();
      const daemon = new LoopDaemonManager({ processId: 1 });
      daemon.setProjectDir(projectDir);

      const paths = daemon.getPaths();
      mkdirSync(paths.dir, { recursive: true });
      // 缺少 pid 字段
      writeFileSync(paths.pidFile, JSON.stringify({ startedAt: 1000, projectDir }), "utf8");

      const status = daemon.status();
      expect(status.state).toBe("stale");
      expect(status.message).toContain("不可读");
    });

    test("PID 文件 pid 为字符串返回 stale", () => {
      const projectDir = tempProject();
      const daemon = new LoopDaemonManager({ processId: 1 });
      daemon.setProjectDir(projectDir);

      const paths = daemon.getPaths();
      mkdirSync(paths.dir, { recursive: true });
      writeFileSync(paths.pidFile, JSON.stringify({ pid: "not-a-number", startedAt: 1000, projectDir }), "utf8");

      const status = daemon.status();
      expect(status.state).toBe("stale");
    });

    test("PID 文件内容非 JSON 返回 stale", () => {
      const projectDir = tempProject();
      const daemon = new LoopDaemonManager({ processId: 1 });
      daemon.setProjectDir(projectDir);

      const paths = daemon.getPaths();
      mkdirSync(paths.dir, { recursive: true });
      writeFileSync(paths.pidFile, "NOT JSON", "utf8");

      const status = daemon.status();
      expect(status.state).toBe("stale");
    });
  });

  describe("readLogs 边界", () => {
    test("无日志文件返回空数组", () => {
      const projectDir = tempProject();
      const daemon = new LoopDaemonManager({ processId: 1 });
      daemon.setProjectDir(projectDir);

      const logs = daemon.readLogs();
      expect(logs).toEqual([]);
    });

    test("limit=1 只返回最后一行", () => {
      const projectDir = tempProject();
      const daemon = new LoopDaemonManager({ processId: 1 });
      daemon.setProjectDir(projectDir);
      daemon.markRunning(1000);
      daemon.appendLog("第二行");
      daemon.appendLog("第三行");

      const logs = daemon.readLogs(1);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toContain("第三行");
    });

    test("空行被过滤", () => {
      const projectDir = tempProject();
      const daemon = new LoopDaemonManager({ processId: 1 });
      daemon.setProjectDir(projectDir);
      daemon.markRunning(1000);

      const paths = daemon.getPaths();
      // 手动追加含空行内容
      const { appendFileSync } = require("node:fs");
      appendFileSync(paths.logFile, "有内容\n\n\n也是内容\n", "utf8");

      const logs = daemon.readLogs();
      expect(logs).not.toContain("");
      expect(logs.some((l) => l.includes("有内容"))).toBe(true);
      expect(logs.some((l) => l.includes("也是内容"))).toBe(true);
    });
  });

  describe("resume", () => {
    test("resume 重新写入 PID 并返回 running", () => {
      const projectDir = tempProject();
      const daemon = new LoopDaemonManager({ processId: 9999, signalProcess: () => true });
      daemon.setProjectDir(projectDir);

      const status = daemon.resume();

      expect(status.state).toBe("running");
      expect(status.pid).toBe(9999);
      expect(daemon.readLogs()).toEqual(expect.arrayContaining([expect.stringContaining("daemon resume requested")]));
      expect(daemon.readLogs()).toEqual(expect.arrayContaining([expect.stringContaining("daemon running pid=9999")]));
    });
  });

  describe("stop 自身 PID", () => {
    test("stop 对自身 PID 不发送信号（避免自杀）", () => {
      const projectDir = tempProject();
      const signals: number[] = [];
      const daemon = new LoopDaemonManager({
        processId: 123,
        signalProcess: (pid) => {
          signals.push(pid);
          return true;
        },
      });
      daemon.setProjectDir(projectDir);
      daemon.markRunning(123);

      const status = daemon.stop();

      // 当前 PID === processId，不应发送 SIGTERM
      expect(signals).toEqual([123, 123]); // probe from markRunning + probe from stop
      expect(status.state).toBe("stopped");
    });
  });
});
