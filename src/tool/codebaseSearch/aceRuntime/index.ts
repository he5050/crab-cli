/**
 * ACE Code Search 模块入口。
 *
 *
 * 导出:
 *   - ACECodeSearchService — 增强型符号索引与搜索服务
 *   - 类型定义
 *   - 语言配置与检测
 *   - 符号解析
 *   - 文件系统工具
 *   - 搜索工具
 *   - 常量
 */

// 服务
export { ACECodeSearchService } from "./aceService";

// 类型
/** re-export */
export type {
  SymbolType,
  CodeSymbol,
  ReferenceType,
  CodeReference,
  SemanticSearchResult,
  TextSearchResult,
  LanguageConfig,
  IndexStats,
} from "./types";

// 语言
export { LANGUAGE_CONFIG, detectLanguage } from "./language";

// 符号解析
export { parseFileSymbols, getContext } from "./symbol";
/** re-export */
export type { ParseFileSymbolsOptions } from "./symbol";

// 文件系统
export {
  DEFAULT_EXCLUDES,
  shouldExcludeDirectory,
  shouldExcludeFile,
  loadExclusionPatterns,
  readFileWithCache,
  isGitRepository,
} from "./filesystem";
/** re-export */
export type { ContentCacheCallbacks } from "./filesystem";

// 搜索
export {
  isCommandAvailable,
  parseGrepOutput,
  globToRegex,
  calculateFuzzyScore,
  expandGlobBraces,
  globPatternToRegex,
  calculateRegexComplexity,
  isSafeRegexPattern,
  processWithConcurrency,
  createTimeoutPromise,
  sortResultsByRecency,
} from "./search";

// 常量
export {
  INDEX_CACHE_DURATION,
  BATCH_SIZE,
  BINARY_EXTENSIONS,
  GREP_EXCLUDE_DIRS,
  RECENT_FILE_THRESHOLD,
  MAX_FILE_CACHE_SIZE,
  MAX_FILE_STAT_CACHE_SIZE,
  ACE_IDLE_CLEANUP_MS,
  MAX_INDEXED_FILES,
  MAX_SYMBOLS_PER_FILE,
  MAX_FZF_SYMBOL_NAMES,
  MAX_FILE_OUTLINE_SYMBOLS,
  MAX_FILE_OUTLINE_PAYLOAD_CHARS,
  LARGE_FILE_THRESHOLD,
  FILE_READ_CHUNK_SIZE,
  TEXT_SEARCH_TIMEOUT_MS,
  MAX_CONCURRENT_FILE_READS,
  MAX_REGEX_COMPLEXITY_SCORE,
  MAX_CONTENT_CACHE_BYTES,
  MEMORY_PRESSURE_THRESHOLD_BYTES,
  MEMORY_CHECK_INTERVAL_MS,
} from "./constants";

// 远程路径
export { isSSHPath, splitSshUrl, posixJoin, toSshUrl, resolveRemotePath, relativeRemotePath } from "./pathRemote";
/** re-export */
export type { SshUrlParts } from "./pathRemote";

// 远程搜索
export {
  REMOTE_CACHE_TTL_MS,
  REMOTE_EXCLUDE_DIRS,
  REMOTE_SOURCE_EXTENSIONS,
  RemoteToolUnavailableError,
  escapeShellArg,
  detectRemoteTools,
  buildRemoteTextSearchCommand,
  buildRemoteReferencesCommand,
  buildRemoteDefinitionGrepCommand,
  buildRemoteCtagsListCommand,
  parseCtagsJsonOutput,
  runRemoteCtags,
  parseRemoteGrepOutput,
  invalidateRemoteCache,
} from "./remote";
/** re-export */
export type { RemoteToolset, RemoteGrepHit } from "./remote";

// Legacy helper facade kept under the canonical ACE module.
export {
  detectLanguage as detectLegacyLanguage,
  getSymbolPatterns,
  parseFileSymbols as parseLegacyFileSymbols,
  fuzzyPathSearch,
  remoteSearch,
} from "./compat";
