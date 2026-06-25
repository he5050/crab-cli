/**
 * 对话会话状态 — 对话级别的只读配置、动态提醒、工具白名单解析。
 *
 * 职责:
 *   - 集中获取当前会话相关的只读状态(模式、白名单、动态提醒等)
 *   - 为 ConversationHandler 拆分出的子模块提供共享状态查询
 *
 * 模块功能:
 *   - 模式与白名单查询
 *   - 动态 reminder 文本构建
 *   - 外部工具引用解析辅助
 *
 * 使用场景:
 *   - ConversationHandler 在循环中按需查询当前模式/工具状态
 *   - LLM Loop 注入 reminder 与工具可见性
 *
 * 边界:
 *   1. 仅查询与构造，不直接修改 prompt 或工具
 *   2. 不持久化会话状态
 */
import { type ChatMode, isReadOnlyMode } from "@/agent/prompt/modes";
import { buildDynamicReminder } from "@/agent/prompt/builder";
import {
  getRegisteredTools,
  getToolsForAiSdk,
  getToolsForAiSdkByNames,
  isMcpToolNameDisabled,
} from "@/tool/registry/toolRegistry";
import {
  type ExternalToolResolution,
  resolveExplicitExternalToolReference,
  resolveExternalToolName,
} from "@/tool/registry/externalToolResolver";
import type { LlmToolSchema } from "@/conversation/type";

export const READ_ONLY_MODE_TOOLS = [
  "filesystem-read",
  "glob",
  "grep",
  "codebase-search",
  "lsp",
  "ide-diagnostics",
  "deepwiki-read-structure",
  "deepwiki-read-contents",
  "deepwiki-ask-question",
  "context7-resolve-library-id",
  "context7-query-docs",
];

export interface ConversationSessionState {
  allowedTools?: string[];
  mode?: ChatMode;
  sessionAllowedExternalTools: string[];
  sessionDiscoveredSkills: string[];
  sessionActiveSkills: string[];
  sessionLoadedSkills: string[];
}

type MutableSessionCollections = Pick<
  ConversationSessionState,
  "sessionAllowedExternalTools" | "sessionDiscoveredSkills" | "sessionActiveSkills" | "sessionLoadedSkills"
>;

function ensureSessionCollections<T extends Partial<ConversationSessionState>>(
  state: T,
): T & MutableSessionCollections {
  const mutable = state as T & MutableSessionCollections;
  mutable.sessionAllowedExternalTools ??= [];
  mutable.sessionDiscoveredSkills ??= [];
  mutable.sessionActiveSkills ??= [];
  mutable.sessionLoadedSkills ??= [];
  return mutable;
}

export function addSkillToSession(
  state: Pick<ConversationSessionState, "sessionDiscoveredSkills" | "sessionActiveSkills" | "sessionLoadedSkills">,
  bucket: "discovered" | "active" | "loaded",
  skillName: string,
): boolean {
  const normalized = ensureSessionCollections(state);
  const target =
    bucket === "discovered"
      ? normalized.sessionDiscoveredSkills
      : bucket === "active"
        ? normalized.sessionActiveSkills
        : normalized.sessionLoadedSkills;
  if (target.includes(skillName)) {
    return false;
  }
  target.push(skillName);
  return true;
}

export function enableSkillForSession(
  state: Pick<ConversationSessionState, "sessionActiveSkills">,
  skillName: string,
): boolean {
  const normalized = ensureSessionCollections(state);
  if (normalized.sessionActiveSkills.includes(skillName)) {
    return false;
  }
  normalized.sessionActiveSkills.push(skillName);
  return true;
}

export function getEffectiveAllowedTools(
  state: Pick<ConversationSessionState, "allowedTools" | "mode">,
): string[] | undefined {
  if (!state.mode || !isReadOnlyMode(state.mode)) {
    return state.allowedTools;
  }
  if (!state.allowedTools) {
    return READ_ONLY_MODE_TOOLS;
  }
  return state.allowedTools.filter((tool) => READ_ONLY_MODE_TOOLS.includes(tool));
}

export function getAllowedToolsForExecution(
  state: Pick<ConversationSessionState, "allowedTools" | "mode" | "sessionAllowedExternalTools">,
): string[] | undefined {
  const normalized = ensureSessionCollections(state);
  const names = getEffectiveAllowedTools(state);
  if (!names) {
    return undefined;
  }
  return [...new Set([...names, ...normalized.sessionAllowedExternalTools])];
}

