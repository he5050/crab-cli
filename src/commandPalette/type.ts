/**
 * CommandPalette 类型 — 模块类型统一出入口。
 *
 * 所有外部模块应通过 `@commandPalette/type` 引入 commandPalette 模块的类型定义。
 * 值导出请使用 `@commandPalette`（index.ts）。
 */

// ─── 核心类型 ──────────────────────────────────────────
export type { Command, CommandRegistry } from "./types";

// ─── 共享依赖类型 ──────────────────────────────────────
export type { NavigationDeps, UIDeps, ConfigDeps, SessionDeps, EventBusDeps, CommandDeps } from "./shared";
