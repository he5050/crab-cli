/**
 * src/tool/scheduler 纯函数单元测试
 *
 * 测试范围:
 *   - 各 action 分支的参数校验和返回值结构
 *   - 通过 mock loopManager/loopDaemonManager/validateCron 隔离外部依赖
 *
 * 策略: mock.module 替换 @/mission 依赖，验证工具路由逻辑。
 */
import { afterEach, describe, expect, it, mock } from "bun:test";

// ── Mock 外部依赖 ──────────────────────────────────────────────────

const mockCreateLoop = mock((_s: any) => ({ id: "loop_1", prompt: "test", cronExpr: "0 9 * * *" }));
const mockStartLoop = mock((_id: string) => {});
const mockListLoops = mock(() => [] as any[]);
const mockGetLoop = mock((_id: string) => null as any);
const mockPauseLoop = mock((_id: string) => false);
const mockResumeLoop = mock((_id: string) => false);
const mockCancelLoop = mock((_id: string) => null as any);
const mockGetHistory = mock((_id: string, _limit?: number) => [] as any[]);
const mockGetStats = mock((_id: string) => null as any);
const mockSuspendTimers = mock(() => {});
const mockRestoreActiveLoops = mock(() => {});
const mockValidateCron = mock((_expr: string) => ({ valid: true }) as any);

const mockDaemonStatus = mock(() => ({ running: false }));
const mockDaemonMarkRunning = mock(() => ({ running: true }));
const mockDaemonStop = mock(() => ({ running: false }));
const mockDaemonResume = mock(() => ({ running: true }));
const mockDaemonReadLogs = mock(() => []);

mock.module("@/core/logging/logger", () => ({
  createLogger: () => ({ debug: () => {}, error: () => {}, info: () => {}, warn: () => {} }),
}));

mock.module("@/mission", () => ({
  loopManager: {
    cancelLoop: mockCancelLoop,
    createLoop: mockCreateLoop,
    getHistory: mockGetHistory,
    getLoop: mockGetLoop,
    getStats: mockGetStats,
    listLoops: mockListLoops,
    pauseLoop: mockPauseLoop,
    resumeLoop: mockResumeLoop,
    restoreActiveLoops: mockRestoreActiveLoops,
    startLoop: mockStartLoop,
    suspendTimers: mockSuspendTimers,
  },
  loopDaemonManager: {
    markRunning: mockDaemonMarkRunning,
    readLogs: mockDaemonReadLogs,
    resume: mockDaemonResume,
    status: mockDaemonStatus,
    stop: mockDaemonStop,
  },
  validateCron: mockValidateCron,
}));

import { schedulerTool } from "@/tool/scheduler";

afterEach(() => {
  mockClearAll();
});

function mockClearAll() {
  mockCreateLoop.mockClear();
  mockStartLoop.mockClear();
  mockListLoops.mockClear();
  mockGetLoop.mockClear();
  mockPauseLoop.mockClear();
  mockResumeLoop.mockClear();
  mockCancelLoop.mockClear();
  mockGetHistory.mockClear();
  mockGetStats.mockClear();
  mockValidateCron.mockClear();
}

