/**
 * 运行时覆盖项装配 — ChatRuntimeOverrides 构建工厂。
 *
 * 职责:
 *   - 合并 Agent/Role/Skill/Config 生成 ChatRuntimeOverrides
 *   - 构建 systemPrompt（含角色注入 + 技能索引提醒）
 *   - 解析 modelId / providerId / temperature / topP 等模型参数
 *
 * 边界:
 *   1. 纯逻辑函数，不依赖 React 或任何 UI 框架
 *   2. 返回的 ChatRuntimeOverrides 仅包含配置，不含运行时状态
 *   3. 从 @/ui/contexts/chatHelpers 迁移而来，消除 Headless 对 @/ui 的依赖
 *   4. ChatRuntimeOverrides 类型定义已迁移至 @/schema/chat（消除反向依赖）
 *
 * 原始位置: src/ui/contexts/chatHelpers.ts (仍保留 re-export 以兼容)
 */

import { getActiveRoleContent } from "@/agent/roles";
import { type AgentInfo } from "@/agent";
import { buildSystemPrompt } from "@/agent/prompt/builder";
import type { ChatMode } from "@/agent/prompt/types";
import { DEFAULT_MAX_TOOL_ROUNDS } from "@/config";
import { skillManager, buildSkillIndexReminder } from "@/extension/skill";
import type { AppConfigSchema } from "@/schema/config";
import type { ChatRuntimeOverrides } from "@/schema/chat";

export function buildChatRuntimeOverrides(
  config: AppConfigSchema,
  agent: AgentInfo | undefined,
  mode: string,
  yolo: boolean,
): ChatRuntimeOverrides {
  const defaultPrompt =
    "你是 Crab CLI 的 AI 助手，一个专业的编程助手。你可以帮助用户编写代码、调试程序、回答问题，并执行各种开发任务。";
  const basePrompt = agent?.customSystemPrompt ?? agent?.prompt ?? defaultPrompt;

  const agentPreferred = agent?.preferredSkills;
  const loadedSkills = agentPreferred && agentPreferred.length > 0 ? agentPreferred : [];
  const skillIndexReminder = buildSkillIndexReminder({
    activeRole: agent?.name,
    limit: 8,
    loadedSkills,
    mode,
  });

  // ─── 角色注入 ─────────────────────────────────────────
  const roleResult = getActiveRoleContent(process.cwd());
  const effectiveBasePrompt = roleResult.isOverride && roleResult.content ? roleResult.content : basePrompt;
  const roleAppend = !roleResult.isOverride ? roleResult.content : undefined;

  const systemPrompt = buildSystemPrompt({
    basePrompt: effectiveBasePrompt,
    customAppend: roleAppend ?? undefined,
    dynamicReminder:
      loadedSkills.length > 0 ? { loadedSkills } : skillManager.size > 0 ? { extra: skillIndexReminder } : undefined,
    environment: { cwd: process.cwd() },
    mode: mode as ChatMode,
    yoloOverlay: yolo,
  });

  const maxToolRounds = agent?.steps ?? config.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
  const allowedTools = agent?.allowedTools;
  const agentModel = agent?.model;

  return {
    allowedTools,
    loadedSkills,
    maxToolRounds,
    modelId: agentModel?.modelID,
    providerId: agentModel?.providerID,
    systemPrompt,
    temperature: agent?.temperature,
    topP: agent?.topP,
  };
}
