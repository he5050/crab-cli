/**
 * 插件系统模块入口。
 *
 * 导出:
 *   - PluginManager / createPluginManager
 *   - PluginLoader / createPluginLoader
 *   - PluginSandbox / createPluginSandbox
 *   - BasePlugin
 *   - 类型:PluginMetadata / PluginInterface / PluginInstance / PluginPackage
 *         / PluginStatus / PluginLoadOptions / PluginLoaderOptions / SandboxConfig
 */
export {
  PluginManager,
  BasePlugin,
  createPluginManager,
  type PluginMetadata,
  type PluginInterface,
  type PluginInstance,
  type PluginStatus,
  type PluginLoadOptions,
  type SandboxConfig,
} from "./pluginSystem";

export {
  PluginLoader,
  createPluginLoader,
  PluginManifestValidationError,
  type PluginPackage,
  type LoadResult,
  type LoaderOptions,
} from "./pluginLoader";

export { PluginSandbox, createPluginSandbox, type SandboxCheckInput, type SandboxCheckResult } from "./pluginSandbox";

export {
  TRUSTED_PLUGIN_SOURCES,
  buildPluginInstallPlan,
  buildPluginMarketplaceCatalog,
  createPluginInstallLock,
  evaluateMarketplacePlugin,
  type PluginInstallLock,
  type PluginInstallLockResult,
  type MarketplacePluginEntry,
  type MarketplacePluginEvaluation,
  type MarketplacePluginStatus,
  type PluginInstallPlan,
  type PluginMarketplacePolicy,
  type TrustedPluginSource,
} from "./pluginMarketplace";
