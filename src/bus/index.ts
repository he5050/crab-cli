/**
 * Bus 模块 — 进程内事件总线统一出入口。
 *
 * 所有外部模块应通过 `@bus` 统一入口引用，不再直接访问 core/ 或 events/ 子目录。
 *
 * 核心能力:
 *   - 类型安全的发布/订阅事件系统（EventBus + globalBus）
 *   - 应用事件聚合层（AppEvent + 派生类型）
 *   - 20 个业务域事件契约
 *   - 进程生命周期管理
 *   - 事件命名规范校验与载荷校验
 */

// ─── 核心类型 ───────────────────────────────────────────────
export type { EventDefinition, EventPayload, EventHandler, EventQueueItem, EventHistoryItem } from "./core";

// ─── EventBus 主类 + 全局单例 ──────────────────────────────
export { EventBus, globalBus } from "./core";

// ─── 工具函数 ──────────────────────────────────────────────
export { defineEvent, filterExpiredEvents } from "./core";

// ─── Durable Event Store (持久化事件) ─────────────────────
export { persistEvent, replayEvents, getGlobalEventStream, getLatestVersion, deleteEventsByAggregate } from "./core";
export type { DurableEventRecord } from "./core";

// ─── 进程生命周期 ──────────────────────────────────────────
export { installGlobalProcessHandlers, uninstallGlobalProcessHandlers, __resetGlobalBusForTest } from "./core";

// ─── 应用事件聚合 ──────────────────────────────────────────
export { AppEvent } from "./events";
export type { AppEventType, EventPayloadMap, EventOf, AppEventHandler } from "./events";

// ─── 域事件集合 ──────────────────────────────────────────
export { LifecycleEvents } from "./events/lifecycleEvents";
export { SessionEvents } from "./events/sessionEvents";
export { ToolEvents } from "./events/toolEvents";
export { PermissionEvents } from "./events/permissionEvents";
export { UserInputEvents } from "./events/userInputEvents";
export { ChatEvents } from "./events/chatEvents";
export { ConversationEvents } from "./events/conversationEvents";
export { CompressEvents } from "./events/compressEvents";
export { McpEvents } from "./events/mcpEvents";
export { IdeEvents } from "./events/ideEvents";
export { AgentEvents } from "./events/agentEvents";
export { RoleEvents } from "./events/roleEvents";
export { TeamEvents } from "./events/teamEvents";
export { TaskEvents } from "./events/taskEvents";
export { SkillEvents } from "./events/skillEvents";
export { SnapshotEvents } from "./events/snapshotEvents";
export { LoopEvents } from "./events/loopEvents";
export { ResearchEvents } from "./events/researchEvents";
export { CleanupEvents } from "./events/cleanupEvents";
export { HookEvents } from "./events/hookEvents";

// ─── 事件辅助工具 ──────────────────────────────────────────
export type { ToolCallBase, ToolResultBase } from "./events/common";
export { validateEventName, isNamedException } from "./events/namingRules";
export { validateAllAppEventNames } from "./events/namingValidation";
export type { AppEventNameValidationIssue } from "./events/namingValidation";
export { validateCriticalAppEventPayloadShapes } from "./events/payloadValidation";
export type { CriticalPayloadValidationIssue } from "./events/payloadValidation";

// ─── 跨传输层运行时事件 ─────────────────────────────────────
export { createRuntimeEvent, toLegacySseEvent, toAcpSessionUpdate } from "./runtimeEvents";
export type { RuntimeEvent, RuntimeEventInput, LegacySseEvent, AcpSessionUpdate } from "./runtimeEvents";

// ─── 进程生命周期工具 ───────────────────────────────────────
export { registerCleanup, runCleanup, clearCleanup, unregisterCleanup } from "./lifecycle/globalCleanup";
export { registerTmpCleanup, runTmpCleanup } from "./lifecycle/tmpCleanup";
export { exec, commandExists } from "./lifecycle/processManager";
export type { ProcessResult, ProcessOptions } from "./lifecycle/processManager";
export type { CleanupProvider } from "./lifecycle/cleanupProvider";
