/**
 * 自定义 Agent 加载器 — 从 JSON 文件加载/持久化自定义 Agent。
 *
 * 兼容原有的 roles.json 配置文件格式。
 */
import { z } from "zod";
import { createLogger } from "@/core/logging/logger";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentInfo, AgentMode } from "@/agent";
import { iconAgent } from "@/core/icons/icon";
import { getGlobalCrabDir } from "../paths/paths";

/**
 * 延迟加载 @/agent 模块的运行时函数。
 * 避免顶层静态 import 产生 config → agent → config 循环依赖。
 */
async function getAgentModule() {
  return await import("@/agent");
}

/** 自定义 Agent 配置 */
export interface AgentConfig {
  /** Agent 唯一标识符 */
  id: string;
  /** Agent 名称 */
  name: string;
  /** 描述信息 */
  description?: string;
  /** 系统提示词 */
  systemPrompt?: string;
  /** 可用工具列表 */
  availableTools?: string[];
  /** 权限规则集 */
  permission?: import("@/schema/permission").PermissionRuleset;
  /** 绑定的模型配置 */
  model?: { providerID: string; modelID: string };
  /** 图标标识 */
  icon?: string;
  /** 显示颜色 */
  color?: string;
  /** 是否在 Agent Picker 中隐藏 */
  hidden?: boolean;
  /** 标签列表 */
  tags?: string[];
  /** 执行模式 */
  mode?: AgentMode;
  /** 最大执行步数 */
  maxSteps?: number;
  /** 偏好 Skill 列表 */
  preferredSkills?: string[];
  /** 温度参数 */
  temperature?: number;
  /** TopP 参数 */
  topP?: number;
}

const log = createLogger("agent:customLoader");

// ─── 兼容的配置文件格式(与旧 roles.json 一致)─────────────────

const modelSchema = z.object({
  modelID: z.string().min(1),
  providerID: z.string().min(1),
});

