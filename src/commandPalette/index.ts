/**
 * CommandPalette 模块 — 值导出入口。
 *
 * 职责:
 *   - 命令注册表管理（CommandRegistry）
 *   - 应用命令创建工厂（createAppCommands）
 *   - 命令类型定义接口
 *
 * 类型定义请使用 `@commandPalette/type`（type.ts）。
 * 所有外部模块应通过 `@commandPalette` 统一入口引用值。
 */

// ─── 类型导出（通过 type.ts 引入）────────────────────────────
// 注意：类型定义请通过 @commandPalette/type 引入
// import type { Command, CommandRegistry, CommandDeps } from "@/commandPalette/type";

// ─── 核心功能 ──────────────────────────────────────────
export { getCommandRegistry } from "./registry";
export { createAppCommands } from "./appCommands";

// ─── 共享工具 ────────────────────────────────────────────
export { getAppConfig, getErrorMessage, showErrorToast } from "./shared";
export type { CommandDeps } from "./shared";
