/**
 * 工具注册表模块 — 管理所有可用工具(内置 + MCP 动态注册)
 *
 * 职责:
 *   - 维护工具注册表(Record<string, ToolDefinition>)
 *   - 提供动态注册/注销接口(用于 MCP 工具加载)
 *   - 将工具转换为 AI SDK 格式(不含 execute，由 Handler 执行)
 *   - 管理内置工具分组和禁用配置
 *
 * 模块功能:
 *   - registerTool: 注册单个工具
 *   - registerTools: 批量注册工具
 *   - unregisterTool: 注销单个工具
 *   - getRegisteredTools: 获取当前注册的所有工具
 *   - getToolsForAiSdk: 将工具转换为 Vercel AI SDK 格式
 *   - getBuiltinToolGroups: 获取内置工具分组信息
 *   - isBuiltinTool: 判断是否为内置工具
 *   - getBuiltinGroupName: 获取工具所属分组名
 *
 * 使用场景:
 *   - MCP 服务器工具动态注册
 *   - 插件工具加载
 *   - 获取工具列表供 AI 使用
 *   - 工具权限控制和分组管理
 *
 * 边界:
 *   1. MCP 服务器工具可通过 registerTool() 动态注册
 *   2. 配合 mcp.json 配置，通过 McpManager 自动发现并加载
 *   3. 支持内置工具分组和禁用配置
 *   4. 工具 Schema 缓存机制
 *   5. 线程安全的注册表操作
 *
 * 流程:
 *   1. 初始化内置工具(懒加载)
 *   2. 动态注册 MCP 工具
 *   3. 根据配置过滤禁用工具
 *   4. 转换为 AI SDK 格式
 *   5. 返回工具列表供 AI 使用
 */
import { fsReadTool, fsWriteTool, fsEditTool, fsBatchTool } from "@/tool/filesystem";
import { bashTool } from "@/tool/bash";
import { globTool } from "@/tool/codebaseSearch/globTool";
import { grepTool } from "@/tool/codebaseSearch/grepTool";
import { applyPatchTool } from "@/tool/codebaseSearch/applyPatchTool";
import {
  deepwikiAskQuestionTool,
  deepwikiFetchTool,
  deepwikiReadContentsTool,
  deepwikiReadStructureTool,
  deepwikiSearchTool,
} from "@/tool/deepwiki";
import { context7QueryDocsTool, context7ResolveLibraryIdTool } from "@/tool/context7";
import { type ToolDefinition } from "../types";
import { createLogger } from "@/core/logging/logger";
// 阶段 10:内置工具 (下)
import { webSearchTool } from "@/tool/websearch";
import { webFetchTool } from "@/tool/websearch/webfetch";
import { todoUltraTool } from "@/tool/todo";
import { askUserQuestionTool } from "@/tool/askUser";
import { subagentTool } from "@/tool/subagent";
import { teamTools } from "@/tool/team";
import { schedulerTool } from "@/tool/scheduler";
import { notebookTool } from "@/tool/notebook";
import { skillsTool } from "@/tool/skills";
import { ideDiagnosticsTool } from "@/tool/ideDiagnostics";
import { codebaseSearchTool } from "@/tool/codebaseSearch";
import { aceEnhancedSearchTool } from "@/tool/codebaseSearch/enhanced";
// 阶段 10+:对齐工具
import { filesystemMultiEditTool } from "@/tool/filesystem/multiEdit";
import { notebookEditTool, notebookReadTool } from "@/tool/notebookJupyter";
import { lspTool } from "@/tool/lsp";
import { planModeTool } from "@/tool/planMode";
import { toolSearchTool } from "@/tool/toolSearch/index";
// Phase 14: Agent 间通信工具
import { queryAgentsStatusTool, sendMessageToAgentTool } from "@/tool/agentComms";
// Phase 19: Goal 工具
import { goalTool } from "@/tool/goal";
// Phase 24: Git / Format 工具
import gitTool, { gitMerge, gitPush, gitRebase, gitTag } from "@/tool/git";
import formatTool from "@/tool/format";
import { deepResearchTool } from "@/tool/deepResearch";
// MCP 资源访问工具
import { listMcpResourcesTool, readMcpResourceTool } from "@/tool/mcp";
import { getDisabledBuiltInServices } from "@/config";
import { getDisabledMCPTools, getOptInEnabledMCPKeysMerged } from "@/config/features/disabledMcpTools";
import { globalBus } from "@/bus";
import { AppEvent } from "@/bus";
import { toolNameMatches } from "./toolNameMatcher";
import { normalizeToolRef } from "./toolRefUtils";
import { registerBuiltinPrefix } from "./builtinToolPrefixes";

