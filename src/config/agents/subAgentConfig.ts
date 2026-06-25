/**
 * 子代理配置 — 管理内置和自定义子代理。
 *
 * 职责:
 *   - 管理内置子代理定义
 *   - 管理用户自定义子代理
 *   - 提供子代理 CRUD 操作
 *   - 子代理数据验证
 *
 * 模块功能:
 *   - getBuiltinAgents: 获取内置子代理列表
 *   - getUserSubAgents: 获取用户自定义子代理列表
 *   - getSubAgents: 获取所有子代理(内置 + 用户自定义)
 *   - getSubAgent: 按 ID 获取子代理
 *   - createSubAgent: 创建新的自定义子代理
 *   - updateSubAgent: 更新子代理
 *   - deleteSubAgent: 删除子代理
 *   - validateSubAgent: 验证子代理数据
 *   - SubAgent: 子代理定义接口
 *   - SubAgentsConfig: 子代理配置结构
 *
 * 使用场景:
 *   - 子代理管理界面
 *   - 子代理选择器
 *   - 自定义子代理创建
 *
 * 边界:
 *   1. 配置目录: ~/.crab/
 *   2. 用户自定义优先级高于内置
 *   3. 内置代理不可删除，只可覆盖
 *   4. 配置存储在 sub-agents.json
 *
 * 流程:
 *   1. 加载内置代理定义
 *   2. 加载用户自定义代理
 *   3. 合并并去重(用户优先)
 *   4. 提供 CRUD 操作
 *   5. 保存时仅保存用户自定义代理
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "@/core/logging/logger";
import { getGlobalCrabDir } from "../paths/paths";
import { listBuiltinAgentDefinitions } from "./agentDefinitions";
import { createInternalError } from "@/core/errors/appError";
import { readJsonFile, writeJsonFile } from "@/core/utilities/fileUtils";
import { agentId } from "@/core/id";

const log = createLogger("config:sub-agent");

/** 子代理定义 */
export interface SubAgent {
  id: string;
  name: string;
  description: string;
  systemPrompt?: string;
  tools?: string[];
  role?: string;
  responsibility?: string;
  capabilities?: string[];
  boundaries?: string[];
  deniedTools?: string[];
  outputContract?: string;
  readOnly?: boolean;
  createdAt?: string;
  updatedAt?: string;
  builtin?: boolean;
  configProfile?: string;
  customSystemPrompt?: string;
  customHeaders?: Record<string, string>;
}

/** 子代理配置结构 */
export interface SubAgentsConfig {
  agents: SubAgent[];
}

const CONFIG_DIR = getGlobalCrabDir();
const SUB_AGENTS_CONFIG_FILE = join(CONFIG_DIR, "sub-agents.json");

/**
 * 获取内置子代理列表。
 * 动态构建以确保工具启用/禁用变更立即反映。
 */
function getBuiltinAgents(): SubAgent[] {
  return listBuiltinAgentDefinitions().map((agent) => ({
    boundaries: agent.boundaries,
    builtin: true,
    capabilities: agent.capabilities,
    createdAt: "2024-01-01T00:00:00.000Z",
    deniedTools: agent.deniedTools,
    description: agent.description,
    id: agent.name,
    name: agent.displayName,
    outputContract: agent.outputContract,
    readOnly: agent.readOnly,
    responsibility: agent.responsibility,
    role: agent.name,
    systemPrompt: agent.systemPrompt,
    tools: agent.defaultTools,
    updatedAt: "2024-01-01T00:00:00.000Z",
  }));
}

