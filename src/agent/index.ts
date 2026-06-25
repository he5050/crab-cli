/**
 * Agent 模块入口
 *
 * ─── Agent vs Role 概念边界 ─────────────────────────────────
 * Agent(智能体)= 运行时实例 = 本目录
 *   - 单次任务加载 1 个 Role + LLM + 上下文
 *   - 任务结束即销毁
 *   - 比喻:类的 object，运行时临时存在
 *
 * Role(角色)= 静态配置 = 永久存储(见 src/agent/roles/)
 *   - 同一 Role 可被多个 Agent 实例加载
 *   - 比喻:类的 class，定义一次，多次实例化
 *
 * 主-子 Agent 体系:Root Agent → CodeAgent / LintAgent / ShellAgent /
 *   FileAgent / SearchAgent → 嵌套
 *
 * 职责:
 *   - 导出所有 Agent 相关的公共接口和函数
 *   - 提供统一的 Agent 注册入口
 *   - 聚合 Agent Manager、Session、Tracker 等子模块
 *
 * 使用场景:
 *   - 应用启动时注册所有 Agent
 *   - 其他模块导入 Agent 相关功能
 *   - 管理 Agent 生命周期
 *
 * 边界:
 *   1. 仅作为入口文件，具体实现在各子模块中
 *   2. 不负责 Agent 的执行逻辑
 *   3. 需要在应用启动时调用 registerAllAgents()
 *
 * 流程:
 *   1. 从各子模块导入并重新导出公共接口
 *   2. 提供 registerAllAgents() 统一注册入口
 *   3. 应用启动时调用 registerAllAgents() 初始化所有 Agent
 */

// ═══════════════════════════════════════════════════════════
// Core 模块 - Agent 核心管理
// ═══════════════════════════════════════════════════════════
export {
  registerAgent,
  registerAgents,
  unregisterAgent,
  getAgent,
  listAgents,
  listAgentsByMode,
  listPrimaryAgents,
  listSubagents,
  hasAgent,
  getActiveAgentName,
  getActiveAgent,
  setActiveAgent,
  getAgentStatus,
  setAgentStatus,
  resetAllAgentStatus,
  initBuiltinAgents,
  _resetAll,
} from "./core/manager";

export type { AgentInfo, AgentMode, AgentStatus, AgentModel } from "./core/manager";

export { agentEvents, createAgentEvents, subscribeAgentEvents, type AgentEventSubscribers } from "./core/agentEvents";

export {
  saveAgentState,
  loadAgentState,
  clearAgentState,
  findRecoverableSessions,
  cleanupExpiredStates,
} from "./core/state";

export type { AgentRuntimeState } from "./core/state";

export { getAgentErrorMessage, createAgentRuntimeError, toAgentLogPayload } from "./core/errors";

export type { AgentErrorReason, AgentErrorContext } from "./core/errors";

export {
  BUILTIN_AGENT_NAMES,
  BUILTIN_LIGHTWEIGHT_AGENT_NAMES,
  BUILTIN_PRIMARY_AGENT_NAMES,
  BUILTIN_VISION_AGENT_NAME,
  DEFAULT_AGENT_OUTPUT_CONTRACT,
  buildBuiltinAgentPrompt,
  listBuiltinAgentDefinitions,
  listBuiltinLightweightAgentDefinitions,
  listBuiltinPrimaryAgentDefinitions,
  listAllBuiltinAgentDefinitions,
  getBuiltinAgentDefinition,
  validateAgentDefinition,
} from "./core/definition";

export type {
  AgentDefinition,
  AgentModelPreference,
  AnyBuiltinAgentName,
  BuiltinAgentName,
  BuiltinLightweightAgentName,
  BuiltinPrimaryAgentName,
} from "./core/definition";

// ═══════════════════════════════════════════════════════════
// Session 模块 - Agent 会话管理
// ═══════════════════════════════════════════════════════════
export {
  AgentSession,
  __resetAgentSessionDepsForTesting,
  __setAgentSessionDepsForTesting,
  __setSubagentCollectorForTesting,
} from "./session/session";

export { getAgentModel, getToolsForAgent } from "./session/model";

export type { AgentSessionOptions, AgentSessionResult, SubagentTask } from "./session/types";

export {
  lifecycleHooks,
  createLifecycleHooks,
  onBeforeStart,
  onAfterStart,
  onBeforeStep,
  onAfterStep,
  onToolCall,
  onToolResult,
  onError,
  onComplete,
  onCancelled,
  type LifecycleEvent,
  type LifecycleHook,
  type HookContext,
  type HookOptions,
} from "./session/hookManager";

export {
  MessageSerializer,
  createMessageSerializer,
  createVersionedSerializer,
  serialize,
  deserialize,
  createRequest,
  createResponse,
  createError,
  createHeartbeat,
  generateMessageId,
  isRequest,
  isResponse,
  isError,
  isHeartbeat,
  getOriginalId,
  CURRENT_VERSION,
  MIN_VERSION,
  type MessageType,
  type SerializedMessage,
  type AgentMessage,
  type MigrationFn,
  type VersionConfig,
} from "./session/serializer";