export const agentConfigSchema = z.object({
  availableTools: z.array(z.string()).optional(),
  color: z.string().optional(),
  description: z.string().optional(),
  hidden: z.boolean().optional(),
  icon: z.string().optional(),
  id: z.string().min(1, "不能为空"),
  maxSteps: z.number().int().positive().optional(),
  mode: z.enum(["primary", "subagent", "all"]).optional(),
  model: modelSchema.optional(),
  name: z.string().min(1, "不能为空"),
  permission: z.any().optional(),
  systemPrompt: z.string().optional(),
  tags: z.array(z.string()).optional(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
});

export function validateAgentConfig(data: unknown): { ok: true; config: AgentConfig } | { ok: false; error: string } {
  const result = agentConfigSchema.safeParse(data);
  if (result.success) {
    return { config: result.data as AgentConfig, ok: true };
  }
  const firstError = result.error.issues[0];
  const msg = firstError ? `${firstError.path.join(".")}: ${firstError.message}` : "错误";
  return { error: msg, ok: false };
}

export function parseAgentConfigs(data: unknown): AgentConfig[] {
  if (!data || typeof data !== "object") {
    return [];
  }

  if (Array.isArray(data)) {
    return data.filter(isValidAgentConfig);
  }

  const obj = data as Record<string, unknown>;
  if (Array.isArray(obj.roles)) {
    return obj.roles.filter(isValidAgentConfig);
  }

  return [];
}

function isValidAgentConfig(item: unknown): item is AgentConfig {
  const result = validateAgentConfig(item);
  if (!result.ok) {
    log.warn(`Agent 配置验证失败: ${result.error}`);
    return false;
  }
  return true;
}

/** 将 AgentConfig 转换为 AgentInfo */
export function configToAgent(cfg: AgentConfig): AgentInfo {
  return {
    allowedTools: cfg.availableTools,
    color: cfg.color,
    description: cfg.description ?? cfg.name,
    hidden: cfg.hidden,
    icon: cfg.icon ?? iconAgent,
    id: cfg.id,
    label: cfg.name,
    mode: cfg.mode ?? "primary",
    model: cfg.model,
    name: cfg.id,
    options: { custom: true },
    permissions: cfg.permission,
    preferredSkills: cfg.preferredSkills,
    prompt: cfg.systemPrompt ?? `你是一位${cfg.name}。`,
    steps: cfg.maxSteps,
    tags: cfg.tags,
    temperature: cfg.temperature,
    topP: cfg.topP,
  };
}

/** 将 AgentInfo 转换回 AgentConfig(用于持久化) */
export function agentToConfig(agent: AgentInfo): AgentConfig {
  return {
    availableTools: agent.allowedTools,
    color: agent.color,
    description: agent.description,
    hidden: agent.hidden,
    icon: agent.icon,
    id: agent.id ?? agent.name,
    maxSteps: agent.steps,
    mode: agent.mode,
    model: agent.model,
    name: agent.label,
    permission: agent.permissions,
    preferredSkills: agent.preferredSkills,
    systemPrompt: agent.customSystemPrompt ?? agent.prompt,
    tags: agent.tags,
    temperature: agent.temperature,
    topP: agent.topP,
  };
}

// ─── 文件加载 ─────────────────────────────────────────────────

export function loadAgentsFromFile(filePath: string): AgentInfo[] {
  try {
    if (!existsSync(filePath)) {
      return [];
    }

    const content = readFileSync(filePath, "utf8");
    if (!content.trim()) {
      return [];
    }

    const data = JSON.parse(content);
    const configs = parseAgentConfigs(data);
    const agents = configs.map(configToAgent);

    log.info(`从 ${filePath} 加载了 ${agents.length} 个自定义 Agent`);
    return agents;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.warn(`加载 Agent 配置失败: ${filePath}: ${msg}`);
    return [];
  }
}

export function loadAllCustomAgents(projectDir?: string): AgentInfo[] {
  const globalPath = join(getGlobalCrabDir(), "roles.json");
  const globalAgents = loadAgentsFromFile(globalPath);

  let projectAgents: AgentInfo[] = [];
  if (projectDir) {
    const projectPath = join(projectDir, ".crab", "roles.json");
    projectAgents = loadAgentsFromFile(projectPath);
  }

  const merged = new Map<string, AgentInfo>();
  for (const agent of globalAgents) {
    merged.set(agent.name, agent);
  }
  for (const agent of projectAgents) {
    merged.set(agent.name, agent);
  }

  return [...merged.values()];
}

export function saveAgentsToFile(filePath: string, configs: AgentConfig[]): boolean {
  try {
    const dir = filePath.substring(0, filePath.lastIndexOf("/"));
    mkdirSync(dir, { recursive: true });

    writeFileSync(filePath, JSON.stringify(configs, null, 2), "utf8");
    log.info(`保存了 ${configs.length} 个 Agent 到 ${filePath}`);
    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error(`保存 Agent 配置失败: ${filePath}: ${msg}`);
    return false;
  }
}

// ─── CRUD ──────────────────────────────────────────────────────

export async function createCustomAgent(
  config: AgentConfig,
  filePath: string,
): Promise<{ ok: true; agent: AgentInfo } | { ok: false; error: string }> {
  const validation = validateAgentConfig(config);
  if (!validation.ok) {
    return { error: validation.error, ok: false };
  }

  const agent = configToAgent(config);

  try {
    const { registerAgent } = await getAgentModule();
    registerAgent(agent);
  } catch (error) {
    log.warn(`注册自定义 Agent 到运行时失败: ${String(error)}`);
  }

  const existing = loadAgentsFromFile(filePath);
  const updated = existing.filter((a) => (a.id ?? a.name) !== config.id);
  updated.push(agent);
  const configs = updated.map(agentToConfig);
  saveAgentsToFile(filePath, configs);

  log.info(`自定义 Agent 已创建: ${config.id}`);
  return { agent, ok: true };
}

export async function updateCustomAgent(
  agentId: string,
  updates: Partial<AgentConfig>,
  filePath: string,
): Promise<{ ok: true; agent: AgentInfo } | { ok: false; error: string }> {
  const { getAgent } = await getAgentModule();
  const existing = getAgent(agentId);
  if (!existing) {
    return { error: `Agent 不存在: ${agentId}`, ok: false };
  }
  if (existing.native) {
    return { error: `内置 Agent 不允许修改: ${agentId}`, ok: false };
  }

  const merged: AgentConfig = {
    availableTools: updates.availableTools ?? existing.allowedTools,
    color: updates.color ?? existing.color,
    description: updates.description ?? existing.description,
    hidden: updates.hidden ?? existing.hidden,
    icon: updates.icon ?? existing.icon,
    id: existing.id ?? existing.name,
    maxSteps: updates.maxSteps ?? existing.steps,
    mode: updates.mode ?? existing.mode,
    model: updates.model ?? existing.model,
    name: updates.name ?? existing.label,
    permission: updates.permission ?? existing.permissions,
    preferredSkills: updates.preferredSkills ?? existing.preferredSkills,
    systemPrompt: updates.systemPrompt ?? existing.customSystemPrompt ?? existing.prompt,
    tags: updates.tags ?? existing.tags,
    temperature: updates.temperature ?? existing.temperature,
    topP: updates.topP ?? existing.topP,
  };

  return createCustomAgent(merged, filePath);
}

export async function deleteCustomAgent(
  agentId: string,
  filePath: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { getAgent } = await getAgentModule();
  const existing = getAgent(agentId);
  if (!existing) {
    return { error: `Agent 不存在: ${agentId}`, ok: false };
  }
  if (existing.native) {
    return { error: `内置 Agent 不允许删除: ${agentId}`, ok: false };
  }

  try {
    const { unregisterAgent } = await getAgentModule();
    unregisterAgent(agentId);
  } catch (error) {
    log.warn(`注销自定义 Agent 失败: ${String(error)}`);
  }

  const agents = loadAgentsFromFile(filePath);
  const filtered = agents.filter((a) => (a.id ?? a.name) !== agentId);
  const configs = filtered.map(agentToConfig);
  saveAgentsToFile(filePath, configs);

  log.info(`自定义 Agent 已删除: ${agentId}`);
  return { ok: true };
}

export function getDefaultAgentsPath(projectDir?: string): string {
  if (projectDir) {
    return join(projectDir, ".crab", "roles.json");
  }
  return join(getGlobalCrabDir(), "roles.json");
}
