/**
 * 运行时执行测试。
 *
 * 测试目标:
 *   - 验证 runtime exec(外部命令执行)工具的行为
 *
 * 测试用例:
 *   - 合法命令的成功执行
 *   - 超时与取消的处理
 *   - 临时目录与 cwd 的清理
 */
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

import { defineTool } from "@/tool/types";
import { clearToolsCache, registerTool, unregisterTool } from "@/tool/registry/toolRegistry";
import { createBaseToolContext, executeRegisteredTool } from "@/tool/executor/runtimeExec";
import { AppEvent } from "@/bus";
import { globalBus } from "@/bus";
import { DEFAULT_CONFIG } from "@/config";
import {
  type LogAttributes,
  type MetricAttributes,
  type MiniLogger,
  type MiniMeter,
  _setTelemetryForTesting,
} from "@/monitor/telemetry/telemetry";
import { AuditLogger } from "@/security/audit/auditLogger";

interface RecordedMetric {
  kind: "counter" | "histogram" | "updown";
  name: string;
  value: number;
  attributes?: MetricAttributes;
}

interface RecordedLog {
  body: string;
  severityText?: string;
  attributes?: LogAttributes;
}

function createRecordingTelemetry(): {
  meter: MiniMeter;
  logger: MiniLogger;
  metrics: RecordedMetric[];
  logs: RecordedLog[];
} {
  const metrics: RecordedMetric[] = [];
  const logs: RecordedLog[] = [];
  const meter: MiniMeter = {
    createCounter(name) {
      return {
        add(value, attributes) {
          metrics.push({ attributes, kind: "counter", name, value });
        },
      };
    },
    createHistogram(name) {
      return {
        record(value, attributes) {
          metrics.push({ attributes, kind: "histogram", name, value });
        },
      };
    },
    createUpDownCounter(name) {
      return {
        add(value, attributes) {
          metrics.push({ attributes, kind: "updown", name, value });
        },
      };
    },
  };
  const logger: MiniLogger = {
    emit(record) {
      logs.push({ attributes: record.attributes, body: record.body, severityText: record.severityText });
    },
  };
  return { logger, logs, meter, metrics };
}

async function withTempGlobalSettings(settings: Record<string, unknown>, run: () => Promise<void>): Promise<void> {
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
  const tempConfigHome = fs.mkdtempSync(path.join(os.tmpdir(), "crab-runtime-exec-settings-"));
  const configDir = path.join(tempConfigHome, "crab");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "settings.json"), JSON.stringify(settings), "utf8");
  process.env.XDG_CONFIG_HOME = tempConfigHome;

  try {
    await run();
  } finally {
    if (originalXdgConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    }
    fs.rmSync(tempConfigHome, { force: true, recursive: true });
  }
}

