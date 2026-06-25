/**
 * Agent 定义注册表 — 内置 Agent 定义的集中管理
 *
 * 职责:
 *   - 定义内置 Agent 名称常量
 *   - 提供内置 Agent 列表、查询、校验函数
 *   - 统一转发 config/schema/definitions 中的定义
 *
 * 注意: 本文件是定义的实际实现位置，根目录的 definition.ts 是向后兼容桥接。
 */

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
} from "@/config";

export type {
  AgentDefinition,
  AgentModelPreference,
  AnyBuiltinAgentName,
  BuiltinAgentName,
  BuiltinLightweightAgentName,
  BuiltinPrimaryAgentName,
} from "@/config";
