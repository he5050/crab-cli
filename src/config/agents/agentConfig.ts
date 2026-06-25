/**
 * Agent 配置辅助 — 内置 Agent 定义的统一出入口。
 *
 * 本文件曾包含简化的 BuiltinAgentDef 接口和派生 API（getBuiltinAgent、
 * listBuiltinAgents、BUILTIN_AGENTS），现已统一迁移到 agentDefinitions.ts 的
 * 完整 AgentDefinition 接口。外部模块请通过 @config/agents/agentDefinitions
 * 获取内置 Agent 定义。
 *
 * 使用方式：
 *   import { getBuiltinAgentDefinition } from "@/config";
 */
export type { AgentDefinition as BuiltinAgentDef } from "./agentDefinitions";
