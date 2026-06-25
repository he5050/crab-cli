/**
 * Agent Manager — Agent 注册、查询、生命周期管理。
 *
 * 职责:
 *   - 管理内置和自定义 Agent 的注册表
 *   - 提供按名称/模式查询 Agent
 *   - 管理 Agent 状态(idle/thinking/running/completed/error)
 *   - 发布 Agent 相关 EventBus 事件
 *   - 管理活跃 Agent 的切换
 */
import type { AgentMode as AgentModeType, PermissionRuleset } from "@/schema";
import { agentEvents } from "@/agent/core/agentEvents";
import { createLogger } from "@/core/logging/logger";
import { listAllBuiltinAgentDefinitions } from "@/agent/core/definition";

const log = createLogger("agent:manager");

/**
 * Agent 执行模式 — 运行时使用。
 *
 * 与 @/schema/agent 的 AgentMode ("primary"|"subagent"|"all") 保持一致，
 * 与 @/config/agents/agentDefinitions 的 AgentMode ("primary"|"subagent"|"hidden") 不同：
 *   - schema/agent 用于用户配置文件验证
 *   - agentDefinitions 用于内置 Agent 定义（hidden 在初始化时被 resolveAgentMode 映射为 subagent）
 */
export type AgentMode = AgentModeType;

/** Agent 运行状态 */
export type AgentStatus = "idle" | "thinking" | "running" | "completed" | "error";

/** Agent 模型配置 */
export interface AgentModel {
  /** 模型提供商 ID */
  providerID: string;
  /** 模型 ID */
  modelID: string;
}

/** Agent 完整定义 */
export interface AgentInfo {
  /** 唯一名称标识 */
  name: string;
  /** 显示标签 */
  label: string;
  /** 详细描述 */
  description: string;
  /** 执行模式 */
  mode: AgentMode;
  /** 系统提示词 */
  prompt: string;
  /** 绑定模型(不传则使用全局默认) */
  model?: AgentModel;
  /** 权限规则集(不传则使用全局默认) */
  permissions?: PermissionRuleset;
  /** 允许使用的工具名白名单(不传则允许所有) */
  allowedTools?: string[];
  /** 自定义选项(透传给 LLM providerOptions) */
  options: Record<string, unknown>;
  /** 是否为内置 Agent */
  native?: boolean;
  /** 是否在 Agent Picker 中隐藏 */
  hidden?: boolean;
  /** 自定义温度 */
  temperature?: number;
  /** 自定义 topP */
  topP?: number;
  /** 最大工具调用步数(不传则使用全局默认 maxToolRounds) */
  steps?: number;
  /** 显示颜色 */
  color?: string;
  /** 配置 profile 名称(用于指定不同 Agent 使用不同 API 配置/模型) */
  configProfile?: string;
  /** 自定义系统提示词覆盖(优先于 prompt) */
  customSystemPrompt?: string;
  /** 自定义请求头 */
  customHeaders?: Record<string, string>;
  /** 创建时间 */
  createdAt?: string;
  /** 更新时间 */
  updatedAt?: string;
  /** Agent 唯一标识符(默认等于 name) */
  id?: string;
  /** Emoji 图标 */
  icon?: string;
  /** 标签列表 */
  tags?: string[];
  /** 匹配关键词(用于子代理解析器快速匹配) */
  keywords?: string[];
  /** 偏好 Skill 列表(激活时推荐加载) */
  preferredSkills?: string[];
}

const agentRegistry = new Map<string, AgentInfo>();
/** 未初始化哨兵: null 表示"尚未读取 config, 应走懒初始化" */
let activeAgentName: string | null = null;
const agentStatusMap = new Map<string, AgentStatus>();
let builtinInitialized = false;

/** 默认活跃 Agent 名称(从 schema.config.defaultAgent 推导). */
const DEFAULT_ACTIVE_AGENT_NAME = "general";

/** 最大注册 Agent 数量上限 */
const MAX_REGISTERED_AGENTS = 100;

/** 懒解析: 首次访问时若未初始化, 设为默认值. */
function resolveActiveAgentName(): string {
  if (activeAgentName === null) {
    // 懒初始化: 未来可在此处读 config.defaultAgent.
    // 当前架构 config 由 initBuiltinAgents 加载, 此函数可能被早期调用;
    // 因此使用常量默认, 避免循环依赖.
    activeAgentName = DEFAULT_ACTIVE_AGENT_NAME;
  }
  return activeAgentName;
}

/** 注册一个 Agent */
export function registerAgent(agent: AgentInfo): void {
  if (!agent.name) {
    log.warn("注册 Agent 失败: name 不能为空");
    return;
  }
  if (agentRegistry.size >= MAX_REGISTERED_AGENTS) {
    log.warn(`注册 Agent 失败: 注册表已满 (${MAX_REGISTERED_AGENTS})`);
    return;
  }
  agentRegistry.set(agent.name, agent);
  agentStatusMap.set(agent.name, "idle");
  log.info(`Agent 已注册: ${agent.name} (mode=${agent.mode})`);
}

/** 批量注册 Agent */
export function registerAgents(agents: AgentInfo[]): void {
  for (const agent of agents) {
    registerAgent(agent);
  }
}

/** 注销一个 Agent */
export function unregisterAgent(name: string): boolean {
  const deleted = agentRegistry.delete(name);
  agentStatusMap.delete(name);
  if (resolveActiveAgentName() === name) {
    activeAgentName = DEFAULT_ACTIVE_AGENT_NAME;
  }
  if (deleted) {
    log.info(`Agent 已注销: ${name}`);
  }
  return deleted;
}

/** 按名称获取 Agent 定义 */
export function getAgent(name: string): AgentInfo | undefined {
  return agentRegistry.get(name);
}

