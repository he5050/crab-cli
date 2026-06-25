/**
 * 会话上下文统计 — 估算 systemPrompt/历史/工具的 token 用量。
 *
 * 职责:
 *   - 聚合会话侧栏展示的 token 估算与拆分
 *   - 提供可注入的数据源(用于测试)
 */
import { getDefaultPermissions } from "@/config";
import { type InstructionFile, loadInstructionFilesSync } from "@/agent/prompt/context";
import type { AppConfigSchema } from "@/schema/config";
import { getToolsForAiSdk } from "@/tool/registry/toolRegistry";
import { estimateTokens } from "@/session/token/tokenCounterRef";
import type { ContextStats } from "@/ui/pages/session/components/sidebar";

interface PermissionRuleLike {
  permission: string;
  pattern: string;
  action: string;
}

export interface SessionContextStatsSources {
  cwd?: string;
  loadInstructionFiles?: (cwd?: string) => InstructionFile[];
  getToolNames?: () => string[];
  getDefaultPermissionRules?: () => PermissionRuleLike[];
}

function collectPromptText(config: AppConfigSchema, instructions: InstructionFile[]): string[] {
  const texts = instructions.map((item) => item.content);
  if (config.customSystemPrompt?.trim()) {
    texts.push(config.customSystemPrompt);
  }
  if (config.systemPrompt?.trim()) {
    texts.push(config.systemPrompt);
  }
  for (const provider of Object.values(config.providerConfig ?? {})) {
    if (provider.systemPrompt?.trim()) {
      texts.push(provider.systemPrompt);
    }
  }
  for (const agent of config.agents ?? []) {
    if (agent.prompt?.trim()) {
      texts.push(agent.prompt);
    }
  }
  return texts;
}

export function buildSessionContextStats(
  config: AppConfigSchema,
  sources: SessionContextStatsSources = {},
): ContextStats | undefined {
  const instructions = (sources.loadInstructionFiles ?? loadInstructionFilesSync)(sources.cwd);
  const toolNames = sources.getToolNames ?? (() => Object.keys(getToolsForAiSdk()));
  const defaultRules = sources.getDefaultPermissionRules ?? getDefaultPermissions;
  const instructionFiles = instructions.length;
  const toolCount = toolNames().length;
  const ruleCount = defaultRules().length + (config.permissions?.length ?? 0);
  const estimatedTokens = collectPromptText(config, instructions).reduce(
    (total, text) => total + estimateTokens(text),
    0,
  );

  if (instructionFiles === 0 && toolCount === 0 && ruleCount === 0 && estimatedTokens === 0) {
    return undefined;
  }

  return {
    estimatedTokens: estimatedTokens > 0 ? estimatedTokens : undefined,
    instructionFiles,
    ruleCount,
    toolCount,
  };
}