// ═══════════════════════════════════════════════════════════════════
// create
// ═══════════════════════════════════════════════════════════════════
describe("schedulerTool — create", () => {
  it("缺 prompt 应返回错误", async () => {
    const r = (await schedulerTool.execute({ action: "create" })) as Record<string, unknown>;
    expect(r.success).toBe(false);
    expect(r.error).toContain("prompt");
  });

  it("缺 cron 和 delay 应返回错误", async () => {
    const r = (await schedulerTool.execute({ action: "create", prompt: "hello" })) as Record<string, unknown>;
    expect(r.success).toBe(false);
    expect(r.error).toContain("cron");
  });

  it("cron 验证失败应返回错误", async () => {
    mockValidateCron.mockReturnValueOnce({ valid: false, error: "无效表达式" });
    const r = (await schedulerTool.execute({ action: "create", prompt: "hi", cron: "bad" })) as Record<string, unknown>;
    expect(r.success).toBe(false);
    expect(r.error).toContain("Cron 表达式无效");
  });

  it("合法 cron 应创建并启动任务", async () => {
    mockCreateLoop.mockReturnValueOnce({ id: "l1", prompt: "hi", cronExpr: "0 9 * * *" });
    const r = (await schedulerTool.execute({ action: "create", prompt: "hi", cron: "0 9 * * *" })) as Record<
      string,
      unknown
    >;
    expect(r.success).toBe(true);
    expect(r.action).toBe("create");
    expect(mockCreateLoop).toHaveBeenCalledTimes(1);
    expect(mockStartLoop).toHaveBeenCalledWith("l1");
  });

  it("delay 模式应创建任务", async () => {
    mockCreateLoop.mockReturnValueOnce({ id: "l2", prompt: "later", delayMs: 5000 } as any);
    const r = (await schedulerTool.execute({ action: "create", prompt: "later", delay: 5 })) as Record<string, unknown>;
    expect(r.success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// list
// ═══════════════════════════════════════════════════════════════════
describe("schedulerTool — list", () => {
  it("应列出所有任务", async () => {
    mockListLoops.mockReturnValueOnce([{ id: "l1", prompt: "a" } as any, { id: "l2", prompt: "b" } as any]);
    const r = (await schedulerTool.execute({ action: "list" })) as Record<string, unknown>;
    expect(r.success).toBe(true);
    expect(r.total).toBe(2);
    expect(r.action).toBe("list");
  });
});

// ═══════════════════════════════════════════════════════════════════
// status / pause / resume / delete
// ═══════════════════════════════════════════════════════════════════
describe("schedulerTool — 单任务操作", () => {
  it("status 缺 taskId 应返回错误", async () => {
    const r = (await schedulerTool.execute({ action: "status" })) as Record<string, unknown>;
    expect(r.success).toBe(false);
    expect(r.error).toContain("taskId");
  });

  it("status 不存在的任务应返回错误", async () => {
    const r = (await schedulerTool.execute({ action: "status", taskId: "sch_noexist" })) as Record<string, unknown>;
    expect(r.success).toBe(false);
    expect(r.error).toContain("不存在");
  });

  it("pause 不存在的任务应返回错误", async () => {
    const r = (await schedulerTool.execute({ action: "pause", taskId: "sch_noexist" })) as Record<string, unknown>;
    expect(r.success).toBe(false);
  });

  it("delete 不存在的任务应返回错误", async () => {
    const r = (await schedulerTool.execute({ action: "delete", taskId: "sch_noexist" })) as Record<string, unknown>;
    expect(r.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// history / stats
// ═══════════════════════════════════════════════════════════════════
describe("schedulerTool — history & stats", () => {
  it("history 缺 taskId 应返回错误", async () => {
    const r = (await schedulerTool.execute({ action: "history" })) as Record<string, unknown>;
    expect(r.success).toBe(false);
    expect(r.error).toContain("taskId");
  });

  it("stats 缺 taskId 应返回错误", async () => {
    const r = (await schedulerTool.execute({ action: "stats" })) as Record<string, unknown>;
    expect(r.success).toBe(false);
    expect(r.error).toContain("taskId");
  });
});

// ═══════════════════════════════════════════════════════════════════
// daemon 操作
// ═══════════════════════════════════════════════════════════════════
describe("schedulerTool — daemon 操作", () => {
  it("daemon_status 应返回当前状态", async () => {
    const r = (await schedulerTool.execute({ action: "daemon_status" })) as Record<string, unknown>;
    expect(r.success).toBe(true);
    expect(r.action).toBe("daemon_status");
  });

  it("daemon_start 应标记运行并恢复 loop", async () => {
    const r = (await schedulerTool.execute({ action: "daemon_start" })) as Record<string, unknown>;
    expect(r.success).toBe(true);
    expect(mockRestoreActiveLoops).toHaveBeenCalledTimes(1);
  });

  it("daemon_stop 应停止并暂停 timers", async () => {
    const r = (await schedulerTool.execute({ action: "daemon_stop" })) as Record<string, unknown>;
    expect(r.success).toBe(true);
    expect(mockSuspendTimers).toHaveBeenCalledTimes(1);
  });

  it("daemon_resume 应恢复", async () => {
    const r = (await schedulerTool.execute({ action: "daemon_resume" })) as Record<string, unknown>;
    expect(r.success).toBe(true);
    expect(mockRestoreActiveLoops).toHaveBeenCalledTimes(1);
  });

  it("daemon_logs 应返回日志列表", async () => {
    mockDaemonReadLogs.mockReturnValueOnce([{ ts: 1, msg: "log1" }] as any);
    const r = (await schedulerTool.execute({ action: "daemon_logs" })) as Record<string, unknown>;
    expect(r.success).toBe(true);
    expect(r.total).toBe(1);
  });
});
