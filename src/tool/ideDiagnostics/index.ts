/**
 * IDE 诊断工具 — 获取文件的编译错误、警告和 lint 诊断。
 *
 * 职责:
 *   - 获取文件编译错误
 *   - 获取警告信息
 *   - 获取 lint 诊断
 *   - 多层级诊断获取策略
 *
 * 模块功能:
 *   - ideDiagnosticsTool: IDE 诊断工具定义
 *   - VSCode WebSocket 实时诊断
 *   - TypeScript Compiler 诊断
 *   - ESLint CLI 诊断
 *
 * 使用场景:
 *   - AI 需要了解代码问题
 *   - 检查编译错误
 *   - 代码质量检查
 *   - 获取 lint 警告
 *
 * 边界:
 *   1. 权限:fs.read
 *   2. 三层回退策略:
 *      - 优先 VSCode WebSocket 实时诊断
 *      - 回退到 TypeScript Compiler (tsc --noEmit)
 *      - 最终回退到 ESLint CLI
 *   3. VSCode 连接时优先使用实时诊断
 *   4. 支持按类型过滤(errors/warnings/all)
 *   5. 默认最大返回 50 条诊断
 *
 * 流程:
 *   1. 接收检查路径和类型
 *   2. 尝试 VSCode WebSocket
 *   3. 失败时回退到 tsc
 *   4. 最终回退到 ESLint
 *   5. 返回诊断列表
 */
import { z } from "zod";
import { defineTool } from "@/tool/types";
import { createLogger } from "@/core/logging/logger";
import { vscodeConnection } from "@/ide/client";
import { globalBus, exec } from "@/bus";
import { AppEvent } from "@/bus";
import fs from "node:fs";
import path from "node:path";

const log = createLogger("tool:ide-diagnostics");

