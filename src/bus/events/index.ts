/**
 * Bus Events — 应用事件聚合层统一出入口。
 *
 * 职责:
 *   - 将各域事件集合统一暴露为 `AppEvent`
 *   - 推导并导出事件相关类型（AppEventType、EventPayloadMap 等）
 *   - 导出域事件集合与辅助工具
 *
 * 边界:
 *   - 不感知任何业务模块；业务类型由订阅方按需断言
 */

import { type EventDefinition, type EventPayload } from "../core/types";

import { LifecycleEvents } from "./lifecycleEvents";
import { ChatEvents } from "./chatEvents";
import { UserInputEvents } from "./userInputEvents";
import { McpEvents } from "./mcpEvents";
import { TaskEvents } from "./taskEvents";
import { AgentEvents } from "./agentEvents";
import { RoleEvents } from "./roleEvents";
import { TeamEvents } from "./teamEvents";
import { SkillEvents } from "./skillEvents";
import { CompressEvents } from "./compressEvents";
import { ConversationEvents } from "./conversationEvents";
import { IdeEvents } from "./ideEvents";
import { SnapshotEvents } from "./snapshotEvents";
import { LoopEvents } from "./loopEvents";
import { ResearchEvents } from "./researchEvents";
import { CleanupEvents } from "./cleanupEvents";
import { HookEvents } from "./hookEvents";
import { SessionEvents } from "./sessionEvents";
import { ToolEvents } from "./toolEvents";
import { PermissionEvents } from "./permissionEvents";

/** 应用事件集合 — 由所有域事件常量 spread 聚合。 */
export const AppEvent = {
  ...LifecycleEvents,
  ...SessionEvents,
  ...ToolEvents,
  ...PermissionEvents,
  ...UserInputEvents,
  ...ChatEvents,
  ...ConversationEvents,
  ...CompressEvents,
  ...McpEvents,
  ...IdeEvents,
  ...AgentEvents,
  ...RoleEvents,
  ...TeamEvents,
  ...TaskEvents,
  ...SkillEvents,
  ...SnapshotEvents,
  ...LoopEvents,
  ...ResearchEvents,
  ...CleanupEvents,
  ...HookEvents,
} as const;

/** 所有事件类型字符串联合。 */
export type AppEventType = (typeof AppEvent)[keyof typeof AppEvent]["type"];

/** 事件名 → 载荷类型的映射。 */
export type EventPayloadMap = {
  [K in keyof typeof AppEvent]: (typeof AppEvent)[K] extends EventDefinition<infer P> ? P : never;
};

/** 根据事件名获取对应的 EventDefinition 类型。 */
export type EventOf<K extends keyof typeof AppEvent> = (typeof AppEvent)[K];

/** 下游订阅快捷类型。 */
export type AppEventHandler<K extends keyof typeof AppEvent> = (payload: EventPayload<EventPayloadMap[K]>) => void;

// ─── 域事件集合重导出 ─────────────────────────────────────
export { LifecycleEvents } from "./lifecycleEvents";
export { SessionEvents } from "./sessionEvents";
export { ToolEvents } from "./toolEvents";
export { PermissionEvents } from "./permissionEvents";
export { UserInputEvents } from "./userInputEvents";
export { ChatEvents } from "./chatEvents";
export { ConversationEvents } from "./conversationEvents";
export { CompressEvents } from "./compressEvents";
export { McpEvents } from "./mcpEvents";
export { IdeEvents } from "./ideEvents";
export { AgentEvents } from "./agentEvents";
export { RoleEvents } from "./roleEvents";
export { TeamEvents } from "./teamEvents";
export { TaskEvents } from "./taskEvents";
export { SkillEvents } from "./skillEvents";
export { SnapshotEvents } from "./snapshotEvents";
export { LoopEvents } from "./loopEvents";
export { ResearchEvents } from "./researchEvents";
export { CleanupEvents } from "./cleanupEvents";
export { HookEvents } from "./hookEvents";

// ─── 辅助工具重导出 ───────────────────────────────────────
export type { ToolCallBase, ToolResultBase } from "./common";
export { validateEventName, isNamedException } from "./namingRules";
export { validateAllAppEventNames } from "./namingValidation";
export { validateCriticalAppEventPayloadShapes } from "./payloadValidation";
export type { AppEventNameValidationIssue } from "./namingValidation";
export type { CriticalPayloadValidationIssue } from "./payloadValidation";
