/**
 * CLI 模块 — 命令行界面值导出入口。
 *
 * 职责:
 *   - CLI 参数解析与命令路由
 *   - TUI / 无头 / SSE / ACP / 任务等多种运行模式
 *   - 进程生命周期管理（信号处理 + 优雅关闭）
 *   - 统一的 CLI 错误处理
 *
 * 类型定义请使用 `@cli/type`（type.ts）。
 * 所有外部模块应通过 `@cli` 统一入口引用值。
 */

// ─── 错误处理 ──────────────────────────────────────────
export { createCliError, writeCliError, getCliErrorMessage, formatCliError, exitWithError } from "./errors";

// ─── 帮助文本 ──────────────────────────────────────────
export { getHelpText, printHelp } from "./help";

// ─── 核心编排 ──────────────────────────────────────────
export {
  // 编排器
  parseCliArgs,
  executeMode,
  // 生命周期
  installSignalHandlers,
  shutdown,
  setOrchestratorDeps,
  getOrchestratorDeps,
  __resetLifecycleForTest,
  // TUI 运行器
  runTui,
} from "./core";
