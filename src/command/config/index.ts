/**
 * Config 子模块 — 配置管理命令统一出入口。
 *
 * 职责:
 *   - 交互式配置向导（setup）
 *   - 配置导入（从 JSON 文件导入配置）
 *   - 配置导出（导出配置为 JSON）
 *   - Provider 连接测试（健康检查 + 延迟信息）
 *
 * 边界:
 *   1. 仅提供命令实现，命令路由由 @cli/core/orchestrator 负责
 *   2. 按需加载：通过动态 import() 引用，启动时无额外开销
 *   3. 错误场景直接 process.exit(1)，不做优雅恢复
 *
 * 依赖:
 *   - @config: loadConfig / saveConfig / deepMerge / getGlobalConfigPath
 *   - @schema/config: AppConfigSchema / SingleProviderConfig
 *   - @api: checkProviderHealth / checkAllProvidersHealth
 *   - @cli: createCliError / writeCliError
 */

export { setupCommand } from "./setup";
export { configImportCommand } from "./import";
export { configExportCommand } from "./export";
export { configTestCommand } from "./test";