/** 获取所有已注册 Agent */
export function listAgents(): AgentInfo[] {
  return [...agentRegistry.values()];
}

/** 按模式过滤 Agent */
export function listAgentsByMode(mode: AgentMode): AgentInfo[] {
  return listAgents().filter((a) => {
    if (mode === "all") {
      return true;
    }
    if (a.mode === "all") {
      return true;
    }
    return a.mode === mode;
  });
}

/** 获取主 Agent 列表 */
export function listPrimaryAgents(): AgentInfo[] {
  return listAgents()
    .filter((a) => (a.mode === "primary" || a.mode === "all") && !a.hidden)
    .toSorted((a, b) => {
      if (a.name === activeAgentName) {
        return -1;
      }
      if (b.name === activeAgentName) {
        return 1;
      }
      return a.name.localeCompare(b.name);
    });
}

/** 获取子代理列表 */
export function listSubagents(): AgentInfo[] {
  return listAgents().filter((a) => a.mode === "subagent" || a.mode === "all");
}

/** 检查 Agent 是否存在 */
export function hasAgent(name: string): boolean {
  return agentRegistry.has(name);
}

/** 获取当前活跃 Agent 名称 */
export function getActiveAgentName(): string {
  return resolveActiveAgentName();
}

/** 获取当前活跃 Agent 定义 */
export function getActiveAgent(): AgentInfo | undefined {
  return agentRegistry.get(resolveActiveAgentName());
}

/** 设置活跃 Agent */
export function setActiveAgent(name: string): boolean {
  const agent = agentRegistry.get(name);
  if (!agent) {
    log.warn(`设置活跃 Agent 失败: ${name} 不存在`);
    agentEvents.toast({ message: `Agent "${name}" 不存在`, variant: "error" });
    return false;
  }
  const previous = resolveActiveAgentName();
  activeAgentName = name;
  log.info(`活跃 Agent 已切换: ${previous} → ${name}`);
  agentEvents.agentSelected({
    agentName: name,
    previousAgent: previous,
  });
  return true;
}

/** 获取 Agent 状态 */
export function getAgentStatus(name: string): AgentStatus {
  return agentStatusMap.get(name) ?? "idle";
}

/** 设置 Agent 状态 */
export function setAgentStatus(name: string, status: AgentStatus, reason?: string): boolean {
  const previous = getAgentStatus(name);
  if (previous === status) {
    return false;
  }
  agentStatusMap.set(name, status);
  log.debug(`Agent ${name} 状态变更: ${previous} → ${status}`);
  agentEvents.agentStatusChanged({
    agentName: name,
    previousStatus: previous,
    reason,
    status,
  });
  return true;
}

/** 重置所有 Agent 状态 */
export function resetAllAgentStatus(): void {
  for (const name of agentStatusMap.keys()) {
    agentStatusMap.set(name, "idle");
  }
}

/**
 * 将内置 Agent 定义(可能含 'hidden' mode)映射为 AgentInfo.mode(只含 'all' / 'primary' / 'subagent').
 *
 * 规则:
 *   - name === 'general' → 'all' (兼容历史命名, general agent 跨所有模式)
 *   - definition.mode === 'hidden' → 'subagent' (隐藏 agent 只能作为子代理)
 *   - 其它 → 原样透传
 */
const VALID_AGENT_MODES = new Set<AgentMode>(["primary", "subagent", "all"]);

function resolveAgentMode(definition: { name: string; mode: string }): AgentMode {
  if (definition.name === "general") {
    return "all";
  }
  if (definition.mode === "hidden") {
    return "subagent";
  }
  if (!VALID_AGENT_MODES.has(definition.mode as AgentMode)) {
    log.warn(`未知 Agent mode: "${definition.mode}"，回退到 subagent`);
    return "subagent";
  }
  return definition.mode as AgentMode;
}

/** 初始化内置 Agent */
export function initBuiltinAgents(): void {
  if (builtinInitialized) {
    return;
  }
  builtinInitialized = true;

  const builtins: AgentInfo[] = listAllBuiltinAgentDefinitions()
    .filter((definition) => {
      if (!definition.name) {
        log.warn("跳过一个内置 Agent: name 为空");
        return false;
      }
      if (!definition.systemPrompt) {
        log.warn(`跳过一个内置 Agent: ${definition.name} systemPrompt 为空`);
        return false;
      }
      return true;
    })
    .map((definition) => ({
      allowedTools: definition.defaultTools,
      color: definition.color,
      description: definition.description,
      hidden: definition.mode === "hidden",
      icon: definition.icon,
      id: definition.id ?? definition.name,
      keywords: definition.keywords,
      label: definition.displayName,
      mode: resolveAgentMode(definition),
      name: definition.name,
      native: true,
      options: {
        boundaries: definition.boundaries,
        capabilities: definition.capabilities,
        deniedTools: definition.deniedTools,
        modelPreference: definition.modelPreference,
        outputContract: definition.outputContract,
        readOnly: definition.readOnly ?? false,
        responsibility: definition.responsibility,
      },
      preferredSkills: definition.preferredSkills,
      prompt: definition.systemPrompt,
      steps: definition.maxSteps,
      tags: definition.tags,
      temperature: definition.temperature,
    }));

  registerAgents(builtins);
  log.info(`内置 Agent 已初始化: ${builtins.map((a) => a.name).join(", ")}`);
}

/** 重置所有状态(测试用) */
export function _resetAll(): void {
  agentRegistry.clear();
  agentStatusMap.clear();
  activeAgentName = DEFAULT_ACTIVE_AGENT_NAME;
  builtinInitialized = false;
  log.info("Agent 管理器已重置");
}
