/**
 * IDE 诊断模块单元测试
 */
import { afterAll, describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ── 模块级 mock ───────────────────────────────────────────

const mockIsConnected = mock(() => false);
const mockRequestDiagnostics = mock(() =>
  Promise.resolve([
    {
      character: 10,
      code: "TS2322",
      line: 5,
      message: "Type 'string' is not assignable to type 'number'",
      severity: "error",
      source: "typescript",
    },
    {
      character: 0,
      code: "TS6133",
      line: 2,
      message: "'unused' is declared but its value is never read",
      severity: "warning",
      source: "typescript",
    },
  ]),
);
const mockExec = mock(() =>
  Promise.resolve({
    exitCode: 0,
    stderr: "",
    stdout: `src/index.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'\nsrc/index.ts(15,3): warning TS6133: 'x' is declared but its value is never read\n`,
  }),
);

mock.module("@/ide/client", () => ({
  vscodeConnection: {
    isConnected: mockIsConnected,
    requestDiagnostics: mockRequestDiagnostics,
  },
}));

mock.module("@/bus", () => ({
  exec: mockExec,
  globalBus: {
    emit: () => {},
    on: () => () => {},
    off: () => {},
  },
  AppEvent: {},
  EventBus: {},
}));

// ── 导入目标模块 ──────────────────────────────────────────

import { ideDiagnosticsTool } from "@/tool/ideDiagnostics";

describe("ideDiagnostics 工具定义", () => {
  afterAll(() => {
    mock.restore();
  });
  // ── 工具元数据验证 ─────────────────────────────────────

  it("工具名称为 ide-diagnostics", () => {
    expect(ideDiagnosticsTool.name).toBe("ide-diagnostics");
  });

  it("权限标识为 fs.read", () => {
    expect(ideDiagnosticsTool.permission).toBe("fs.read");
  });

  it("描述包含诊断相关信息", () => {
    expect(ideDiagnosticsTool.description).toContain("诊断");
    expect(ideDiagnosticsTool.description).toContain("VSCode");
    expect(ideDiagnosticsTool.description).toContain("tsc");
    expect(ideDiagnosticsTool.description).toContain("eslint");
  });

  // ── 参数 Schema 验证 ─────────────────────────────────

  it("参数 schema 接受空对象(使用默认值)", () => {
    const result = ideDiagnosticsTool.parameters.safeParse({});
    expect(result.success).toBe(true);
  });

  it("参数 schema 接受 path 参数", () => {
    const result = ideDiagnosticsTool.parameters.safeParse({ path: "/src/index.ts" });
    expect(result.success).toBe(true);
  });

  it("参数 schema 接受 type=all", () => {
    const result = ideDiagnosticsTool.parameters.safeParse({ type: "all" });
    expect(result.success).toBe(true);
  });

  it("参数 schema 接受 type=errors", () => {
    const result = ideDiagnosticsTool.parameters.safeParse({ type: "errors" });
    expect(result.success).toBe(true);
  });

  it("参数 schema 接受 type=warnings", () => {
    const result = ideDiagnosticsTool.parameters.safeParse({ type: "warnings" });
    expect(result.success).toBe(true);
  });

  it("参数 schema 接受 maxResults", () => {
    const result = ideDiagnosticsTool.parameters.safeParse({ maxResults: 10 });
    expect(result.success).toBe(true);
  });

  it("参数 schema 拒绝无效的 type 值", () => {
    const result = ideDiagnosticsTool.parameters.safeParse({ type: "invalid" });
    expect(result.success).toBe(false);
  });

  it("参数 schema 接受所有参数组合", () => {
    const result = ideDiagnosticsTool.parameters.safeParse({
      path: "/src/index.ts",
      type: "errors",
      maxResults: 5,
    });
    expect(result.success).toBe(true);
  });

  // ── 执行：VSCode 未连接时回退到 tsc ────────────────────

  it("VSCode 未连接时尝试 tsc 回退策略", async () => {
    mockIsConnected.mockReturnValue(false);
    const result = (await ideDiagnosticsTool.execute({})) as any;
    expect(result.success).toBe(true);
    expect(result.path).toBeDefined();
    expect(result.diagnostics).toBeInstanceOf(Array);
  });

  // ── 执行：tsc 返回诊断结果 ─────────────────────────────

  it("tsc 输出被正确解析为诊断列表", async () => {
    mockIsConnected.mockReturnValue(false);
    mockExec.mockReturnValue(
      Promise.resolve({
        exitCode: 0,
        stderr: "",
        stdout: `src/index.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'\nsrc/utils.ts(3,1): warning TS6133: 'unused' is declared but its value is never read\n`,
      }),
    );

    const result = (await ideDiagnosticsTool.execute({
      path: "/fake/project",
      type: "all",
    })) as any;

    expect(result.success).toBe(true);
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
    // 验证解析的格式
    const diag = result.diagnostics[0];
    expect(diag.file).toBeDefined();
    expect(diag.line).toBeDefined();
    expect(diag.severity).toBeDefined();
    expect(diag.message).toBeDefined();
  });

  // ── 执行：按类型过滤 ───────────────────────────────────

  it("type=errors 只返回错误级别诊断", async () => {
    mockIsConnected.mockReturnValue(false);
    mockExec.mockReturnValue(
      Promise.resolve({
        exitCode: 0,
        stderr: "",
        stdout: `src/index.ts(10,5): error TS2322: Type error\nsrc/index.ts(15,3): warning TS6133: Unused var\n`,
      }),
    );

    const result = (await ideDiagnosticsTool.execute({
      path: "/fake/project",
      type: "errors",
    })) as any;

    expect(result.success).toBe(true);
    for (const d of result.diagnostics) {
      expect(d.severity).toBe("error");
    }
  });

  it("type=warnings 只返回警告级别诊断", async () => {
    mockIsConnected.mockReturnValue(false);
    mockExec.mockReturnValue(
      Promise.resolve({
        exitCode: 0,
        stderr: "",
        stdout: `src/index.ts(10,5): error TS2322: Type error\nsrc/index.ts(15,3): warning TS6133: Unused var\n`,
      }),
    );

    const result = (await ideDiagnosticsTool.execute({
      path: "/fake/project",
      type: "warnings",
    })) as any;

    expect(result.success).toBe(true);
    for (const d of result.diagnostics) {
      expect(d.severity).toBe("warning");
    }
  });

  // ── 执行：maxResults 限制 ──────────────────────────────

  it("maxResults 限制返回的诊断数量", async () => {
    mockIsConnected.mockReturnValue(false);
    // 生成多条诊断
    const lines = Array.from({ length: 20 }, (_, i) => `src/f${i}.ts(${i + 1},1): error TS000${i}: Error ${i}`).join(
      "\n",
    );
    mockExec.mockReturnValue(Promise.resolve({ exitCode: 0, stderr: "", stdout: lines }));

    const result = (await ideDiagnosticsTool.execute({
      path: "/fake/project",
      type: "errors",
      maxResults: 5,
    })) as any;

    expect(result.success).toBe(true);
    expect(result.diagnostics.length).toBeLessThanOrEqual(5);
  });
});
