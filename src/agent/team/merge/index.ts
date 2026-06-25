export { TeamMergeManager } from "./teamMergeManager";
export type { TeamMergeManagerDeps } from "./teamMergeManager";
export { requestConflictFallbackChoice, applyOursPreferConflictFallback } from "./teamConflictFallback";
export type { ConflictFallbackChoice, AutoConflictResolution } from "./teamConflictFallback";
export {
  createWorktree,
  removeWorktree,
  cleanupTeamWorktrees,
  enforceWorktreePath,
  rewriteToolArgsForWorktree,
  autoCommitWorktreeChanges,
  mergeTeammateBranch,
  getConflictedFiles,
  isInMergeState,
  completeMerge,
  abortMerge,
  getTeammateDiffSummary,
  isGitRepo,
  isGitWorktreeRoot,
  defaultLlmConflictResolver,
} from "./teamWorktree";
export type { MergeStrategy, LlmConflictDecision, LlmConflictResolver } from "./teamWorktree";
