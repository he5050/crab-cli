/**
 * CLI 编排器 — 参数解析与命令路由。
 *
 * 职责:
 *   - 解析命令行参数
 *   - 验证参数互斥约束
 *   - 路由到对应的命令处理器
 */

import { parseArgs } from "node:util";
import { VERSION } from "@/config/version";
import { getInstallationChannelLabel } from "@/core/installationChannel";
import { exitWithError } from "../errors";
import type { ParsedCliArgs } from "../type";
import { getOrchestratorDeps } from "./lifecycle";
import { getCommand } from "./commandRegistry";
import { printHelp } from "../help";
import { parseSsePort, SsePortError } from "../../server/sseModes";

/**
 * 安全的动态导入包装器 — 捕获模块加载失败并返回友好错误。
 */
export async function safeImport<T>(importFn: () => Promise<T>, moduleName: string): Promise<T> {
  try {
    return await importFn();
  } catch (error) {
    exitWithError("internal", `无法加载模块: ${moduleName}`, {
      module: moduleName,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * 验证 CLI 参数的互斥约束与数值合法性。
 * 收集所有违规，一次性报告全部错误，避免用户反复试错。
 */
export function validateCliArgs(parsed: ParsedCliArgs): void {
  const { values: v } = parsed;
  const errors: string[] = [];

  // ─── 互斥约束 ──────────────────────────────────────────

  if (v.sse === true && v.acp === true) {
    errors.push("--sse 和 --acp 不能同时使用，请选择其中一种服务器模式");
  }
  if (v.task && v.ask) {
    errors.push("--task 和 --ask 不能同时使用，请选择其中一种执行模式");
  }
  if (v.sse === true && v["sse-daemon"] === true) {
    errors.push("--sse 和 --sse-daemon 不能同时使用，请选择前台或后台模式");
  }
  if (v.task && v["task-execute"]) {
    errors.push("--task 和 --task-execute 不能同时使用");
  }
  if (v.ask && v["task-execute"]) {
    errors.push("--ask 和 --task-execute 不能同时使用");
  }

  // ─── 数值范围校验 ──────────────────────────────────────

  if (v.timeout !== undefined) {
    const timeoutMs = Number(v.timeout);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      errors.push(`--timeout 必须为正整数，当前值: ${v.timeout}`);
    }
  }
  if (v["max-tool-rounds"] !== undefined) {
    const rounds = Number(v["max-tool-rounds"]);
    if (!Number.isFinite(rounds) || rounds <= 0 || !Number.isInteger(rounds)) {
      errors.push(`--max-tool-rounds 必须为正整数，当前值: ${v["max-tool-rounds"]}`);
    }
  }

  // ─── 语义重叠警告（不阻止，仅 console.warn）─────────

  if (v.yolo === true && v["c-yolo"] === true) {
    console.warn("⚠️  警告: --yolo 和 --c-yolo 同时使用，--c-yolo 将优先生效");
  }

  // ─── 一次性报告 ──────────────────────────────────────

  if (errors.length > 0) {
    exitWithError(
      "invalid-parameter",
      errors.length === 1
        ? errors[0]!
        : `参数校验失败（${errors.length} 个错误）:\n${errors.map((e, i) => `  ${i + 1}. ${e}`).join("\n")}`,
    );
  }
}

/**
 * 解析 CLI 参数
 */
export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      ask: { type: "string" },
      sse: { type: "boolean" },
      "sse-daemon": { type: "boolean" },
      "sse-stop": { type: "boolean" },
      "sse-status": { type: "boolean" },
      "sse-port": { type: "string" },
      all: { type: "boolean" },
      acp: { type: "boolean" },
      task: { type: "string" },
      "task-execute": { type: "string" },
      "task-list": { type: "boolean" },
      "task-status": { type: "string" },
      continue: { type: "string" },
      plan: { type: "boolean" },
      "c-yolo": { type: "boolean" },
      yolo: { type: "boolean" },
      "yolo-p": { type: "boolean" },
      dev: { type: "boolean" },
      update: { type: "boolean" },
      schedule: { type: "string" },
      version: { type: "boolean" },
      help: { type: "boolean" },
      "work-dir": { type: "string" },
      "max-tool-rounds": { type: "string" },
      "no-mcp": { type: "boolean" },
      timeout: { type: "string" },
      format: { type: "string" },
      output: { type: "string" },
      sanitize: { type: "boolean" },
      force: { type: "boolean" },
      "no-merge": { type: "boolean" },
    },
    strict: true,
  });

  // 确定运行模式
  let mode: ParsedCliArgs["mode"] = "tui";

  if (positionals[0] === "setup") {
    mode = "setup";
  } else if (positionals[0] === "config" && positionals[1] === "test") {
    mode = "config-test";
  } else if (positionals[0] === "config" && positionals[1] === "export") {
    mode = "config-export";
  } else if (positionals[0] === "config" && positionals[1] === "import") {
    mode = "config-import";
  } else if (positionals[0] === "mcp" && positionals[1] === "search") {
    mode = "mcp-search";
  } else if (positionals[0] === "mcp" && positionals[1] === "install") {
    mode = "mcp-install";
  } else if (positionals[0] === "agent" && positionals[1] === "generate") {
    mode = "agent-generate";
  } else if (values.help) {
    mode = "help";
  } else if (values.version) {
    mode = "version";
  } else if (values.update) {
    mode = "check-update";
  } else if (positionals[0] === "update") {
    mode = "update";
  } else if (values.schedule) {
    mode = "schedule";
  } else if (values.sse) {
    mode = "sse";
  } else if (values["sse-daemon"]) {
    mode = "sse-daemon";
  } else if (values["sse-stop"]) {
    mode = "sse-stop";
  } else if (values["sse-status"]) {
    mode = "sse-status";
  } else if (values.acp) {
    mode = "acp";
  } else if (values["task-execute"]) {
    mode = "task-worker";
  } else if (values.task) {
    mode = "task";
  } else if (values["task-list"]) {
    mode = "task-list";
  } else if (values["task-status"]) {
    mode = "task-status";
  } else if (values.ask) {
    mode = "headless";
  }

  // 处理 SSE 端口
  let ssePort: number | undefined;
  if (values["sse-port"]) {
    try {
      ssePort = parseSsePort(values["sse-port"]);
    } catch (error) {
      if (error instanceof SsePortError) {
        exitWithError("invalid-parameter", error.message, { option: "--sse-port", value: values["sse-port"] });
      }
      throw error;
    }
  }

  return {
    mode,
    positionals,
    values,
    ssePort,
    sseAll: Boolean(values.all),
  };
}

/**
 * 执行对应模式的命令
 */
export async function executeMode(parsed: ParsedCliArgs): Promise<void> {
  // 先验证参数互斥约束
  validateCliArgs(parsed);

  const deps = getOrchestratorDeps();
  if (!deps) {
    exitWithError("internal", "运行环境未初始化，请确认入口文件初始化顺序");
  }

  const { mode } = parsed;

  // 特殊处理：help 和 version 不需要依赖注入
  if (mode === "help") {
    printHelp(VERSION);
    process.exit(0);
  }

  if (mode === "version") {
    console.log(`crab v${VERSION} (${getInstallationChannelLabel()})`);
    process.exit(0);
  }

  // 查找并执行注册的命令
  const command = getCommand(mode);
  if (command) {
    // 执行前验证（如果命令定义了 validate）
    command.validate?.(parsed);
    await command.execute(parsed, deps);
    return;
  }

  exitWithError("internal", `未注册的运行模式: ${mode}`);
}
