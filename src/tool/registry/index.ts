export {
  registerTool,
  registerTools,
  unregisterTool,
  getRegisteredTools,
  getToolsForAiSdk,
  getToolsForAiSdkByNames,
  getTool,
  clearToolsCache,
  setupGoalToolVisibility,
  getBuiltinToolGroups,
  isBuiltinTool,
  getBuiltinGroupName,
  isMcpToolNameDisabled,
  _resetForTesting,
  _resetGoalToolRegisteredForTesting,
  _isGoalToolVisibilityInitializedForTesting,
  _getGoalToolVisibilityInstallCountForTesting,
  type BuiltinToolGroup,
} from "./toolRegistry";

export { toolNameMatches } from "./toolNameMatcher";
export { BUILTIN_TOOL_PREFIXES, registerBuiltinPrefix, getBuiltinPrefixes } from "./builtinToolPrefixes";
export {
  resolveExternalToolName,
  resolveExplicitExternalToolReference,
  type ExternalToolResolution,
} from "./externalToolResolver";