export function getToolsForLlm(
  state: ConversationSessionState,
  additionalToolSchemas?: Record<string, { description: string; inputSchema: unknown }>,
): Record<string, LlmToolSchema> | undefined {
  const normalized = ensureSessionCollections(state);
  const names = getEffectiveAllowedTools(state);
  const base = names ? getToolsForAiSdkByNames(names) : getToolsForAiSdk();
  const externalTools = normalized.sessionAllowedExternalTools.length
    ? getToolsForAiSdkByNames(normalized.sessionAllowedExternalTools)
    : undefined;
  const visibleTools = externalTools ? { ...base, ...externalTools } : base;
  if (!additionalToolSchemas || Object.keys(additionalToolSchemas).length === 0) {
    return visibleTools;
  }
  return {
    ...visibleTools,
    ...additionalToolSchemas,
  };
}

export function enableExternalToolForSession(
  state: Pick<ConversationSessionState, "mode" | "sessionAllowedExternalTools">,
  query: string,
): ExternalToolResolution {
  const normalized = ensureSessionCollections(state);
  const resolution = resolveExternalToolName(query, getRegisteredTools());
  if (
    resolution.status === "unique" &&
    (!normalized.mode || !isReadOnlyMode(normalized.mode)) &&
    !isMcpToolNameDisabled(resolution.toolName) &&
    !normalized.sessionAllowedExternalTools.includes(resolution.toolName)
  ) {
    normalized.sessionAllowedExternalTools.push(resolution.toolName);
  }
  return resolution;
}

export function enableExplicitExternalToolsFromText(
  state: Pick<ConversationSessionState, "mode" | "sessionAllowedExternalTools">,
  input: string,
): string[] {
  const normalized = ensureSessionCollections(state);
  if (normalized.mode && isReadOnlyMode(normalized.mode)) {
    return [];
  }
  const refs = resolveExplicitExternalToolReference(input, getRegisteredTools());
  const enabled: string[] = [];
  for (const resolution of refs) {
    if (
      resolution.status === "unique" &&
      !isMcpToolNameDisabled(resolution.toolName) &&
      !normalized.sessionAllowedExternalTools.includes(resolution.toolName)
    ) {
      normalized.sessionAllowedExternalTools.push(resolution.toolName);
      enabled.push(resolution.toolName);
    }
  }
  return enabled;
}

export function enableExternalToolsFromDiscoveryResult(
  state: Pick<ConversationSessionState, "mode" | "sessionAllowedExternalTools">,
  output: unknown,
): string[] {
  const normalized = ensureSessionCollections(state);
  if (normalized.mode && isReadOnlyMode(normalized.mode)) {
    return [];
  }
  if (!isDiscoveryToolOutput(output)) {
    return [];
  }

  const tools = Array.isArray(output.tools) ? output.tools : [];
  const externalToolNames = tools
    .map((tool) => {
      if (!isDiscoveryToolItem(tool)) {
        return undefined;
      }
      if (tool.builtin === true || typeof tool.name !== "string") {
        return undefined;
      }
      return tool.name;
    })
    .filter((name): name is string => Boolean(name));

  const enabled: string[] = [];
  for (const toolName of new Set(externalToolNames)) {
    const resolution = enableExternalToolForSession(normalized, toolName);
    if (
      resolution.status === "unique" &&
      normalized.sessionAllowedExternalTools.includes(resolution.toolName) &&
      !enabled.includes(resolution.toolName)
    ) {
      enabled.push(resolution.toolName);
    }
  }

  return enabled;
}

/** Skills 工具返回值的类型守卫 */
interface SkillToolResult {
  success?: unknown;
  action?: string;
  skill?: { name?: unknown };
  skills?: unknown[];
  recommendations?: unknown[];
  explicitSkill?: { status?: unknown; skillName?: unknown };
}

function isSkillToolResult(output: unknown): output is SkillToolResult {
  if (!output || typeof output !== "object") {
    return false;
  }
  return (
    "skills" in output ||
    "recommendations" in output ||
    "explicitSkill" in output ||
    "skill" in output ||
    "action" in output
  );
}

/** 工具发现结果的类型守卫（替代 enableExternalToolsFromDiscoveryResult 中的 as 断言） */
interface DiscoveryToolOutput {
  tools?: unknown[];
}

