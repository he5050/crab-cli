/**
 * Command 模块 — 值导出入口。
 *
 * 职责:
 *   - 配置导入（从 JSON 文件导入配置）
 *   - 配置导出（导出配置为 JSON）
 *   - 配置测试（验证 Provider 连接可用性）
 *   - 交互式配置向导
 *
 * 类型定义请使用 `@command/type`（type.ts）。
 * 所有外部模块应通过 `@command` 统一入口引用值。
 */

// ─── 配置导入 ──────────────────────────────────────────
export { configImportCommand } from "./config/import";

// ─── 配置导出 ──────────────────────────────────────────
export { configExportCommand } from "./config/export";

// ─── Provider 测试 ─────────────────────────────────────
export { configTestCommand } from "./config/test";

// ─── 交互式配置 ──────────────────────────────────────
export { setupCommand } from "./config/setup";