/** Goal 工具是否已动态注册 */
let goalToolRegistered = false;
let goalToolVisibilityInitialized = false;
let goalToolVisibilityInstallCount = 0;

/** 订阅 Goal 状态变更，动态注册/注销 Goal 工具 */
function initGoalToolVisibility(): void {
  globalBus.subscribe(AppEvent.GoalStatusChanged, (event) => {
    const status = event.properties?.status;
    const active = status === "pursuing" || status === "paused";
    if (active && !goalToolRegistered) {
      registerTool(goalTool);
      goalToolRegistered = true;
      log.debug("Goal 工具已动态注册(Goal 活跃)");
    } else if (!active && goalToolRegistered) {
      unregisterTool(goalTool.name);
      goalToolRegistered = false;
      log.debug("Goal 工具已动态注销(Goal 非活跃)");
    }
  });
}

/** 初始化 Goal 工具可见性同步(应在 app 启动时调用一次) */
export function setupGoalToolVisibility(): void {
  if (goalToolVisibilityInitialized) {
    return;
  }
  goalToolVisibilityInitialized = true;
  goalToolVisibilityInstallCount++;
  initGoalToolVisibility();
}

const log = createLogger("tool:registry");

/**
 * 异质工具注册表类型
 *
 * 注册表中存放的工具定义各自拥有不同的 Zod schema 泛型参数，
 * 因此无法用单一具体类型表达。此处使用 any 作为异质集合的类型逃逸点。
 * 所有写入前均通过 registerTool() 校验 ToolDefinition 结构完整性。
 */
type AnyToolDefinition = ToolDefinition<any>;

/** 工具注册表 — 存储所有已注册的工具定义（含内置与 MCP 工具） */
const registry: Record<string, AnyToolDefinition> = {};

/** 是否已初始化内置工具 */
let initialized = false;

/** 初始化内置工具(懒加载) */
function ensureInitialized(): void {
  if (initialized) {
    return;
  }
  initialized = true;

  const reg = (tool: AnyToolDefinition): void => {
    registry[tool.name] = tool;
    registerBuiltinPrefix(tool.name);
  };

  // 文件系统工具
  reg(fsReadTool);
  reg(fsWriteTool);
  reg(fsEditTool);
  reg(fsBatchTool);
  // 终端工具
  reg(bashTool);
  // 搜索工具
  reg(globTool);
  reg(grepTool);
  reg(applyPatchTool);
  // 知识工具
  reg(deepwikiReadStructureTool);
  reg(deepwikiReadContentsTool);
  reg(deepwikiAskQuestionTool);
  reg(deepwikiFetchTool);
  reg(deepwikiSearchTool);
  reg(context7ResolveLibraryIdTool);
  reg(context7QueryDocsTool);
  // 阶段 10:网页工具
  reg(webSearchTool);
  reg(webFetchTool);
  // 任务管理
  reg(todoUltraTool);
  reg(askUserQuestionTool);
  reg(schedulerTool);
  reg(notebookTool);
  // 代理协作
  reg(subagentTool);
  // Team 工具(16 个独立工具)
  for (const t of teamTools) {
    reg(t);
  }
  // 知识工具
  reg(skillsTool);
  reg(ideDiagnosticsTool);
  reg(codebaseSearchTool);
  reg(aceEnhancedSearchTool);
  // 阶段 10+:对齐工具
  reg(filesystemMultiEditTool);
  reg(notebookReadTool);
  reg(notebookEditTool);
  reg(lspTool);
  reg(planModeTool);
  reg(toolSearchTool);
  // Phase 14: Agent 间通信
  reg(sendMessageToAgentTool);
  reg(queryAgentsStatusTool);
  // Phase 19: Goal 工具 — 动态注册(见 setupGoalToolVisibility)
  // Phase 24: Git / Format 工具
  reg(gitTool);
  reg(gitMerge);
  reg(gitRebase);
  reg(gitPush);
  reg(gitTag);
  reg(formatTool);
  // Research
  reg(deepResearchTool);
  // MCP 资源访问工具
  reg(listMcpResourcesTool);
  reg(readMcpResourceTool);
  log.debug("内置工具已初始化", { tools: Object.keys(registry) });
}

/**
 * 注册单个工具。
 * 用于动态添加 MCP 工具或插件工具。
 * 内置工具（builtin: true）自动提取前缀到 BUILTIN_TOOL_PREFIXES。
 */