/** 确保配置目录存在 */
function ensureConfigDirectory(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/** 生成唯一 ID */
function generateId(): string {
  return agentId();
}

/**
 * 获取用户自定义子代理列表。
 */
export async function getUserSubAgents(): Promise<SubAgent[]> {
  try {
    ensureConfigDirectory();
    if (!existsSync(SUB_AGENTS_CONFIG_FILE)) {
      return [];
    }

    const config = (await readJsonFile(SUB_AGENTS_CONFIG_FILE)) as SubAgentsConfig | null;
    return config?.agents || [];
  } catch (error) {
    log.warn(`加载子代理配置失败: ${String(error)}`);
    return [];
  }
}

/**
 * 获取所有子代理(内置 + 用户自定义)。
 * 用户自定义优先级高于内置。
 */
export async function getSubAgents(): Promise<SubAgent[]> {
  const userAgents = await getUserSubAgents();
  const userAgentIds = new Set(userAgents.map((a) => a.id));
  const builtinAgents = getBuiltinAgents();

  // 过滤掉已被用户覆盖的内置代理
  const effectiveBuiltinAgents = builtinAgents.filter((agent) => !userAgentIds.has(agent.id));

  return [...effectiveBuiltinAgents, ...userAgents];
}

/**
 * 按 ID 获取子代理。
 */
export async function getSubAgent(id: string): Promise<SubAgent | null> {
  const agents = await getSubAgents();
  return agents.find((agent) => agent.id === id) || null;
}

/**
 * 保存用户自定义子代理(不保存内置代理)。
 */
async function saveSubAgents(agents: SubAgent[]): Promise<void> {
  try {
    ensureConfigDirectory();
    const userAgents = agents.filter((agent) => !agent.builtin);
    const config: SubAgentsConfig = { agents: userAgents };
    await writeJsonFile(SUB_AGENTS_CONFIG_FILE, config);
  } catch (error) {
    throw createInternalError("INTERNAL_ERROR", `保存子代理配置失败: ${error}`);
  }
}

/**
 * 创建新的自定义子代理。
 */
export async function createSubAgent(
  name: string,
  description: string,
  tools: string[],
  role?: string,
  configProfile?: string,
  customSystemPrompt?: string,
  customHeaders?: Record<string, string>,
): Promise<SubAgent> {
  const userAgents = await getUserSubAgents();
  const now = new Date().toISOString();

  const newAgent: SubAgent = {
    builtin: false,
    configProfile,
    createdAt: now,
    customHeaders,
    customSystemPrompt,
    description,
    id: generateId(),
    name,
    role,
    tools,
    updatedAt: now,
  };

  userAgents.push(newAgent);
  try {
    await saveSubAgents(userAgents);
  } catch (error) {
    log.error(`创建子代理持久化失败: ${String(error)}`);
  }

  return newAgent;
}

/**
 * 更新子代理。
 * 内置代理:创建/更新用户副本(覆盖)。
 * 自定义代理:直接更新。
 */
export async function updateSubAgent(
  id: string,
  updates: {
    name?: string;
    description?: string;
    role?: string;
    tools?: string[];
    configProfile?: string;
    customSystemPrompt?: string;
    customHeaders?: Record<string, string>;
  },
): Promise<SubAgent | null> {
  const agent = await getSubAgent(id);
  if (!agent) {
    return null;
  }

  const userAgents = await getUserSubAgents();
  const existingUserIndex = userAgents.findIndex((a) => a.id === id);

  if (agent.builtin) {
    const existingUserCopy = existingUserIndex !== -1 ? userAgents[existingUserIndex] : null;

    const userCopy: SubAgent = {
      builtin: false,
      configProfile: "configProfile" in updates ? updates.configProfile : existingUserCopy?.configProfile,
      createdAt: agent.createdAt || new Date().toISOString(),
      customHeaders: "customHeaders" in updates ? updates.customHeaders : existingUserCopy?.customHeaders,
      customSystemPrompt:
        "customSystemPrompt" in updates ? updates.customSystemPrompt : existingUserCopy?.customSystemPrompt,
      description: updates.description ?? agent.description,
      id: agent.id,
      name: updates.name ?? agent.name,
      role: updates.role ?? agent.role,
      tools: updates.tools ?? agent.tools,
      updatedAt: new Date().toISOString(),
    };

    if (existingUserIndex !== -1) {
      userAgents[existingUserIndex] = userCopy;
    } else {
      userAgents.push(userCopy);
    }

    try {
      await saveSubAgents(userAgents);
    } catch (error) {
      log.error(`更新内置子代理持久化失败: ${String(error)}`);
    }
    return userCopy;
  }

  if (existingUserIndex === -1) {
    return null;
  }

  const existingAgent = userAgents[existingUserIndex]!;
  const updatedAgent: SubAgent = {
    builtin: false,
    configProfile: "configProfile" in updates ? updates.configProfile : existingAgent.configProfile,
    createdAt: existingAgent.createdAt,
    customHeaders: "customHeaders" in updates ? updates.customHeaders : existingAgent.customHeaders,
    customSystemPrompt: "customSystemPrompt" in updates ? updates.customSystemPrompt : existingAgent.customSystemPrompt,
    description: updates.description ?? existingAgent.description,
    id: existingAgent.id,
    name: updates.name ?? existingAgent.name,
    role: updates.role ?? existingAgent.role,
    tools: updates.tools ?? existingAgent.tools,
    updatedAt: new Date().toISOString(),
  };

  userAgents[existingUserIndex] = updatedAgent;
  try {
    await saveSubAgents(userAgents);
  } catch (error) {
    log.error(`更新自定义子代理持久化失败: ${String(error)}`);
  }
  return updatedAgent;
}

/**
 * 删除子代理。
 * 内置代理:移除用户覆盖(恢复默认)。
 * 自定义代理:永久删除。
 */
export async function deleteSubAgent(id: string): Promise<boolean> {
  const userAgents = await getUserSubAgents();
  const filteredAgents = userAgents.filter((agent) => agent.id !== id);

  if (filteredAgents.length === userAgents.length) {
    return false;
  }

  try {
    await saveSubAgents(filteredAgents);
  } catch (error) {
    log.error(`删除子代理持久化失败: ${String(error)}`);
  }
  return true;
}

/**
 * 验证子代理数据。
 */
export function validateSubAgent(data: { name: string; description: string; tools: string[] }): string[] {
  const errors: string[] = [];

  if (!data.name || data.name.trim().length === 0) {
    errors.push("Agent 名称不能为空");
  }
  if (data.name && data.name.length > 100) {
    errors.push("Agent 名称不能超过 100 个字符");
  }
  if (data.description && data.description.length > 500) {
    errors.push("描述不能超过 500 个字符");
  }
  if (!data.tools || data.tools.length === 0) {
    errors.push("至少需要选择一个工具");
  }

  return errors;
}
