/**
 * 任务循环守护测试。
 *
 * 测试目标:
 *   - 验证 LoopDaemonManager 对循环型任务的守护与中断逻辑
 *
 * 测试用例:
 *   - 启动 / 停止守护进程
 *   - 达到上限或异常时强制中断
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LoopDaemonManager } from "@/mission";

describe("LoopDaemonManager", () => {
  let dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      rmSync(dir, { force: true, recursive: true });
    }
    dirs = [];
  });

  function tempProject(): string {
    const dir = mkdtempSync(join(tmpdir(), "crab-loop-daemon-"));
    dirs.push(dir);
    return dir;
  }

  test("markRunning 写入 PID 文件并返回 running 状态", () => {
    const projectDir = tempProject();
    const daemon = new LoopDaemonManager({
      processId: 12_345,
      signalProcess: () => true,
    });
    daemon.setProjectDir(projectDir);

    const status = daemon.markRunning(1000);

    expect(status.state).toBe("running");
    expect(status.pid).toBe(12_345);
    expect(status.startedAt).toBe(1000);
    expect(status.pidFile).toContain(".crab/loop-daemon/loop.pid.json");
    expect(daemon.readLogs()).toEqual(expect.arrayContaining([expect.stringContaining("daemon running pid=12345")]));
  });

  test("status 对失效 PID 返回 stale", () => {
    const projectDir = tempProject();
    const daemon = new LoopDaemonManager({
      processId: 1,
      signalProcess: () => {
        throw new Error("not alive");
      },
    });
    daemon.setProjectDir(projectDir);
    daemon.markRunning(1000);

    const status = daemon.status();

    expect(status.state).toBe("stale");
    expect(status.message).toContain("PID");
  });

  test("stop 向外部 PID 发送 SIGTERM 并清理状态文件", () => {
    const projectDir = tempProject();
    const signals: { pid: number; signal?: NodeJS.Signals | 0 }[] = [];
    const daemon = new LoopDaemonManager({
      processId: 111,
      signalProcess: (pid, signal) => {
        signals.push({ pid, signal });
        return true;
      },
    });
    daemon.setProjectDir(projectDir);
    const paths = daemon.getPaths();
    mkdirSync(paths.dir, { recursive: true });
    writeFileSync(
      paths.pidFile,
      JSON.stringify({
        pid: 222,
        projectDir,
        startedAt: 1000,
      }),
    );

    const status = daemon.stop();

    expect(status.state).toBe("stopped");
    expect(signals).toEqual([
      { pid: 222, signal: 0 },
      { pid: 222, signal: "SIGTERM" },
    ]);
    expect(daemon.readLogs()).toEqual(expect.arrayContaining([expect.stringContaining("daemon stopped pid=222")]));
  });
});