/** registerTool 的实现 */
export function registerTool(tool: AnyToolDefinition): void {
  ensureInitialized();
  if (registry[tool.name]) {
    log.warn(`工具名称冲突: "${tool.name}" 已存在，跳过注册`);
    return;
  }
  registry[tool.name] = tool;
  if (tool.builtin) {
    registerBuiltinPrefix(tool.name);
  }
  clearToolsCache();
  log.debug(`工具已注册: ${tool.name}`);
}

/**
 * 批量注册工具。
 * 用于 MCP 服务器连接后一次性注册所有工具。
 * 行为与 registerTool 对齐:冲突时跳过并 warn，不覆盖。
 */
/** registerTools 的实现 */
export function registerTools(tools: AnyToolDefinition[]): void {
  ensureInitialized();
  const names: string[] = [];
  for (const tool of tools) {
    if (registry[tool.name]) {
      log.warn(`工具名称冲突: "${tool.name}" 已存在，跳过注册`);
      continue;
    }
    registry[tool.name] = tool;
    names.push(tool.name);
  }
  clearToolsCache();
  if (names.length > 0) {
    log.info(`批量注册 ${names.length} 个工具: ${names.join(", ")}`);
  } else {
    log.info("批量注册 0 个工具(全部冲突或空列表)");
  }
}

/**
 * 注销单个工具。
 * 用于 MCP 服务器断连后清理工具。
 */
/** unregisterTool 的实现 */
export function unregisterTool(toolName: string): void {
  delete registry[toolName];
  clearToolsCache();
  // 不逐条记录 debug，由调用方汇总输出
}

/**
 * 获取当前注册的所有工具(只读副本)。
 */
/** getRegisteredTools 的实现 */
export function getRegisteredTools(): Readonly<Record<string, AnyToolDefinition>> {
  ensureInitialized();
  const filtered: Record<string, AnyToolDefinition> = {};
  const disabledGroups = new Set(getDisabledBuiltInServices());
  for (const [name, tool] of Object.entries(registry)) {
    const groupName = getBuiltinGroupName(name);
    if (groupName && disabledGroups.has(groupName)) {
      continue;
    }
    filtered[name] = tool;
  }
  return filtered;
}

/**
 * 根据名称查找单个工具。
 * 返回 `ToolDefinition<any>` 是注册表异质集合的不可避免妥协(plan P2-7)；
 * 调用方应使用类型守卫或 `executeTool` 包装器以获得类型安全。
 */
/** getTool 的实现 */
export function getTool(name: string): AnyToolDefinition | undefined {
  ensureInitialized();
  const disabledGroups = new Set(getDisabledBuiltInServices());
  if (disabledGroups.has(getBuiltinGroupName(name) ?? "")) {
    return undefined;
  }
  return registry[name];
}

/** AI SDK 工具 Schema（不含 execute，用于模型调用） */
interface AiSdkToolSchema {
  description: string;
  /** Zod schema 对象，透传给 AI SDK */
  inputSchema: unknown;
}

/**
 * 工具 Schema 缓存 */
let toolsCache: Record<string, AiSdkToolSchema> | null = null;

/**
 * 将工具转换为 Vercel AI SDK 格式(不含 execute)。
 *
 * 默认仅暴露内置工具；外部工具需通过显式白名单 / allowedTools 选择。
 */
/** 将工具转换为 Vercel AI SDK 格式(不含 execute)，返回所有可用工具 */
export const getToolsForAiSdk = (): Record<string, AiSdkToolSchema> => getToolsForAiSdkInternal();

/** 将工具转换为 Vercel AI SDK 格式，仅包含指定名称的工具 */
export const getToolsForAiSdkByNames = (toolNames: string[]): Record<string, AiSdkToolSchema> =>
  getToolsForAiSdkInternal(toolNames);

