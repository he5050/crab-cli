/**
 * CLI Core — 核心编排逻辑统一导出。
 *
 * 本文件为 cli 模块内部子模块出入口，不直接对外暴露。
 * 外部消费者应通过 `@cli` 统一入口引用。
 */

// ─── 编排器（参数解析 + 命令路由） ──────────────────────
export { parseCliArgs, executeMode, safeImport } from "./orchestrator";

// ─── 生命周期（信号处理 + 优雅关闭） ───────────────────
export {
  installSignalHandlers,
  shutdown,
  setOrchestratorDeps,
  getOrchestratorDeps,
  __resetLifecycleForTest,
} from "./lifecycle";

// ─── TUI 运行器 ─────────────────────────────────────────
export { runTui } from "./tuiRunner";
export type { TuiRunOptions } from "./tuiRunner";

// ─── 命令注册表 ─────────────────────────────────────────
export { registerCommand, getCommand, getAllCommands, __clearCommandRegistry } from "./commandRegistry";
export type { CliCommand } from "./commandRegistry";

// ─── 注册预定义命令 ──────────────────────────────────────
import "./commands";