export { spawnToolSubagent, type SpawnToolSubagentDeps } from "./session/sessionSubagent";

// ═══════════════════════════════════════════════════════════
// Subagent 模块 - 子代理系统
// ═══════════════════════════════════════════════════════════
export {
  SubAgentExecutor,
  createSubAgentExecutor,
  calculateDynamicConcurrency,
  type ExecutionResult,
  type ExecutionStats,
  type ExecutionStatus,
  type ExecutorConfig,
  type SubAgentTask as ExecutorSubAgentTask,
  type TaskCallbacks,
} from "./subagent/executor";

export { DEFAULT_EXECUTOR_CONFIG } from "./subagent/types";

export {
  registerSubAgentResolver,
  resolveSubAgent,
  buildSubAgentContext,
  type SubAgentType,
  type SubAgentPriority,
  type ResolveResult,
  type ResolverConfig,
} from "./subagent/resolver";

export {
  subAgentTracker,
  RunningSubAgentTracker,
  type InterAgentMessage,
  type SpawnedResult,
  type SubAgentStatus,
  type TrackerChangeEvent,
  type TrackerChangeListener,
} from "./subagent/tracker";

export { buildSpawnedToolResult } from "./subagent/tracker";

export {
  drainSpawnedChildResults,
  buildSpawnedChildrenContinuationPrompt,
  type AggregatedSpawnedChildResult,
  type SpawnedResultDrainer,
} from "./subagent/trackerDrain";

export {
  SubAgentStreamProcessor,
  createStreamProcessor,
  type StreamChunk,
  type StreamState,
  type StreamProcessorConfig,
  type MergeStrategy,
  type AgentPriority,
} from "./subagent/streamProcessor";

export {
  BUILTIN_AGENT_TOOL_NAMES,
  BUILTIN_TOOL_PREFIXES,
  SEND_MESSAGE_TOOL_SCHEMA,
  QUERY_STATUS_TOOL_SCHEMA,
  SPAWN_SUB_AGENT_TOOL_SCHEMA,
  getBuiltinAgentToolSchemas,
  injectBuiltinToolNames,
  buildSubAgentTools,
  buildPeerAgentsContext,
  buildSubAgentInitialMessages,
  type BuiltinAgentToolName,
} from "./subagent/builtinTools";

export {
  interceptBuiltinTools,
  interceptSendMessage,
  interceptQueryStatus,
  interceptSpawnSubAgent,
  interceptAskUser,
  type InterceptedToolCall,
  type InterceptedToolResult,
  type InterceptResult,
  type InterceptorContext,
  type SpawnExecutor,
  type AskUserCallback,
} from "./subagent/toolInterceptor";

export {
  checkAndApproveTools,
  executeApprovedToolsWithHooks,
  type ToolCallRequest,
  type ConfirmationResult,
  type ApprovalResult,
  type ApprovalContext,
  type ApprovalChatMessage,
} from "./subagent/toolApproval";

export {
  buildSubagentPermissions,
  filterToolsForAgent,
  isToolAllowedForAgent,
  isPermissionAllowedForSubagent,
  validateSubagentSecurity,
} from "./subagent/permissions";

// ═══════════════════════════════════════════════════════════
// Specialized 模块 - 专用 Agent
// ═══════════════════════════════════════════════════════════
export {
  VisionAgent,
  registerVisionAgent,
  type ImageType,
  type VisionAction,
  type VisionConfig,
  type VisionInput,
  type VisionResult,
} from "./specialized/vision";

export {
  reviewCode,
  formatReviewResult,
  registerReviewAgent,
  type ReviewConfig,
  type ReviewResult,
  type ReviewIssue,
} from "./specialized/review";

export {
  summarizeBashOutput,
  shouldSummarize,
  quickSummarize,
  registerBashSummaryAgent,
  type BashSummaryConfig,
  type BashSummaryResult,
} from "./specialized/bashSummary";

export {
  reviewSearchResults,
  quickReview,
  rewriteCodebaseSearchQuery,
  registerCodebaseReviewAgent,
  type SearchResultItem,
  type CodebaseReviewConfig,
  type CodebaseReviewResult,
  type ReviewedResultItem,
} from "./specialized/codebaseReview";

export {
  createCodebaseIndex,
  generateCodebaseOverview,
  registerCodebaseIndexAgent,
  type CodebaseIndexConfig,
  type CodebaseIndexResult,
  type DirectoryNode,
  type FileType,
  type IndexedFile,
  type IndexStatistics,
  type TechStack,
} from "./specialized/codebaseIndex";