interface DiscoveryToolItem {
  name?: unknown;
  builtin?: unknown;
}

function isDiscoveryToolOutput(output: unknown): output is DiscoveryToolOutput {
  if (!output || typeof output !== "object") {
    return false;
  }
  return "tools" in output;
}

function isDiscoveryToolItem(item: unknown): item is DiscoveryToolItem {
  if (!item || typeof item !== "object") {
    return false;
  }
  return "name" in item;
}

export function enableSkillsFromToolResult(
  state: Pick<ConversationSessionState, "sessionDiscoveredSkills" | "sessionActiveSkills" | "sessionLoadedSkills">,
  toolName: string,
  output: unknown,
): { discovered: string[]; active: string[]; loaded: string[] } {
  const empty = { active: [] as string[], discovered: [] as string[], loaded: [] as string[] };
  if (toolName !== "skills") {
    return empty;
  }
  if (!isSkillToolResult(output)) {
    return empty;
  }
  const { action, skill, skills, recommendations, explicitSkill, success } = output;
  if (success !== true) {
    return empty;
  }

  const actionStr = typeof action === "string" ? action : "";
  const candidates: string[] = [];
  if (Array.isArray(skills)) {
    for (const item of skills) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const { name } = item as { name?: unknown };
      if (typeof name === "string") {
        candidates.push(name);
      }
    }
  }
  if (Array.isArray(recommendations)) {
    for (const item of recommendations) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const { name } = item as { name?: unknown };
      if (typeof name === "string") {
        candidates.push(name);
      }
    }
  }
  if (explicitSkill && typeof explicitSkill === "object") {
    const explicit = explicitSkill as { status?: unknown; skillName?: unknown };
    if (explicit.status === "unique" && typeof explicit.skillName === "string") {
      candidates.push(explicit.skillName);
    }
  }
  if (skill && typeof skill === "object") {
    const { name } = skill as { name?: unknown };
    if (typeof name === "string") {
      candidates.push(name);
    }
  }
  if (actionStr === "execute") {
    const { skillName } = output as { skillName?: unknown };
    if (typeof skillName === "string") {
      candidates.push(skillName);
    }
  }

  const enabled = { active: [] as string[], discovered: [] as string[], loaded: [] as string[] };
  for (const name of new Set(candidates)) {
    if (actionStr === "recommend" || actionStr === "search" || actionStr === "list") {
      if (addSkillToSession(state, "discovered", name)) {
        enabled.discovered.push(name);
      }
    } else if (actionStr === "info") {
      if (addSkillToSession(state, "active", name)) {
        enabled.active.push(name);
      }
    } else if (actionStr === "execute") {
      if (addSkillToSession(state, "active", name)) {
        enabled.active.push(name);
      }
      if (addSkillToSession(state, "loaded", name)) {
        enabled.loaded.push(name);
      }
    } else {
      if (addSkillToSession(state, "discovered", name)) {
        enabled.discovered.push(name);
      }
    }
  }
  return enabled;
}

export function buildSessionDynamicReminder(
  state: Pick<
    ConversationSessionState,
    "sessionDiscoveredSkills" | "sessionActiveSkills" | "sessionLoadedSkills" | "sessionAllowedExternalTools"
  >,
): string | undefined {
  const hasSessionContext =
    state.sessionDiscoveredSkills.length > 0 ||
    state.sessionActiveSkills.length > 0 ||
    state.sessionLoadedSkills.length > 0 ||
    state.sessionAllowedExternalTools.length > 0;
  if (!hasSessionContext) {
    return undefined;
  }

  return buildDynamicReminder({
    activeSkills: state.sessionActiveSkills,
    discoveredSkills: state.sessionDiscoveredSkills,
    externalTools: state.sessionAllowedExternalTools,
    extra: [
      "Skill 状态含义:已发现=recommend/search/list 候选，不代表正文已加载；已激活=显式指定或 info 读取；已加载=execute 已生成完整 prompt。",
      "已发现的 Skills 后续不需要重复 recommend/search；如需完整指令，直接调用 skills info/execute。",
      "当前会话已启用的外部工具已进入下一轮 tools schema，但实际执行仍会走工具权限检查。",
    ].join("\n"),
    loadedSkills: state.sessionLoadedSkills,
  });
}