/** IDE 诊断工具：获取文件或项目的编译错误、警告、lint 问题 */
export const ideDiagnosticsTool = defineTool({
  description:
    "获取文件或项目的诊断信息(编译错误、警告、lint 问题)。" +
    "优先从 VSCode 获取实时诊断，回退到 TypeScript 编译检查和 ESLint 检查。" +
    "回退策略:1. VSCode WebSocket 2. tsc --noEmit 3. eslint 4. 通用检查。",
  execute: async ({ path: checkPath, type, maxResults }) => {
    const cwd = checkPath ?? process.cwd();
    const filter = type ?? "all";
    const limit = maxResults ?? 50;

    try {
      // ── 策略 1: VSCode WebSocket 实时诊断 ──
      if (vscodeConnection.isConnected()) {
        const vscodeDiags = await tryVscodeDiagnostics(cwd, filter, limit);
        if (vscodeDiags && vscodeDiags.diagnostics.length > 0) {
          return vscodeDiags;
        }
        // VSCode 连接可用但无诊断 → 直接返回空(信任 VSCode 的结果)
        if (vscodeDiags !== null) {
          return vscodeDiags;
        }
        // VscodeDiags === null 表示请求失败，继续回退
      }

      // ── 策略 2: TypeScript 编译检查 ──
      const tscResult = await tryTscCheck(cwd, filter, limit);
      if (tscResult && tscResult.diagnostics.length > 0) {
        return tscResult;
      }

      // ── 策略 3: ESLint ──
      const eslintResult = await tryEslintCheck(cwd, filter, limit);
      if (eslintResult && eslintResult.diagnostics.length > 0) {
        return eslintResult;
      }

      // 没有诊断或工具不可用
      return {
        diagnostics: [],
        filter,
        message: "没有发现诊断问题，或检查工具(tsc/eslint)不可用。",
        path: cwd,
        success: true,
        total: 0,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error(`诊断失败: ${cwd}`, { error: msg });
      return { diagnostics: [], error: msg, path: cwd, success: false };
    }
  },
  name: "ide-diagnostics",
  parameters: z.object({
    /** 最大结果数 */
    maxResults: z.number().optional().describe("最大返回诊断数，默认 50"),
    /** 文件或目录路径 */
    path: z.string().optional().describe("要检查的文件或目录路径"),
    /** 检查类型 */
    type: z.enum(["all", "errors", "warnings"]).optional().describe("返回类型:all/errors/warnings，默认 all"),
  }),
  permission: "fs.read",
  builtin: true,
});

// ─── 策略 1: VSCode WebSocket 实时诊断 ─────────────────────────

/**
 * 通过 VSCode WebSocket 获取诊断数据。
 *
 *
 * @returns null 表示请求失败(应回退到 CLI 方式)，非 null 表示成功
 */
async function tryVscodeDiagnostics(cwd: string, filter: string, limit: number): Promise<DiagnosticsResult | null> {
  try {
    // 判断路径是文件还是目录
    let isFile = false;
    try {
      const stat = fs.statSync(cwd);
      isFile = stat.isFile();
    } catch {
      // 路径不存在，跳过
    }

    // VSCode 诊断请求需要一个文件路径(不支持目录级请求)
    // 如果是目录，尝试请求目录下的主文件(tsconfig.json 等)，或者跳过
    if (!isFile) {
      log.debug(`VSCode 诊断需要文件路径，目录跳过: ${cwd}`);
      // 对目录级请求，回退到 CLI tsc/eslint
      return null;
    }

    const diagnostics = await vscodeConnection.requestDiagnostics(cwd);

    // 发布 IDEDiagnostics 事件
    globalBus.publish(AppEvent.IDEDiagnostics, {
      diagnostics: diagnostics.map((d) => ({
        character: d.character,
        line: d.line,
        message: d.message,
        severity: d.severity,
        source: d.source,
      })),
      filePath: cwd,
    });

    // 格式化 VSCode 诊断为统一格式
    const formatted: Diagnostic[] = [];
    for (const d of diagnostics) {
      if (formatted.length >= limit) {
        break;
      }
      if (filter === "errors" && d.severity !== "error") {
        continue;
      }
      if (filter === "warnings" && d.severity !== "warning") {
        continue;
      }

      formatted.push({
        code: d.code != null ? String(d.code) : "unknown",
        column: d.character + 1,
        file: cwd,
        line: d.line + 1, // VSCode 诊断是 0-based，转为 1-based
        message: d.message,
        severity: d.severity === "error" || d.severity === "warning" ? d.severity : "warning",
      });
    }

    return {
      diagnostics: formatted,
      engine: "vscode",
      filter,
      message: formatted.length > 0 ? undefined : `VSCode 报告: ${cwd} 无诊断问题`,
      path: cwd,
      success: true,
      total: formatted.length,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.debug(`VSCode 诊断请求失败，回退到 CLI: ${msg}`);
    return null;
  }
}

// ─── 统一诊断格式 ──────────────────────────────────────────────

interface Diagnostic {
  file: string;
  line: number;
  column?: number;
  severity: "error" | "warning";
  code: string;
  message: string;
}

/** 诊断工具返回结构 */
interface DiagnosticsResult {
  success: boolean;
  path: string;
  engine?: string;
  diagnostics: Diagnostic[];
  total: number;
  filter?: string;
  message?: string;
  error?: string;
}

// ─── 策略 2: TypeScript 编译检查 ───────────────────────────────

/** 查找可用的命令执行器(优先 bunx，回退 npx) */
function resolveRunner(): string {
  // 检测 bunx
  try {
    const result = Bun.spawnSync(["bunx", "--version"], { stderr: "ignore", stdout: "ignore" });
    if (result.exitCode === 0) {
      return "bunx";
    }
  } catch {
    /* Not available */
  }

  // 回退到 npx
  try {
    const result = Bun.spawnSync(["npx", "--version"], { stderr: "ignore", stdout: "ignore" });
    if (result.exitCode === 0) {
      return "npx";
    }
  } catch {
    /* Not available */
  }

  return "npx"; // 默认值，执行时如不可用会返回错误
}

/** 缓存 runner 检测结果 */
let cachedRunner: string | null = null;
function getRunner(): string {
  if (cachedRunner === null) {
    cachedRunner = resolveRunner();
  }
  return cachedRunner;
}

async function tryTscCheck(cwd: string, filter: string, limit: number): Promise<DiagnosticsResult | null> {
  try {
    // 优先使用项目本地 tsc，回退到全局
    const localTsc = path.join(cwd, "node_modules", ".bin", "tsc");
    const tscCmd = fs.existsSync(localTsc) ? localTsc : `${getRunner()} tsc`;

    const result = await exec(
      tscCmd === localTsc
        ? [localTsc, "--noEmit", "--pretty", "false"]
        : [getRunner(), "tsc", "--noEmit", "--pretty", "false"],
      { cwd, timeout: 30_000 },
    );

    const diagnostics = parseTscOutput(result.stdout, filter, limit);
    return {
      diagnostics,
      engine: "tsc",
      path: cwd,
      success: true,
      total: diagnostics.length,
    };
  } catch {
    return null;
  }
}

async function tryEslintCheck(cwd: string, filter: string, limit: number): Promise<DiagnosticsResult | null> {
  try {
    const localEslint = path.join(cwd, "node_modules", ".bin", "eslint");
    const eslintCmd = fs.existsSync(localEslint) ? localEslint : `${getRunner()} eslint`;

    const result = await exec(
      eslintCmd === localEslint
        ? [localEslint, "--format", "json", cwd]
        : [getRunner(), "eslint", "--format", "json", cwd],
      { cwd, timeout: 30_000 },
    );

    const diagnostics = parseEslintOutput(result.stdout, filter, limit);
    return {
      diagnostics,
      engine: "eslint",
      path: cwd,
      success: true,
      total: diagnostics.length,
    };
  } catch {
    return null;
  }
}

function parseTscOutput(output: string, filter: string, limit: number): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lines = output.split("\n");

  for (const line of lines) {
    if (diagnostics.length >= limit) {
      break;
    }
    // Tsc 格式: file(line,col): severity TSxxxx: message
    const match = line.match(/^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/);
    if (match) {
      const severity = match[4] === "error" || match[4] === "warning" ? match[4] : undefined;
      if (!severity) continue;
      if (filter === "errors" && severity !== "error") {
        continue;
      }
      if (filter === "warnings" && severity !== "warning") {
        continue;
      }

      diagnostics.push({
        code: match[5]!,
        column: parseInt(match[3]!, 10),
        file: match[1]!,
        line: parseInt(match[2]!, 10),
        message: match[6]!,
        severity,
      });
    }
  }

  return diagnostics;
}

function parseEslintOutput(output: string, filter: string, limit: number): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  try {
    const data = JSON.parse(output);
    const files = Array.isArray(data) ? data : [];

    for (const fileEntry of files) {
      if (diagnostics.length >= limit) {
        break;
      }
      const filePath = fileEntry.filePath as string;
      const messages: Array<{ column?: number; line?: number; message?: string; ruleId?: string; severity?: number }> =
        fileEntry.messages ?? [];

      for (const msg of messages) {
        if (diagnostics.length >= limit) {
          break;
        }
        const severity = msg.severity === 2 ? "error" : "warning";
        if (filter === "errors" && severity !== "error") {
          continue;
        }
        if (filter === "warnings" && severity !== "warning") {
          continue;
        }

        diagnostics.push({
          code: msg.ruleId ?? "unknown",
          column: msg.column,
          file: filePath,
          line: msg.line ?? 0,
          message: msg.message ?? "",
          severity,
        });
      }
    }
  } catch {
    /* Not valid JSON */
  }

  return diagnostics;
}
