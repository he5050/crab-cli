/**
 * 日志存储测试。
 *
 * 测试用例:
 *   - 日志条目存储
 *   - 日志查询
 *   - 日志清理
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import path from "node:path";
import fs from "node:fs";
import { cleanupTestDir, createGlobalTmpTestDir } from "../../helpers/testPaths";

const tempLogDir = createGlobalTmpTestDir("crab-log-store-");

async function loadLogStore() {
  // @ts-expect-error test-only cache busting for isolated module evaluation
  return import("@/core/logStore?log-store-test");
}

/** 清理日志目录 */
function cleanLogDir(logDir: string): void {
  try {
    if (fs.existsSync(logDir)) {
      const files = fs.readdirSync(logDir);
      for (const file of files) {
        if (file.endsWith(".log")) {
          fs.unlinkSync(path.join(logDir, file));
        }
      }
    }
  } catch {
    // 忽略清理错误
  }
}

describe("LogStore — 日志持久化", () => {
  beforeEach(async () => {
    const { initLogStore, resetLogStoreForTests } = await loadLogStore();
    resetLogStoreForTests();
    cleanLogDir(tempLogDir);
    initLogStore(tempLogDir);
  });

  afterEach(async () => {
    const { resetLogStoreForTests } = await loadLogStore();
    resetLogStoreForTests();
    cleanLogDir(tempLogDir);
    cleanupTestDir(tempLogDir);
  });

  test("写入后可按 requestId 查询", async () => {
    const { appendLogEntry, queryLogs } = await loadLogStore();
    appendLogEntry({
      eventType: "llm.request.start",
      id: "log_1",
      level: "info",
      message: "请求开始",
      requestId: "req_1",
      service: "llm",
      timestamp: Date.now(),
      turnId: "turn_1",
    });

    const rows = queryLogs({ requestId: "req_1" });
    expect(rows.length).toBe(1);
    expect(rows[0]!.eventType).toBe("llm.request.start");
  });

  test("写入后可按 turnId 查询", async () => {
    const { appendLogEntry, queryLogs } = await loadLogStore();
    appendLogEntry({
      id: "log_turn_1",
      level: "info",
      message: "turn scoped",
      requestId: "req_turn_1",
      service: "conversation",
      timestamp: Date.now(),
      turnId: "trn_abc",
    });

    const rows = queryLogs({ turnId: "trn_abc" });
    expect(rows.length).toBe(1);
    expect(rows[0]!.turnId).toBe("trn_abc");
  });

  test("写入后可按 sessionId 查询", async () => {
    const { appendLogEntry, queryLogs } = await loadLogStore();
    appendLogEntry({
      id: "log_ses_1",
      level: "info",
      message: "session scoped",
      service: "conversation",
      sessionId: "ses_abc",
      timestamp: Date.now(),
      turnId: "trn_1",
    });

    const rows = queryLogs({ sessionId: "ses_abc" });
    expect(rows.length).toBe(1);
    expect(rows[0]!.sessionId).toBe("ses_abc");
  });

  test("支持按 level 和 service 过滤", async () => {
    const { appendLogEntry, queryLogs } = await loadLogStore();
    appendLogEntry({
      id: "log_1",
      level: "info",
      message: "info",
      service: "llm",
      timestamp: Date.now(),
    });
    appendLogEntry({
      id: "log_2",
      level: "error",
      message: "error",
      service: "fallback",
      timestamp: Date.now(),
    });

    expect(queryLogs({ level: "error" }).length).toBe(1);
    expect(queryLogs({ service: "llm" }).length).toBe(1);
  });

  test("按默认保留策略清理过期日志", async () => {
    const { appendLogEntry, pruneLogs, queryLogs, getLogRetentionPolicy } = await loadLogStore();
    const now = Date.now();
    const retention = getLogRetentionPolicy();

    appendLogEntry({
      id: "log_old_debug",
      level: "debug",
      message: "old debug",
      service: "llm",
      timestamp: now - (retention.debugDays + 1) * 24 * 60 * 60 * 1000,
    });
    appendLogEntry({
      id: "log_new_error",
      level: "error",
      message: "new error",
      service: "llm",
      timestamp: now,
    });

    const deleted = pruneLogs(now);
    expect(deleted).toBeGreaterThanOrEqual(1);
    const rows = queryLogs({});
    expect(rows.some((row: any) => row.id === "log_old_debug")).toBe(false);
    expect(rows.some((row: any) => row.id === "log_new_error")).toBe(true);
  });
});
