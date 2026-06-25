// src/agent/type.ts
// Agent 模块公共类型导出（轻量导入路径）
//
// 用途: 外部模块仅需类型时可通过 `import type { ... } from "@/agent/type"` 导入,
// 避免拉取整个 agent/index.ts 的值导出依赖树。
// 值导出统一走 `@/agent` (即 agent/index.ts).

export type { AgentInfo, AgentMode, AgentStatus, AgentModel } from "./core/manager";

export type { AgentRuntimeState } from "./core/state";

export type { AgentErrorReason, AgentErrorContext } from "./core/errors";

export type {
  AgentDefinition,
  AgentModelPreference,
  AnyBuiltinAgentName,
  BuiltinAgentName,
  BuiltinLightweightAgentName,
  BuiltinPrimaryAgentName,
} from "./core/definition";

export type { AgentSessionOptions, AgentSessionResult, SubagentTask } from "./session/types";
