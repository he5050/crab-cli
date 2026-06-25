/**
 * Tool 模块统一入口
 *
 * 所有对外公开的值（函数、类、常量）均通过此文件导出。
 * 类型定义请通过 @/tool/types 导入。
 *
 * 模块结构:
 *   types/          — 核心类型定义与工具工厂 (defineTool, ToolDefinition, ToolContext)
 *   registry/       — 工具注册表与命名解析 (registerTool, getRegisteredTools, toolRegistry)
 *   executor/       — 工具执行流水线 (ToolExecutor, executeToolCore, runtimeExec)
 *   result/         — 输出处理与缓存 (truncate, toolCache, tokenLimiter)
 *   (other dirs)    — 内置工具实现 (bash, filesystem, search, 等)
 *
 * 使用方式:
 *   import { ToolExecutor, registerTool } from "@/tool"
 *   import type { ToolDefinition } from "@/tool/types"
 */

// ─── types ────────────────────────────────────────────────
export { defineTool, ToolTimeoutError, type ToolContext, type ToolDefinition } from "./types";

// ─── registry ─────────────────────────────────────────────
export {
  registerTool,
  registerTools,
  unregisterTool,
  getRegisteredTools,
  getTool,
  getToolsForAiSdk,
  getToolsForAiSdkByNames,
  clearToolsCache,
  setupGoalToolVisibility,
  getBuiltinToolGroups,
  isBuiltinTool,
  getBuiltinGroupName,
  isMcpToolNameDisabled,
  toolNameMatches,
  BUILTIN_TOOL_PREFIXES,
  resolveExplicitExternalToolReference,
  resolveExternalToolName,
} from "./registry";

// ─── executor ─────────────────────────────────────────────
export {
  ToolExecutor,
  searchTools,
  isSensitiveCall,
  checkCommandInjection,
  executeToolCore,
  evaluateToolExecutionPolicy,
  runWithTimeout,
  createBaseToolContext,
  executeRegisteredTool,
} from "./executor";

// ─── result ───────────────────────────────────────────────
export {
  truncateToolOutput,
  needsTruncation,
  getTruncateDefaults,
  cleanupTruncationFiles,
  streamReadTruncatedFile,
  countTruncatedFileLines,
  ToolResultCache,
  getToolResultCache,
  resetToolResultCache,
  validateAndTruncate,
  estimateTokens,
  getToolResultTokenLimit,
  validateTokenLimit,
  wrapToolResultWithTokenLimit,
} from "./result";

// ─── DeepWiki ─────────────────────────────────────────────
export {
  deepwikiReadStructureTool,
  deepwikiReadContentsTool,
  deepwikiAskQuestionTool,
  deepwikiFetchTool,
  deepwikiSearchTool,
  readWikiStructure,
  readWikiContents,
  askQuestion,
} from "./deepwiki";

// ─── Context7 ─────────────────────────────────────────────
export { context7ResolveLibraryIdTool, context7QueryDocsTool, resolveLibraryId, queryLibraryDocs } from "./context7";

// ─── 内置工具 ────────────────────────────────────────────
export { webSearchTool } from "./websearch";
export { webFetchTool } from "./websearch/webfetch";
export { todoUltraTool } from "./todo";
export { askUserQuestionTool } from "./askUser";
export { subagentTool } from "./subagent";
export { teamTool, teamTools } from "./team";
export { schedulerTool } from "./scheduler";
export { notebookTool } from "./notebook";
export { skillsTool } from "./skills";
export { ideDiagnosticsTool } from "./ideDiagnostics";
export { codebaseSearchTool } from "./codebaseSearch";
export { aceEnhancedSearchTool } from "./codebaseSearch/enhanced";
export { filesystemMultiEditTool } from "./filesystem/multiEdit";
export { notebookReadTool, notebookEditTool } from "./notebookJupyter";
export { lspTool } from "./lsp";
export { planModeTool } from "./planMode";
export { toolSearchTool } from "./toolSearch";
export { grepTool } from "./codebaseSearch/grepTool";
export { globTool } from "./codebaseSearch/globTool";
export { applyPatchTool } from "./codebaseSearch/applyPatchTool";
export { sendMessageToAgentTool, queryAgentsStatusTool } from "./agentComms";
export { goalTool } from "./goal";
export { deepResearchTool } from "./deepResearch";
export { default as gitTool, gitMerge, gitRebase, gitPush, gitTag } from "./git";
export { default as formatTool } from "./format";

// ─── MCP 资源访问工具 ────────────────────────────────────
export { listMcpResourcesTool, readMcpResourceTool } from "./mcp";
