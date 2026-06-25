// ─── Logging ─────────────────────────────────────────────────────────────
export {
  createLogger,
  setLogEventSink,
  setLogLevel,
  setFileLogLevel,
  getRecentLogs,
  flushLogSync,
} from "./logging/logger";
export { appendLogEntry, flushLogStore, getLogDir, resetLogStoreForTests } from "./logging/logStore";
export { sanitizeString, sanitizeObject, sanitizeHeaders } from "./logging/debugLogger";

// ─── Config（已移至 @config，此处保留重导出以兼容） ─────────────────────
export { NAME, VERSION } from "../config/version";
export { isDevMode } from "../config/isDevMode";
export { getDevUserId, getDevSettings, updateDevSettings, clearDevConfig, initDevMode } from "../config/devMode";

// ─── Utilities ───────────────────────────────────────────────────────────
export {
  toCodePoints,
  cpLen,
  cpSlice,
  visualWidth,
  codePointToVisualPos,
  visualPosToCodePoint,
  truncate,
  formatBytes,
  formatUptime,
  stripAnsi,
  wordWrap,
} from "./utilities/textUtils";
export { pickFirstDefined, pickFirstTruthy } from "./utilities/pickFirstDefined";
export {
  sanitizeSensitiveInfo,
  containsSensitiveInfo,
  detectPromptInjection,
  sanitizePromptInjection,
  truncateString,
  sanitizeAndTruncate,
} from "./utilities/sanitize";
export { readTextFile, writeTextFile, readJsonFile, writeJsonFile, fileExists } from "./utilities/fileUtils";
export { latexToUnicode, renderLatexInText } from "./utilities/latexRender";

// ─── Identity ────────────────────────────────────────────────────────────
export { createId, extractPrefix, extractTimestamp, isIdPrefix } from "./identity";

// ─── Icons ───────────────────────────────────────────────────────────────
export * from "./icons/icon";
export * from "./icons/iconDerived";

// ─── I/O ─────────────────────────────────────────────────────────────────
export { readClipboard, writeClipboard } from "./io/clipboard";
export { useClipboard } from "./io/useClipboard";

// ─── Storage ─────────────────────────────────────────────────────────────
export { saveDrawing, loadDrawing, listDrawings, deleteDrawing, cropGrid, gridToArray, arrayToGrid } from "./storage";

// ─── Scanning ────────────────────────────────────────────────────────────
export { scanProjectTodos, formatTodoContext } from "./scanning";

// ─── Update ──────────────────────────────────────────────────────────────
export {
  checkForUpdate,
  setUpdateNotice,
  getUpdateNotice,
  onUpdateNotice,
  startUpdateCheck,
  stopUpdateCheck,
} from "./update";

// ─── Streams ─────────────────────────────────────────────────────────────
export { isStreamUsable, isStreamLocked, consumeStream } from "./streams";

// ─── Token Counter（已移至 @session/token/tokenCounterRef，此处保留重导出以兼容） ──
export { estimateTokens, estimateMessagesTokens, formatTokenCount } from "../session/token/tokenCounterRef";

// ─── Errors ──────────────────────────────────────────────────────────────
export {
  AppError,
  throwAppError,
  toAppError,
  SystemError,
  NetworkError,
  UserError,
  ConfigError,
  SessionError,
  AgentError,
  ToolError,
  SecurityError,
  DatabaseError,
  InternalError,
  createSystemError,
  createNetworkError,
  createUserError,
  createConfigError,
  createSessionError,
  createAgentError,
  createToolError,
  createSecurityError,
  createDatabaseError,
  createInternalError,
  onAppError,
} from "./errors/appError";
export { ERROR_CODES, getErrorCodeInfo, isKnownErrorCode, getSeverityLogMethod } from "./errors/errorCodes";

// ─── Concurrency ─────────────────────────────────────────────────────────
export { withTimeout, withTimeoutAndSignal } from "./concurrency/promiseUtils";
export { retry } from "./concurrency/retry";
export {
  CircuitBreaker,
  getCircuitBreaker,
  resetAllCircuitBreakers,
  getAllCircuitBreakerStats,
} from "./concurrency/circuitBreaker";
export { instanceLock, createInstanceId } from "./concurrency/instanceLock";

// ─── Lifecycle（已移至 @bus/lifecycle，此处保留重导出以兼容） ─────────────
export { registerCleanup, runCleanup, clearCleanup, unregisterCleanup } from "../bus/lifecycle/globalCleanup";
export { registerTmpCleanup, runTmpCleanup } from "../bus/lifecycle/tmpCleanup";
export { exec, commandExists } from "../bus/lifecycle/processManager";

// ─── Queue（已合并至 concurrency，此处保留重导出以兼容） ─────────────────
export { RingBuffer } from "./concurrency/ringBuffer";
export {
  createCacheManager,
  getCacheManager,
  destroyCacheManager,
  getAllCacheStats,
  cleanupAllCaches,
  getTotalCacheSize,
  webSearchCache,
  codebaseSearchCache,
  cleanupAllCachesOnExit,
} from "./concurrency/cacheManager";

// ─── Throttle（已合并至 concurrency，此处保留重导出以兼容） ───────────────
export { BackpressureMonitor, acquireExecutionPermit, getBackpressureStatus } from "./concurrency/backpressure";
export {
  ThrottlePriority,
  ThrottleQueue,
  createThrottleQueue,
  createLogThrottleQueue,
  createHighPriorityThrottleQueue,
  createThrottleDecorator,
} from "./concurrency/throttleQueue";
export { validateAndTruncate } from "./concurrency/tokenLimiter";

// ─── Compat ──────────────────────────────────────────────────────────────
export {
  CrabError,
  systemError,
  userError,
  agentError,
  configError,
  sessionError,
  toolError,
  throwError,
  safeExecute,
  safeExecuteAsync,
  toCrabError,
  onError,
} from "./error";
