export { spawnTeamMate } from "./teamMateSpawner";
export type { SpawnTeamMateOptions, SpawnTeamMateDeps } from "./teamMateSpawner";
export { startTeamMateExecution, shutdownTeamMate } from "./teamMateLifecycle";
export type { StartTeamMateExecutionDeps, ShutdownTeamMateDeps } from "./teamMateLifecycle";
export { resolveTeammateAgentPolicy } from "./teamAgentPolicy";
export type { TeammateAgentPolicyOptions, ResolvedTeammateAgentPolicy } from "./teamAgentPolicy";
export { buildSyntheticTools, SYNTHETIC_TOOL_NAMES } from "./teamExecutorHelpers";
export type {
  TeamSyntheticToolName,
  TeamSynthesizedTool,
  TeamSynthesizedToolMap,
  TeammateExecutionOptions,
  TeammateStreamMessage,
} from "./teamExecutorHelpers";
export { buildTeammateSystemPrompt, buildTeamContext } from "./teamPromptBuilder";
export type { BuildTeammateSystemPromptInput, BuildTeamContextInput } from "./teamPromptBuilder";
export {
  messageTeamMate,
  broadcastTeamMessage,
  waitForTeamStandby,
  approveTeamPlan,
  createTeamTask,
  updateTeamTask,
  getTeamRuntimeState,
} from "./teamLeadActions";
export type { TeamLeadActionDeps, CreateTeamTaskOptions, TeamRuntimeState } from "./teamLeadActions";
