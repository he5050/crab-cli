/**
 * SSE 守护进程测试。
 *
 * 测试目标:
 *   - 验证 registerSseServer 写入 PID 文件
 *   - 验证 getSseServerStatus 正确读取 PID 文件
 *   - 验证端口冲突与守护进程生命周期
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

describe("SSE Daemon (L4-T04~T05)", () => {
  const tmpDir = path.join(process.cwd(), ".test-sse-daemon");
  const pidFileDir = path.join(tmpDir, ".crab");

  beforeEach(() => {
    mock.restore();
    rmSync(tmpDir, { force: true, recursive: true });
    // 确保临时目录存在
    mkdirSync(pidFileDir, { recursive: true });
  });

  function writePidFile(pid: number, port: number, pidFilePath: string) {
    writeFileSync(
      pidFilePath,
      JSON.stringify({
        pid,
        port,
        startedAt: Date.now(),
        version: "2.0.0",
      }),
      "utf8",
    );
  }

  test("T04: registerSseServer 写入 PID 文件，getSseServerStatus 正确读取", async () => {
    const pidFilePath = path.join(pidFileDir, "sse-server.pid");
    const portPidFilePath = path.join(pidFileDir, "sse-daemon", "port-3001.pid");
    const mod = await import("@/server/sseManager.ts");
    mod.__setSseManagerDepsForTesting({
      getProjectCrabDir: () => path.dirname(pidFilePath),
      version: "2.0.0",
    });

    // 注册
    mod.registerSseServer(3001);
    expect(existsSync(pidFilePath)).toBe(true);
    expect(existsSync(portPidFilePath)).toBe(true);

    const data = JSON.parse(readFileSync(pidFilePath, "utf8"));
    expect(data.pid).toBe(process.pid);
    expect(data.port).toBe(3001);
    expect(data.version).toBe("2.0.0");

    // 获取状态
    const status = mod.getSseServerStatus();
    expect(status.running).toBe(true);
    expect(status.pid).toBe(process.pid);
    expect(status.port).toBe(3001);

    const portStatus = mod.getSseServerStatus(3001);
    expect(portStatus.running).toBe(true);
    expect(portStatus.pid).toBe(process.pid);
    expect(portStatus.port).toBe(3001);

    // 清理
    unlinkSync(pidFilePath);
    unlinkSync(portPidFilePath);
  });

  test("P2-1: 端口级 PID 文件让多端口 daemon 状态互不覆盖", async () => {
    const legacyPidFilePath = path.join(pidFileDir, "sse-server.pid");
    const port3006PidFilePath = path.join(pidFileDir, "sse-daemon", "port-3006.pid");
    const port3007PidFilePath = path.join(pidFileDir, "sse-daemon", "port-3007.pid");
    const mod = await import("@/server/sseManager.ts");
    mod.__setSseManagerDepsForTesting({
      getProjectCrabDir: () => path.dirname(legacyPidFilePath),
      version: "2.0.0",
    });

    mod.registerSseServerProcess(process.pid, 3006, true);
    mod.registerSseServerProcess(process.pid, 3007, false);

    expect(existsSync(port3006PidFilePath)).toBe(true);
    expect(existsSync(port3007PidFilePath)).toBe(true);

    const status3006 = mod.getSseServerStatus(3006);
    expect(status3006.running).toBe(true);
    expect(status3006.port).toBe(3006);

    const status3007 = mod.getSseServerStatus(3007);
    expect(status3007.running).toBe(false);
    expect(status3007.starting).toBe(true);
    expect(status3007.port).toBe(3007);

    const allStatuses = mod.getAllSseServerStatuses();
    expect(allStatuses.map((status: { port?: number }) => status.port).toSorted()).toEqual([3006, 3007]);

    unlinkSync(legacyPidFilePath);
    unlinkSync(port3006PidFilePath);
    unlinkSync(port3007PidFilePath);
  });

  test("P2-1 second round: formatSseStatuses 汇总所有端口状态", async () => {
    const legacyPidFilePath = path.join(pidFileDir, "sse-server.pid");
    const port3008PidFilePath = path.join(pidFileDir, "sse-daemon", "port-3008.pid");
    const port3009PidFilePath = path.join(pidFileDir, "sse-daemon", "port-3009.pid");
    mkdirSync(path.dirname(port3008PidFilePath), { recursive: true });
    writePidFile(process.pid, 3008, port3008PidFilePath);
    writeFileSync(
      port3009PidFilePath,
      JSON.stringify({
        pid: process.pid,
        port: 3009,
        ready: false,
        startedAt: Date.now(),
        version: "2.0.0",
      }),
      "utf8",
    );

    const mod = await import("@/server/sseManager.ts");
    mod.__setSseManagerDepsForTesting({
      getProjectCrabDir: () => path.dirname(legacyPidFilePath),
      version: "2.0.0",
    });

    const statuses = mod.getAllSseServerStatuses();
    expect(statuses.map((status: { port?: number }) => status.port).toSorted()).toEqual([3008, 3009]);

    const formatted = mod.formatSseStatuses(statuses);
    expect(formatted).toContain("SSE 服务器列表: 2 个记录");
    expect(formatted).toContain("3008");
    expect(formatted).toContain("3009");
    expect(formatted).toContain("启动中");
  });

  test("P2-1 second round: stopAllSseServers 按端口批量停止并清理 PID 文件", async () => {
    const legacyPidFilePath = path.join(pidFileDir, "sse-server.pid");
    const port3010PidFilePath = path.join(pidFileDir, "sse-daemon", "port-3010.pid");
    const port3011PidFilePath = path.join(pidFileDir, "sse-daemon", "port-3011.pid");
    mkdirSync(path.dirname(port3010PidFilePath), { recursive: true });
    writePidFile(301_000, 3010, port3010PidFilePath);
    writePidFile(301_100, 3011, port3011PidFilePath);

    const alive = new Set([301_000, 301_100]);
    const originalKill = process.kill;
    process.kill = ((pid: number, signal?: NodeJS.Signals | 0) => {
      if (signal === 0 || signal === undefined) {
        if (alive.has(pid)) {
          return true;
        }
        const err = new Error("process not found") as NodeJS.ErrnoException;
        err.code = "ESRCH";
        throw err;
      }
      if (signal === "SIGTERM") {
        alive.delete(pid);
        return true;
      }
      return true;
    }) as typeof process.kill;

    try {
      const mod = await import("@/server/sseManager.ts");
      mod.__setSseManagerDepsForTesting({
        getProjectCrabDir: () => path.dirname(legacyPidFilePath),
        version: "2.0.0",
      });

      const result = await mod.stopAllSseServers();
      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(2);
      expect(result.message).toContain("2 成功, 0 失败");
      expect(existsSync(port3010PidFilePath)).toBe(false);
      expect(existsSync(port3011PidFilePath)).toBe(false);
    } finally {
      process.kill = originalKill;
    }
  });

  test("T04: 进程已死时 getSseServerStatus 自动清理 PID 文件", async () => {
    const pidFilePath = path.join(pidFileDir, "sse-server.pid");
    // 写入一个不存在的 PID
    writePidFile(9_999_999, 3002, pidFilePath);

    const mod = await import("@/server/sseManager.ts");
    mod.__setSseManagerDepsForTesting({
      getProjectCrabDir: () => path.dirname(pidFilePath),
      version: "2.0.0",
    });

    const status = mod.getSseServerStatus();
    expect(status.running).toBe(false);
    expect(status.error).toBe("进程已退出");
    // PID 文件应被自动清理
    expect(existsSync(pidFilePath)).toBe(false);
  });

  test("T04: ready=false 时状态显示为启动中，markSseServerReady 后转为运行中", async () => {
    const pidFilePath = path.join(pidFileDir, "sse-server.pid");
    const mod = await import("@/server/sseManager.ts");
    mod.__setSseManagerDepsForTesting({
      getProjectCrabDir: () => path.dirname(pidFilePath),
      version: "2.0.0",
    });

    mod.registerSseServer(3004, false);

    const starting = mod.getSseServerStatus();
    expect(starting.running).toBe(false);
    expect(starting.starting).toBe(true);
    expect(mod.formatSseStatus(starting)).toContain("启动中");

    mod.markSseServerReady();

    const running = mod.getSseServerStatus();
    expect(running.running).toBe(true);
    expect(running.starting).toBeUndefined();
    expect(mod.formatSseStatus(running)).toContain("运行中");

    unlinkSync(pidFilePath);
  });

  test("T05: formatSseStatus 格式化状态", async () => {
    const pidFilePath = path.join(pidFileDir, "sse-server.pid");
    writePidFile(process.pid, 3003, pidFilePath);

    const mod = await import("@/server/sseManager.ts");
    mod.__setSseManagerDepsForTesting({
      getProjectCrabDir: () => path.dirname(pidFilePath),
      version: "2.0.0",
    });

    const status = mod.getSseServerStatus();
    const formatted = mod.formatSseStatus(status);
    expect(formatted).toContain("运行中");
    expect(formatted).toContain("PID:");
    expect(formatted).toContain("3003");
    expect(formatted).toContain("版本:");

    // 未运行时
    const notRunning = mod.formatSseStatus({ running: false });
    expect(notRunning).toContain("未运行");

    unlinkSync(pidFilePath);
  });

  test("T05: findAvailablePort 查找可用端口", async () => {
    const pidFilePath = path.join(pidFileDir, "sse-server.pid");
    const mod = await import("@/server/sseManager.ts");
    mod.__setSseManagerDepsForTesting({
      getProjectCrabDir: () => path.dirname(pidFilePath),
      version: "2.0.0",
    });

    // 查找一个不太可能被占用的高端口
    const port = mod.findAvailablePort(19_876);
    // 高端口几乎不可能被占用，应返回端口
    if (port !== null) {
      expect(port).toBeGreaterThanOrEqual(19_876);
      expect(port).toBeLessThanOrEqual(19_885);
    }

    // 传入 maxAttempts=0 应返回 null
    const noPort = mod.findAvailablePort(3000, 0);
    expect(noPort).toBeNull();
  });
});