describe("runtime-exec", () => {
  test("createBaseToolContext 构造稳定基础上下文", () => {
    const controller = new AbortController();
    const ctx = createBaseToolContext("ses_test", controller.signal);

    expect(ctx.sessionId).toBe("ses_test");
    expect(ctx.abortSignal).toBe(controller.signal);
    expect(ctx.messageId).toMatch(/^msg_/);
  });

  test("executeRegisteredTool 可执行已注册工具并归一化输出", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "crab-runtime-exec-"));
    const filePath = path.join(tmpDir, "data.json");
    fs.writeFileSync(filePath, '{"a":1}', "utf8");

    const result = await executeRegisteredTool(
      "format",
      { path: filePath, write: false },
      createBaseToolContext("ses_exec"),
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("格式化预览");
  });

  test("executeRegisteredTool 对未知工具返回结构化错误", async () => {
    const result = await executeRegisteredTool("missing-tool", {}, createBaseToolContext("ses_exec"));

    expect(result.success).toBe(false);
    expect(result.output).toContain("未知工具");
    expect(result.error).toContain("未知工具");
  });

  test("executeRegisteredTool success path keeps ToolExecutor telemetry and audit logs", async () => {
    const recording = createRecordingTelemetry();
    const auditLogger = new AuditLogger("test-app", { maxEntries: 100, persistToFile: false });
    _setTelemetryForTesting({ logger: recording.logger, meter: recording.meter });
    (globalThis as { __test_auditLogger?: AuditLogger | null }).__test_auditLogger = auditLogger;

    const tool = defineTool({
      description: "Runtime telemetry success parity",
      execute: async (args) => args.msg,
      name: "runtime_exec_observable_success",
      parameters: z.object({ msg: z.string() }),
      permission: "test",
    });
    registerTool(tool);

    try {
      const result = await executeRegisteredTool(
        "runtime_exec_observable_success",
        { msg: "ok" },
        createBaseToolContext("ses_exec"),
        {
          getConfig: () => ({
            ...DEFAULT_CONFIG,
            permissions: [{ action: "allow", pattern: "*", permission: "*" }],
          }),
        },
      );

      expect(result.success).toBe(true);
      expect(recording.metrics).toContainEqual(
        expect.objectContaining({
          attributes: expect.objectContaining({
            exit_reason: "success",
            status: "success",
            tool_name: "runtime_exec_observable_success",
          }),
          kind: "counter",
          name: "tool.calls",
          value: 1,
        }),
      );
      expect(recording.logs).toContainEqual(
        expect.objectContaining({
          attributes: expect.objectContaining({
            status: "success",
            tool_name: "runtime_exec_observable_success",
          }),
          body: "tool.call",
          severityText: "INFO",
        }),
      );
      expect(auditLogger.getRecent(10)).toContainEqual(
        expect.objectContaining({
          action: "tool.executed:runtime_exec_observable_success",
        }),
      );
    } finally {
      _setTelemetryForTesting({ logger: null, meter: null });
      (globalThis as { __test_auditLogger?: AuditLogger | null }).__test_auditLogger = null;
      unregisterTool("runtime_exec_observable_success");
      clearToolsCache();
    }
  });

  test("executeRegisteredTool 缺失工具仍然记录 ToolExecutor 遥测与审计", async () => {
    const recording = createRecordingTelemetry();
    const auditLogger = new AuditLogger("test-app", { maxEntries: 100, persistToFile: false });
    _setTelemetryForTesting({ logger: recording.logger, meter: recording.meter });
    (globalThis as { __test_auditLogger?: AuditLogger | null }).__test_auditLogger = auditLogger;

    try {
      const result = await executeRegisteredTool("missing-tool", {}, createBaseToolContext("ses_exec"));

      expect(result.success).toBe(false);
      expect(result.output).toContain("未知工具");
      expect(recording.metrics).toContainEqual(
        expect.objectContaining({
          attributes: expect.objectContaining({
            exit_reason: "not_found",
            status: "error",
            tool_name: "missing-tool",
          }),
          kind: "counter",
          name: "tool.calls",
          value: 1,
        }),
      );
      expect(recording.logs).toContainEqual(
        expect.objectContaining({
          attributes: expect.objectContaining({
            status: "error",
            tool_name: "missing-tool",
          }),
          body: "tool.call",
          severityText: "ERROR",
        }),
      );
      expect(auditLogger.getRecent(10)).toContainEqual(
        expect.objectContaining({
          action: "tool.not_found:missing-tool",
        }),
      );
    } finally {
      _setTelemetryForTesting({ logger: null, meter: null });
      (globalThis as { __test_auditLogger?: AuditLogger | null }).__test_auditLogger = null;
      clearToolsCache();
    }
  });

  test("executeRegisteredTool permission deny keeps telemetry and authorization audit", async () => {
    const recording = createRecordingTelemetry();
    const auditLogger = new AuditLogger("test-app", { maxEntries: 100, persistToFile: false });
    _setTelemetryForTesting({ logger: recording.logger, meter: recording.meter });
    (globalThis as { __test_auditLogger?: AuditLogger | null }).__test_auditLogger = auditLogger;

    const tool = defineTool({
      description: "Runtime permission deny parity",
      execute: async () => "should not run",
      name: "runtime_exec_permission_denied",
      parameters: z.object({}),
      permission: "runtime.deny",
    });
    registerTool(tool);

    try {
      const result = await executeRegisteredTool(
        "runtime_exec_permission_denied",
        {},
        createBaseToolContext("ses_exec"),
        {
          getConfig: () => ({
            ...DEFAULT_CONFIG,
            permissions: [{ action: "deny", pattern: "*", permission: "runtime.deny" }],
          }),
        },
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Permission denied");
      expect(recording.metrics).toContainEqual(
        expect.objectContaining({
          attributes: expect.objectContaining({
            exit_reason: "permission_denied",
            status: "error",
            tool_name: "runtime_exec_permission_denied",
          }),
          kind: "counter",
          name: "tool.calls",
          value: 1,
        }),
      );
      expect(recording.logs).toContainEqual(
        expect.objectContaining({
          attributes: expect.objectContaining({
            exit_reason: "permission_denied",
            status: "error",
            tool_name: "runtime_exec_permission_denied",
          }),
          body: "tool.call",
          severityText: "ERROR",
        }),
      );
      expect(auditLogger.getRecent(10)).toContainEqual(
        expect.objectContaining({
          action: "denied:runtime_exec_permission_denied",
          eventType: "authorization",
        }),
      );
    } finally {
      _setTelemetryForTesting({ logger: null, meter: null });
      (globalThis as { __test_auditLogger?: AuditLogger | null }).__test_auditLogger = null;
      unregisterTool("runtime_exec_permission_denied");
      clearToolsCache();
    }
  });

  test("executeRegisteredTool 敏感拒绝保留遥测与安全审计", async () => {
    const recording = createRecordingTelemetry();
    const auditLogger = new AuditLogger("test-app", { maxEntries: 100, persistToFile: false });
    _setTelemetryForTesting({ logger: recording.logger, meter: recording.meter });
    (globalThis as { __test_auditLogger?: AuditLogger | null }).__test_auditLogger = auditLogger;

    const tool = defineTool({
      description: "Runtime sensitive reject parity",
      execute: async () => "should not run",
      name: "bash",
      parameters: z.object({ command: z.string() }),
      permission: "bash",
    });
    registerTool(tool);

    try {
      const result = await executeRegisteredTool(
        "bash",
        { command: "rm -rf build" },
        createBaseToolContext("ses_exec"),
        {
          askPermission: async (_toolName, args) => !("__sensitive" in args),
          getConfig: () => ({
            ...DEFAULT_CONFIG,
            permissions: [{ action: "allow", pattern: "*", permission: "bash" }],
          }),
        },
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("sensitive command");
      expect(recording.metrics).toContainEqual(
        expect.objectContaining({
          attributes: expect.objectContaining({
            exit_reason: "sensitive_rejected",
            status: "error",
            tool_name: "bash",
          }),
          kind: "counter",
          name: "tool.calls",
          value: 1,
        }),
      );
      expect(auditLogger.getRecent(10)).toContainEqual(
        expect.objectContaining({
          action: "sensitive_command:bash",
          eventType: "security_event",
        }),
      );
      expect(auditLogger.getRecent(10)).toContainEqual(
        expect.objectContaining({
          action: "sensitive_rejected:bash",
          eventType: "authorization",
        }),
      );
    } finally {
      _setTelemetryForTesting({ logger: null, meter: null });
      (globalThis as { __test_auditLogger?: AuditLogger | null }).__test_auditLogger = null;
      unregisterTool("bash");
      clearToolsCache();
    }
  });

  test("executeRegisteredTool validation failure keeps telemetry and audit trail", async () => {
    const recording = createRecordingTelemetry();
    const auditLogger = new AuditLogger("test-app", { maxEntries: 100, persistToFile: false });
    _setTelemetryForTesting({ logger: recording.logger, meter: recording.meter });
    (globalThis as { __test_auditLogger?: AuditLogger | null }).__test_auditLogger = auditLogger;

    const tool = defineTool({
      description: "Runtime validation parity",
      execute: async () => "should not run",
      name: "runtime_exec_validation_failed",
      parameters: z.object({ count: z.number().int() }),
      permission: "test",
    });
    registerTool(tool);

    try {
      const result = await executeRegisteredTool(
        "runtime_exec_validation_failed",
        { count: "bad" as unknown as number },
        createBaseToolContext("ses_exec"),
        {
          getConfig: () => ({
            ...DEFAULT_CONFIG,
            permissions: [{ action: "allow", pattern: "*", permission: "*" }],
          }),
        },
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Parameter validation failed");
      expect(recording.metrics).toContainEqual(
        expect.objectContaining({
          attributes: expect.objectContaining({
            exit_reason: "validation_failed",
            status: "error",
            tool_name: "runtime_exec_validation_failed",
          }),
          kind: "counter",
          name: "tool.calls",
          value: 1,
        }),
      );
      expect(recording.logs).toContainEqual(
        expect.objectContaining({
          attributes: expect.objectContaining({
            exit_reason: "validation_failed",
            status: "error",
            tool_name: "runtime_exec_validation_failed",
          }),
          body: "tool.call",
          severityText: "ERROR",
        }),
      );
      expect(auditLogger.getRecent(10)).toContainEqual(
        expect.objectContaining({
          action: "validation_failed:runtime_exec_validation_failed",
        }),
      );
    } finally {
      _setTelemetryForTesting({ logger: null, meter: null });
      (globalThis as { __test_auditLogger?: AuditLogger | null }).__test_auditLogger = null;
      unregisterTool("runtime_exec_validation_failed");
      clearToolsCache();
    }
  });

  test("executeRegisteredTool 拦截已禁用 MCP 工具", async () => {
    await withTempGlobalSettings({ disabledMCPTools: ["apifox:runtime_blocked"] }, async () => {
      let didExecute = false;
      const tool = defineTool({
        description: "Disabled MCP runtime guard",
        execute: async () => {
          didExecute = true;
          return "should not run";
        },
        name: "apifox_runtime_blocked",
        parameters: z.object({}),
        permission: "mcp.apifox.runtime_blocked",
      });
      registerTool(tool);

      try {
        const result = await executeRegisteredTool("apifox_runtime_blocked", {}, createBaseToolContext("ses_exec"));

        expect(result.success).toBe(false);
        expect(result.error).toContain("disabled by settings");
        expect(didExecute).toBe(false);
      } finally {
        unregisterTool("apifox_runtime_blocked");
        clearToolsCache();
      }
    });
  });

  test("executeRegisteredTool inherits hard-deny permission policy from ToolExecutor", async () => {
    const tool = defineTool({
      description: "Runtime hard deny parity",
      execute: async () => "should not run",
      name: "runtime_exec_hard_deny",
      parameters: z.object({ command: z.string() }),
      permission: "bash",
    });
    registerTool(tool);

    try {
      const result = await executeRegisteredTool(
        "runtime_exec_hard_deny",
        { command: "sudo whoami" },
        createBaseToolContext("ses_exec"),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Permission denied");
      expect(result.output).toContain("Permission denied");
    } finally {
      unregisterTool("runtime_exec_hard_deny");
      clearToolsCache();
    }
  });

  test("executeRegisteredTool 应用 ToolExecutor 输出截断", async () => {
    const tool = defineTool({
      description: "Runtime truncation parity",
      execute: async () => "x".repeat(400_000),
      name: "runtime_exec_large_output",
      parameters: z.object({}),
      permission: "fs.read",
    });
    registerTool(tool);

    try {
      const result = await executeRegisteredTool("runtime_exec_large_output", {}, createBaseToolContext("ses_exec"));

      expect(result.success).toBe(true);
      expect(result.output.length).toBeLessThan(400_000);
      expect(result.output).toContain("Output truncated");
    } finally {
      unregisterTool("runtime_exec_large_output");
      clearToolsCache();
    }
  });

  test("executeRegisteredTool allows callers to preserve ask rejection semantics", async () => {
    const tool = defineTool({
      description: "Runtime ask parity",
      execute: async () => "should not run",
      name: "runtime_exec_user_reject",
      parameters: z.object({}),
      permission: "runtime.ask",
    });
    registerTool(tool);

    try {
      const result = await executeRegisteredTool("runtime_exec_user_reject", {}, createBaseToolContext("ses_exec"), {
        askPermission: async () => false,
        getConfig: () => ({ ...DEFAULT_CONFIG, permissions: [] }),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('user rejected tool "runtime_exec_user_reject"');
      expect(result.output).toContain('user rejected tool "runtime_exec_user_reject"');
    } finally {
      unregisterTool("runtime_exec_user_reject");
      clearToolsCache();
    }
  });

  test("executeRegisteredTool 转发默认超时覆盖至 ToolExecutor", async () => {
    const tool = defineTool({
      description: "Runtime timeout parity",
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return "too late";
      },
      name: "runtime_exec_timeout_override",
      parameters: z.object({}),
      permission: "fs.read",
    });
    registerTool(tool);

    try {
      const result = await executeRegisteredTool(
        "runtime_exec_timeout_override",
        {},
        createBaseToolContext("ses_exec"),
        {
          defaultTimeout: 10,
          getConfig: () => ({
            ...DEFAULT_CONFIG,
            permissions: [{ action: "allow", pattern: "*", permission: "*" }],
          }),
        },
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("timed out after 10ms");
      expect(result.output).toContain("timed out after 10ms");
    } finally {
      unregisterTool("runtime_exec_timeout_override");
      clearToolsCache();
    }
  });

  test("executeRegisteredTool preserves per-tool timeout events with runtime context", async () => {
    const toolName = "runtime_exec_per_tool_timeout";
    const receivedTimeouts: {
      toolName: string;
      timeoutMs: number;
      sessionId?: string;
      messageId?: string;
    }[] = [];
    const unsub = globalBus.subscribe(AppEvent.ToolTimeout, (event) => {
      receivedTimeouts.push(event.properties);
    });
    const context = createBaseToolContext("ses_runtime_timeout");

    const tool = defineTool({
      description: "Runtime per-tool timeout parity",
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return "too late";
      },
      name: toolName,
      parameters: z.object({}),
      permission: "fs.read",
      timeoutMs: 15,
    });
    registerTool(tool);

    try {
      const result = await executeRegisteredTool(toolName, {}, context, {
        defaultTimeout: 1000,
        getConfig: () => ({
          ...DEFAULT_CONFIG,
          permissions: [{ action: "allow", pattern: "*", permission: "*" }],
        }),
      });
      await globalBus.flush();

      expect(result.success).toBe(false);
      expect(result.error).toContain(`Tool "${toolName}" timed out after 15ms`);
      expect(receivedTimeouts).toContainEqual(
        expect.objectContaining({
          messageId: context.messageId,
          sessionId: "ses_runtime_timeout",
          timeoutMs: 15,
          toolName,
        }),
      );
    } finally {
      unsub();
      unregisterTool(toolName);
      clearToolsCache();
    }
  });
});