export {
  classifyFile,
  DEFAULT_CONFIG,
  EXTENSION_TO_LANGUAGE,
  isEntryFile,
  shouldIgnoreDir,
  shouldIgnoreExtension,
  TECH_STACK_INDICATORS,
} from "./specialized/codebaseIndexDefinitions";

export {
  createSummary,
  summarizeConversation,
  summarizeCodeChanges,
  summarizeDocument,
  registerSummaryAgent,
  type SummaryConfig,
  type SummaryResult,
  type SummaryType,
  type ConversationMessage,
  type CodeChange,
} from "./specialized/summary";

// ═══════════════════════════════════════════════════════════
// Runtime 模块 - 运行时支持
// ═══════════════════════════════════════════════════════════
export {
  CircuitBreaker,
  createCircuitBreaker,
  createDeadLoopHandler,
  type ErrorFingerprint,
  type CircuitBreakerConfig,
  type CircuitBreakerStats,
} from "./runtime/circuitBreaker";

export {
  Watchdog,
  createWatchdog,
  createTimeoutHandler,
  type WatchdogEventType,
  type WatchdogEvent,
  type WatchdogConfig,
} from "./runtime/watchdog";

export {
  HeartbeatMonitor,
  createHeartbeatMonitor,
  type HeartbeatStatus,
  type HeartbeatEvent,
  type HeartbeatListener,
  type HeartbeatConfig,
} from "./runtime/heartbeat";

export {
  checkCompressionSince,
  buildCompressionContinuationPrompt,
  getLastCompressionTime,
} from "./runtime/compression";

export {
  buildAgentRuntimeAugmentations,
  type AgentRuntimeAugmentationState,
  type AgentRuntimeAugmentationResult,
} from "./runtime/augmentations";

export {
  addAttention,
  dismissAttention,
  clearDismissed,
  formatAttentionPrompt,
  getPoints,
  isEnabled,
  enableAttention,
  disableAttention,
  resetAttention,
  activePoints,
  highestLevel,
  type AttentionPoint,
} from "./runtime/attention";

export { getCurrentMode, getYoloOverlay, getEffectiveMode, switchMode, resetModeState } from "./runtime/modeState";

export { isYoloPassthroughActive, getYoloPassthroughRuleset, shouldAutoApproveSubAgentTool } from "./runtime/yolo";

// ═══════════════════════════════════════════════════════════
// Contracts 模块 - 契约层(Tool-facing API)
// ═══════════════════════════════════════════════════════════
export { bootstrapToolFacingDeps } from "./contracts/toolFacingBootstrap";

export {
  resolveToolSubAgent,
  isToolSubAgentRunning,
  injectToolSubAgentMessage,
  listToolSubAgents,
  reviewToolCodebaseSearchResults,
  rewriteToolCodebaseSearchQuery,
  type ToolFacingSubAgentResolution,
  type ToolFacingSubAgentStatus,
  type ToolFacingSearchResultItem,
  type ToolFacingReviewedResultItem,
  type ToolFacingCodebaseReviewConfig,
  type ToolFacingCodebaseReviewResult,
} from "./contracts/toolFacing";

// ═══════════════════════════════════════════════════════════
// Snapshot 模块 - 快照系统
// ═══════════════════════════════════════════════════════════
export { validateSnapshot, type SnapshotValidator } from "./snapshot/validator";

export { type AgentSnapshot, type SnapshotMetadata } from "./snapshot/schema";

// ═══════════════════════════════════════════════════════════
// Prompt 模块 - Agent 系统提示词构建（原 src/prompt/）
// ═══════════════════════════════════════════════════════════
export * from "./prompt";

// ═══════════════════════════════════════════════════════════
// Roles 模块 - Agent 角色配置（原 src/roles/）
// ═══════════════════════════════════════════════════════════
export * from "./roles";

// ═══════════════════════════════════════════════════════════
// Team 模块 - 多 Agent 协作（原 src/team/）
// ═══════════════════════════════════════════════════════════
export * from "./team";

// ═══════════════════════════════════════════════════════════
// Generator 模块 - LLM Agent 生成
// ═══════════════════════════════════════════════════════════
export { generateAgent, saveGeneratedAgent, generateAgentCommand, type GeneratedAgentConfig } from "./generator";

// ═══════════════════════════════════════════════════════════
// 统一注册入口
// ═══════════════════════════════════════════════════════════

import * as codebaseIndexAgent from "./specialized/codebaseIndex";
import * as codebaseReviewAgent from "./specialized/codebaseReview";
import * as subAgentResolver from "./subagent/resolver";
import { bootstrapToolFacingDeps } from "./contracts/toolFacingBootstrap";
import { initBuiltinAgents } from "./core/manager";

export function registerAllAgents(): void {
  bootstrapToolFacingDeps();
  initBuiltinAgents();
  codebaseReviewAgent.registerCodebaseReviewAgent();
  codebaseIndexAgent.registerCodebaseIndexAgent();
  subAgentResolver.registerSubAgentResolver();
}
