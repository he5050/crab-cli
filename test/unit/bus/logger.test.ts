/**
 * 日志系统测试。
 *
 * 测试用例:
 *   - 日志级别输出
 *   - 服务名和时间戳
 *   - 日志存储和查询
 */
import { beforeEach, describe, expect, test } from "bun:test";

type LoggerModule = typeof import("@/core/logging/logger");

describe("Logger — 日志系统", () => {
  let loggerModule: LoggerModule;

  beforeEach(async () => {
    loggerModule = await import("@/core/logging/logger");
    loggerModule._resetLoggerForTesting();
    loggerModule.setLogLevel("debug");
  });

  test("logger 各级别输出正常", () => {
    const log = loggerModule.createLogger("test");
    log.debug("调试信息");
    log.info("普通信息");
    log.warn("警告信息");
    log.error("错误信息");

    const recent = loggerModule.getRecentLogs(4);
    expect(recent.length).toBeGreaterThanOrEqual(4);
    expect(recent.at(-4)!.level).toBe("debug");
    expect(recent.at(-3)!.level).toBe("info");
    expect(recent.at(-2)!.level).toBe("warn");
    expect(recent.at(-1)!.level).toBe("error");
  });

  test("日志条目包含服务名和时间戳", () => {
    const log = loggerModule.createLogger("myservice");
    log.info("测试");
    const recent = loggerModule.getRecentLogs(1);
    const entry = recent[recent.length - 1]!;
    expect(entry.service).toBe("myservice");
    expect(entry.timestamp).toBeGreaterThan(0);
  });

  test("日志条目保留结构化关联字段", () => {
    const log = loggerModule.createLogger("llm");
    log.info("请求开始", {
      eventType: "llm.request.start",
      modelId: "gpt-5",
      providerId: "openai",
      requestId: "req_001",
      requestMethod: "chat",
      sessionId: "ses_001",
      turnId: "trn_001",
    } as any);

    const recent = loggerModule.getRecentLogs(1);
    const entry = recent[recent.length - 1]!;
    expect(entry.eventType).toBe("llm.request.start");
    expect(entry.requestId).toBe("req_001");
    expect(entry.turnId).toBe("trn_001");
    expect(entry.sessionId).toBe("ses_001");
    expect(entry.providerId).toBe("openai");
    expect(entry.modelId).toBe("gpt-5");
    expect(entry.requestMethod).toBe("chat");
  });

  test("setLogLevel 过滤低级别日志", () => {
    loggerModule.setLogLevel("warn");
    const log = loggerModule.createLogger("filtered");
    log.debug("不应记录");
    log.info("不应记录");
    log.warn("应记录");
    log.error("应记录");

    const recent = loggerModule.getRecentLogs(4);
    // 过滤后只有 warn 和 error
    const filtered = recent.filter((e) => e.service === "filtered");
    expect(filtered.length).toBe(2);
    expect(filtered[0]!.level).toBe("warn");
    expect(filtered[1]!.level).toBe("error");
  });

  test("stdio 协议模式下 info 日志不写 stdout", () => {
    const originalProtocol = process.env.CRAB_STDIO_PROTOCOL;
    const originalInfo = console.info;
    const originalError = console.error;
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    process.env.CRAB_STDIO_PROTOCOL = "1";
    console.info = ((msg?: unknown) => stdoutLines.push(String(msg ?? ""))) as typeof console.info;
    console.error = ((msg?: unknown) => stderrLines.push(String(msg ?? ""))) as typeof console.error;

    try {
      const log = loggerModule.createLogger("stdio-test");
      log.info("协议外日志");
    } finally {
      console.info = originalInfo;
      console.error = originalError;
      if (originalProtocol === undefined) {
        delete process.env.CRAB_STDIO_PROTOCOL;
      } else {
        process.env.CRAB_STDIO_PROTOCOL = originalProtocol;
      }
    }

    expect(stdoutLines).toHaveLength(0);
    expect(stderrLines.some((line) => line.includes("协议外日志"))).toBe(true);
  });

  test("--acp 参数模式下模块初始化日志不写 stdout", () => {
    const originalInfo = console.info;
    const originalError = console.error;
    const originalArgv = [...process.argv];
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    process.argv.push("--acp");
    console.info = ((msg?: unknown) => stdoutLines.push(String(msg ?? ""))) as typeof console.info;
    console.error = ((msg?: unknown) => stderrLines.push(String(msg ?? ""))) as typeof console.error;

    try {
      const log = loggerModule.createLogger("stdio-argv-test");
      log.info("argv 协议外日志");
    } finally {
      console.info = originalInfo;
      console.error = originalError;
      process.argv.splice(0, process.argv.length, ...originalArgv);
    }

    expect(stdoutLines).toHaveLength(0);
    expect(stderrLines.some((line) => line.includes("argv 协议外日志"))).toBe(true);
  });

  test("logger 支持注入 log event sink，避免反向依赖 bus 模块", () => {
    const received: Array<{ level: string; message: string }> = [];
    loggerModule._setLogEventSinkForTesting((entry) => {
      received.push(entry);
    });

    const log = loggerModule.createLogger("sink-test");
    log.info("sink hello");

    expect(received).toEqual([{ level: "info", message: "sink hello" }]);
  });

  test("_resetLoggerForTesting 会清空注入的 log event sink", () => {
    const received: Array<{ level: string; message: string }> = [];
    loggerModule._setLogEventSinkForTesting((entry) => {
      received.push(entry);
    });

    loggerModule._resetLoggerForTesting();

    const log = loggerModule.createLogger("sink-reset-test");
    log.info("after reset");

    expect(received).toEqual([]);
  });
});