function getToolsForAiSdkInternal(toolNames?: string[]): Record<string, AiSdkToolSchema> {
  if (!toolsCache) {
    ensureInitialized();
    const tools: Record<string, AiSdkToolSchema> = {};
    for (const key in registry) {
      const tool = registry[key];
      if (!tool) {
        continue;
      }
      tools[tool.name] = {
        description: tool.description,
        inputSchema: tool.parameters,
      };
    }
    toolsCache = tools;
    log.debug(`AI SDK 工具 Schema 已生成，共 ${Object.keys(tools).length} 个`);
  }

  const filtered: Record<string, AiSdkToolSchema> = {};
  ensureInitialized();
  const disabledGroups = new Set(getDisabledBuiltInServices());
  const disabledMcpTools = new Set(getDisabledMCPTools());
  const optInMcpTools = new Set(getOptInEnabledMCPKeysMerged());
  const allowList = toolNames?.length ? toolNames : undefined;

  for (const [toolName, toolSchema] of Object.entries(toolsCache)) {
    const groupName = getBuiltinGroupName(toolName);
    if (groupName && disabledGroups.has(groupName)) {
      continue;
    }

    if (allowList) {
      if (!allowList.some((allowed) => toolNameMatches(toolName, allowed))) {
        continue;
      }
      if (!groupName && isMcpToolNameDisabled(toolName, disabledMcpTools)) {
        continue;
      }
    } else if (!groupName) {
      const isOptIn = hasMcpToolConfigKey(toolName, optInMcpTools);
      const isDisabled = isMcpToolNameDisabled(toolName, disabledMcpTools);
      if (isDisabled || !isOptIn) {
        continue;
      }
    }

    filtered[toolName] = toolSchema;
  }

  return filtered;
}

/** 判断指定 MCP 工具名称是否被用户配置禁用 */
export function isMcpToolNameDisabled(
  toolName: string,
  disabledMcpToolsInput: Set<string> | string[] = getDisabledMCPTools(),
): boolean {
  const disabledMcpTools = Array.isArray(disabledMcpToolsInput)
    ? new Set(disabledMcpToolsInput)
    : disabledMcpToolsInput;
  return hasMcpToolConfigKey(toolName, disabledMcpTools);
}

function hasMcpToolConfigKey(toolName: string, configuredKeys: Set<string>): boolean {
  if (configuredKeys.has(toolName)) {
    return true;
  }
  const normalizedKeys = new Set([...configuredKeys].map(normalizeToolRef));
  return getMcpToolConfigAliases(toolName).some(
    (alias) => configuredKeys.has(alias) || normalizedKeys.has(normalizeToolRef(alias)),
  );
}

function getMcpToolConfigAliases(toolName: string): string[] {
  const aliases = new Set<string>([toolName]);
  const mcpKey = toMcpToolKey(toolName);
  if (mcpKey) {
    aliases.add(mcpKey);
  }
  aliases.add(toolName.replace(/_/g, "-"));
  aliases.add(toolName.replace(/-/g, "_"));
  return [...aliases];
}

function toMcpToolKey(toolName: string): string | null {
  const firstUnderscore = toolName.indexOf("_");
  if (firstUnderscore > 0 && firstUnderscore < toolName.length - 1) {
    return `${toolName.slice(0, firstUnderscore)}:${toolName.slice(firstUnderscore + 1)}`;
  }
  const firstHyphen = toolName.indexOf("-");
  if (firstHyphen <= 0 || firstHyphen >= toolName.length - 1) {
    return null;
  }
  return `${toolName.slice(0, firstHyphen)}:${toolName.slice(firstHyphen + 1)}`;
}

/** 清除工具 Schema 缓存(工具注册变更时调用) */
export const clearToolsCache = (): void => {
  toolsCache = null;
};

/**
 * 重置注册表到初始状态(仅用于测试)。
 * 清除所有注册的工具和初始化标记，下次访问时重新初始化内置工具。
 */
/** 仅用于测试 */
export const _resetGoalToolRegisteredForTesting = (): void => {
  goalToolRegistered = false;
  goalToolVisibilityInitialized = false;
  goalToolVisibilityInstallCount = 0;
};

/** 测试专用：检查目标工具可见性是否已初始化 */
export const _isGoalToolVisibilityInitializedForTesting = (): boolean => goalToolVisibilityInitialized;
/** 测试专用：获取目标工具可见性安装计数 */
export const _getGoalToolVisibilityInstallCountForTesting = (): number => goalToolVisibilityInstallCount;

/** 测试专用：完全重置工具注册表 */
export const _resetForTesting = (): void => {
  for (const key of Object.keys(registry)) {
    delete registry[key];
  }
  initialized = false;
  goalToolRegistered = false;
  goalToolVisibilityInitialized = false;
  goalToolVisibilityInstallCount = 0;
  toolsCache = null;
};

// ─── 内置工具分组（提取到 builtinGroups.ts） ──────────────────

import { getBuiltinGroupName, getBuiltinToolGroups, isBuiltinTool } from "./builtinGroups";
export type { BuiltinToolGroup } from "./builtinGroups";
export { getBuiltinGroupName, getBuiltinToolGroups, isBuiltinTool };
