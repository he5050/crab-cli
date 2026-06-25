/**
 * Prompt Registry — 统一系统提示词生成入口。
 *
 * Phase 1 目标:固定基础 section 顺序，并保留后续 agent prompt 注入扩展点。
 */
import { type PromptBuilderOptions, buildSystemPrompt } from "./builder";
import { type AgentPromptContract, buildAgentContractSection } from "./sections/agentContract";
import { buildBaseBehaviorSection } from "./sections/baseBehavior";
import { buildOutputStyleSection } from "./sections/outputStyle";
import { buildToolPolicySection } from "./sections/toolPolicy";

/** Prompt Registry 构建选项。 */
export interface PromptRegistryOptions extends PromptBuilderOptions {
  /** 后续阶段用于按 agent 注入职责契约。 */
  agentPrompt?: AgentPromptContract;
}

/** Section 名称标识 */
const ENVIRONMENT_SECTION_NAME = "environment";
const PROJECT_INSTRUCTIONS_SECTION_NAME = "project-instructions";

const PROMPT_SECTION_NAMES = [
  "base-behavior",
  "tool-policy",
  ENVIRONMENT_SECTION_NAME,
  PROJECT_INSTRUCTIONS_SECTION_NAME,
  "output-style",
  "agent-contract",
] as const;

/** 返回 registry 管理的稳定 section 名称。 */
export function listPromptSectionNames(): string[] {
  return [...PROMPT_SECTION_NAMES];
}

/**
 * 通过 Prompt Registry 构建系统提示词。
 */
export function buildPromptFromRegistry(options: PromptRegistryOptions): string {
  const baseSections = [
    options.basePrompt,
    buildBaseBehaviorSection(),
    buildToolPolicySection(),
    buildOutputStyleSection(),
    buildAgentContractSection(options.agentPrompt),
  ].filter(Boolean);

  return buildSystemPrompt({
    ...options,
    basePrompt: baseSections.join("\n\n"),
  });
}

export type { AgentPromptContract } from "./sections/agentContract";
