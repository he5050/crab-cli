/**
 * Agent 定义 Schema
 *
 * 职责:
 *   - 定义 Agent 角色的验证结构
 *   - 支持多种 Agent 模式(primary、subagent、all)
 *   - 关联权限规则集和模型配置
 *
 * 模块功能:
 *   - 定义 Agent 模式枚举(AgentMode):primary、subagent、all
 *   - 定义 Agent 模型 Schema(AgentModel):providerID、modelID
 *   - 定义 Agent 定义 Schema(AgentDefinition):name、description、mode、permission、model、prompt、options
 *
 * 使用场景:
 *   - 验证 Agent 配置文件
 *   - 定义主 Agent 和子 Agent 角色
 *   - 关联 Agent 与权限规则
 *   - 配置 Agent 使用的模型和提示词
 *
 * 边界:
 *   1. 仅定义 schema，不涉及 Agent 执行逻辑
 *   2. Agent 执行由外部模块实现
 *   3. 使用 Zod 进行运行时类型验证
 *
 * 流程:
 *   1. 定义 Agent 模式枚举(primary/subagent/all)
 *   2. 定义 Agent 模型结构(provider + model)
 *   3. 定义完整的 Agent 定义结构
 *   4. 关联权限规则集到 Agent
 */
import { z } from "zod";
import { PermissionRuleset } from "@/schema/permission";

const LEGACY_BUILTIN_AGENT_NAMES = new Set(["coder", "architect", "reviewer", "planner"]);

export const AgentName = z
  .string()
  .min(1, "Agent 名称不能为空")
  .refine((name) => !LEGACY_BUILTIN_AGENT_NAMES.has(name), {
    message: "旧内置 agent 名称已废弃，请使用 explore/plan/general/review/qa/debug/security/docs 或自定义非保留名称",
  });

/** Agent 模式 */
export const AgentMode = z.enum(["primary", "subagent", "all"]);
export type AgentMode = z.infer<typeof AgentMode>;

/** Agent 的模型定义 */
export const AgentModel = z.object({
  modelID: z.string(),
  providerID: z.string(),
});
export type AgentModel = z.infer<typeof AgentModel>;

/** Agent 定义 Schema */
export const AgentDefinition = z.object({
  description: z.string().optional(),
  mode: AgentMode,
  model: AgentModel.optional(),
  name: AgentName,
  options: z.record(z.string(), z.unknown()).default({}),
  permission: PermissionRuleset,
  prompt: z.string().optional(),
});
export type AgentDefinition = z.infer<typeof AgentDefinition>;
