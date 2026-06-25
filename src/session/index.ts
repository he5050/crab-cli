export type * from "./type";

export {
  createSession,
  createSessionAsync,
  ensureSession,
  ensureSessionAsync,
  getSession,
  updateSession,
  setSessionPersistenceStatus,
  deleteSession,
  listSessions,
  forkSession,
  addSessionTokens,
  addMessage,
  addTextMessage,
  getSessionMessages,
  getMessageCount,
  deleteSessionMessages,
  deleteMessage,
  copyMessages,
  cleanIncompleteToolCalls,
  getPartsByType,
  createCheckpoint,
  restoreCheckpoint,
  listCheckpoints,
  deleteCheckpoint,
  updateCheckpointLabel,
  getCheckpoint,
  compareCheckpoints,
  cleanupOldCheckpoints,
  getCheckpointStats,
} from "./core";

export { estimateTokens, estimateMessagesTokens, formatTokenCount } from "./token/tokenCounterRef";
export type { TokenUsage } from "./types";

export type { StateMachineConfig } from "./state";
export {
  getSessionStatus,
  setSessionStatus,
  syncRuntimeSessionStatus,
  isSessionBusy,
  canAcceptInput,
  clearSessionStatus,
  getBusySessions,
  resetAllBusy,
  SessionState,
  StateTransitionEvent,
  SessionStateMachine,
  createSessionStateMachine,
  createLoggedStateMachine,
  createProtectedStateMachine,
  InvalidStateTransitionError,
  isTerminalState,
  canAcceptInputByState,
  canExecute,
  canTransition,
  getAvailableTransitions,
  SessionStateManager,
  getOrCreateSessionStateManager,
  getSessionStateManager,
  getAllSessionStateManagers,
  destroySessionStateManager,
  destroyAllSessionStateManagers,
} from "./state";

export {
  chatMessageToParts,
  chatRoleToMessageRole,
  messagePartsToChatParts,
  extractPlainText,
  messageRoleToChatRole,
  messageRecordsToModelMessages,
  modelMessageToParts,
} from "./adapter";

export {
  exportSession,
  serializeSessionAsMarkdown,
  serializeSessionAsJson,
  serializeSessionAsText,
  serializeSessionAsHtml,
  importSession,
  previewImport,
  detectFormat,
  importMultiple,
  parseClaudeMessages,
  convertSession,
  convertMultiple,
  detectConvertFormat,
  validateSessionData,
  shareSession,
  listShares,
  exportSessionAsJson,
  exportSessionAsMarkdown,
  exportSessionAsText,
  exportSessionAsHtml,
  createSnapshot,
  listSnapshots,
  restoreSnapshot,
  deleteSnapshot,
  diffSnapshots,
} from "./io";

export { SessionRecorder, listRecordings, loadRecording, deleteRecording, SessionReplayer } from "./record";

export { getSessionUsageStats, getGlobalUsageStats } from "./usage";

export { commandUsageManager } from "./usage";

export {
  buildContextBudget,
  buildContextGovernancePanel,
  buildContextGovernanceSummary,
  collectContextGovernancePanel,
} from "./governance";

export { summarizeSession } from "./summarize";

export { createSessionOrchestrator, startRequest, endRequest } from "./orchestrator";

export {
  addPersistentPermission,
  loadPersistentPermissions,
  findPersistentPermission,
  removePersistentPermission,
  clearPersistentPermissions,
} from "./permissions";

// ─── 自动记忆系统 ─────────────────────────────────────────
export {
  loadMemory,
  saveMemory,
  addMemory,
  deleteMemory,
  clearMemory,
  extractAndSaveMemory,
  buildMemoryPrompt,
  type MemoryCategory,
  type MemoryEntry,
  type MemoryStore,
} from "./memory";
