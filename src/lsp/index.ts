/**
 * [LSP 模块统一出入口]
 *
 * 所有外部模块应通过 `@/lsp` 或 `@lsp` 引用本模块，
 * 不应直接引用子目录路径。
 *
 * 职责:
 *   - 管理项目级 LSP 客户端实例
 *   - 启动/停止 LSP Server 进程
 *   - 转发 LSP 请求(definition/references/hover/completion/diagnostics/symbols)
 *   - 收集和缓存诊断信息
 *
 * 使用场景:
 *   - 代码导航(跳转到定义、查找引用)
 *   - 代码补全
 *   - 悬停提示
 *   - 诊断信息收集
 *   - 符号搜索
 *
 * 边界:
 *   1. 不涉及 TUI 渲染
 *   2. 需要安装对应的 LSP Server
 *   3. 每个项目有独立的 LSP 客户端实例
 *   4. 诊断信息会缓存以提高性能
 */
// ─── 语言检测 ──────────────────────────────────────────────────
export { detectLanguage, getLspServerForFile, listSupportedLanguages, type LanguageInfo } from "./language/language";

// ─── Server 注册表 ──────────────────────────────────────────
export {
  builtinServers,
  findServerForLanguage,
  getServerDefinition,
  isServerInstalled,
  listBuiltinServers,
  type LspServerDefinition,
} from "./registry/serverRegistry";

// ─── 配置 ─────────────────────────────────────────────────────
export {
  loadLspConfig,
  resolveLspConfig,
  getAvailableServerForLanguage,
  type LspConfig,
  type ResolvedLspConfig,
  type UserLspServerConfig,
} from "./config/lspConfig";
export {
  validateLspConfig,
  validateServerConfig,
  type ValidationResult,
  type ValidationOptions,
} from "./config/configValidator";
export { ConfigWatcher, createConfigWatcher, watchConfig } from "./config/configWatcher";
export { ConfigIntegration, setupConfigHotReload, type ConfigIntegrationOptions } from "./config/configIntegration";

// ─── 管理器 ──────────────────────────────────────────────────
export { LspManager, lspManager } from "./manager/manager";
export type {
  LspCompletionItem,
  LspDiagnostic,
  LspLocation,
  LspSymbol,
  LspTextEdit,
  LspWorkspaceEdit,
  LspClient,
  LspServerConfig,
} from "./manager/manager";
export {
  requestLspLocations,
  requestLspHover,
  requestLspDocumentSymbols,
  requestLspCompletion,
  requestLspFormatDocument,
  requestLspRename,
  requestLspWorkspaceSymbols,
  requestLspCodeActions,
  notifyLspDidOpen,
  notifyLspDidChange,
  notifyLspDidClose,
  type LspFeatureDeps,
  type LspFeatureClientSnapshot,
} from "./manager/managerFeatures";

// ─── 性能优化（已集成到 LspManager） ──────────────────────────
export {
  ResponseCache,
  RequestQueue,
  PerformanceMonitor,
  createPerformanceCache,
  createRequestQueue,
  createPerformanceMonitor,
} from "./perf/performance";
