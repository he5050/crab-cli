/**
 * @config 模块统一出入口。
 *
 * 本模块提供配置系统的完整 API，涵盖：
 *   - 配置加载与持久化（loader）
 *   - 路径解析（paths）
 *   - 全局常量（constants）
 *   - 设置存储（settings）
 *   - Agent 定义与管理（agents）
 *   - 主题系统（themes）
 *   - 功能开关与特性配置（features）
 *   - 类型定义与验证框架（types）
 *
 * 类型导入请使用 `@config/type`，或直接通过 `@config` 一并获取。
 *
 * 使用方式：
 *   import { loadConfig, saveConfig, DEFAULT_CONFIG } from "@/config";
 */

export type * from "./type";

// ─── 核心配置加载 ──────────────────────────────────────────
export * from "./loader/config";
export * from "./loader/atomicConfig";
export * from "./loader/configSources";
export * from "./loader/errors";

// ─── 首次运行检测 ─────────────────────────────────────────
export * from "./firstRun";

// ─── 路径解析 ─────────────────────────────────────────────
export * from "./paths/paths";
export * from "./paths/workingDir";
export { migrateDirectoryStructure } from "./paths/migrate";

// ─── 全局常量 ─────────────────────────────────────────────
export * from "./constants";

// ─── 设置管理 ─────────────────────────────────────────────
export * from "./settings/unifiedSettings";
export * from "./settings/projectSettings";
export * from "./settings/profileManager";
export * from "./settings/configManager";

// ─── Agent 定义与管理 ─────────────────────────────────────
export * from "./agents/agentDefinitions";
export * from "./agents/agentConfig";
export * from "./agents/subAgentConfig";
export * from "./agents/agentLoader";

// ─── 主题系统 ─────────────────────────────────────────────
export * from "./themes/themeConfig";
export * from "./themes/themesDark";
export * from "./themes/themesLight";
export * from "./themes/themesOpenCodeExtended";

// ─── 功能开关与特性配置 ───────────────────────────────────
export * from "./features/apiConfig";
export * from "./features/disabledTools";
export * from "./features/hooksConfig";
export * from "./features/permissionsConfig";
export * from "./features/proxyConfig";

// ─── 类型与验证 ───────────────────────────────────────────
// 注意: types/schema.ts 的验证框架（validateConfigAgainstSchema 等）
// 当前无外部消费者，仅通过 @config/type 导出类型定义
