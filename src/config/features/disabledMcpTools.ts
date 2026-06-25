/**
 * 禁用 MCP 工具管理 — 管理单个 MCP 工具的启用/禁用状态。
 *
 * 职责:
 *   - 管理单个 MCP 工具的启用/禁用状态
 *   - 支持 project 和 global 双作用域
 *   - 处理 opt-in 工具(默认禁用，需显式启用)
 *   - 持久化到 settings.json
 *
 * 模块功能:
 *   - getDisabledMCPTools: 获取合并后的被禁用工具列表
 *   - getDisabledMCPToolsByScope: 获取指定作用域的被禁用工具列表
 *   - isMCPToolEnabled: 检查某个 MCP 工具是否启用
 *   - toggleMCPTool: 切换 MCP 工具的启用/禁用状态
 *   - isMCPToolDisabledInScope: 获取工具在某个作用域中的禁用状态
 *   - getOptInEnabledMCPKeysMerged: 获取合并后的 opt-in 启用工具列表
 *   - MCPConfigScope: MCP 配置作用域类型
 *
 * 使用场景:
 *   - MCP 工具管理界面
 *   - 工具启用/禁用切换
 *   - 工具状态检查
 *
 * 边界:
 *   1. 工具标识格式: "serviceName:toolName"
 *   2. 持久化到 settings.json 的 disabledMCPTools / optInMCPTools 字段
 *   3. 支持 project 和 global 双作用域
 *   4. 合并时 project 优先级高于 global
 *
 * 流程:
 *   1. 构建工具 key(serviceName:toolName)
 *   2. 检查是否为 opt-in 工具
 *   3. 读取对应作用域的配置
 *   4. 修改并保存配置
 */

import { readSettings, updateSettings } from "../settings/unifiedSettings";

export type MCPConfigScope = "project" | "global";

/** 默认 opt-in 禁用的工具(需显式启用) */
const DEFAULT_OPT_IN_DISABLED_KEYS = new Set<string>([]);

// ─── 内部读写 ──────────────────────────────────────────────

function readOptInEnabledByScope(scope: MCPConfigScope): string[] {
  try {
    const settings = readSettings(scope);
    return Array.isArray(settings.optInMCPTools) ? settings.optInMCPTools : [];
  } catch {
    return [];
  }
}

function writeOptInEnabledByScope(scope: MCPConfigScope, enabledTools: string[]): void {
  updateSettings(scope, (settings) => {
    settings.optInMCPTools = enabledTools;
  });
}

function readDisabledByScope(scope: MCPConfigScope): string[] {
  try {
    const settings = readSettings(scope);
    return Array.isArray(settings.disabledMCPTools) ? settings.disabledMCPTools : [];
  } catch {
    return [];
  }
}

function writeDisabledByScope(scope: MCPConfigScope, disabledTools: string[]): void {
  updateSettings(scope, (settings) => {
    settings.disabledMCPTools = disabledTools;
  });
}

function makeToolKey(serviceName: string, toolName: string): string {
  return `${serviceName}:${toolName}`;
}

function isDefaultOptInDisabledKey(key: string): boolean {
  return DEFAULT_OPT_IN_DISABLED_KEYS.has(key);
}

// ─── 公共 API ──────────────────────────────────────────────

/**
 * 获取合并后的 opt-in 启用工具列表(project ∪ global)。
 */
export function getOptInEnabledMCPKeysMerged(): string[] {
  const g = readOptInEnabledByScope("global");
  const p = readOptInEnabledByScope("project");
  return [...new Set([...g, ...p])];
}

/**
 * 获取合并后的被禁用工具列表(project + global 去重)。
 */
export function getDisabledMCPTools(): string[] {
  const globalDisabled = readDisabledByScope("global");
  const projectDisabled = readDisabledByScope("project");
  return [...new Set([...globalDisabled, ...projectDisabled])];
}

/**
 * 获取指定作用域的被禁用工具列表。
 */
export function getDisabledMCPToolsByScope(scope: MCPConfigScope): string[] {
  return readDisabledByScope(scope);
}

/**
 * 检查某个 MCP 工具是否启用。
 */
export function isMCPToolEnabled(serviceName: string, toolName: string): boolean {
  const key = makeToolKey(serviceName, toolName);
  if (isDefaultOptInDisabledKey(key)) {
    return getOptInEnabledMCPKeysMerged().includes(key);
  }
  return !getDisabledMCPTools().includes(key);
}

/**
 * 切换 MCP 工具的启用/禁用状态。
 * @returns 切换后的状态(true = 启用)
 */
export function toggleMCPTool(serviceName: string, toolName: string, scope: MCPConfigScope): boolean {
  const key = makeToolKey(serviceName, toolName);

  if (isDefaultOptInDisabledKey(key)) {
    const enabled = [...readOptInEnabledByScope(scope)];
    const index = enabled.indexOf(key);
    let newEnabled: boolean;
    if (index !== -1) {
      enabled.splice(index, 1);
      newEnabled = false;
    } else {
      enabled.push(key);
      newEnabled = true;
    }
    writeOptInEnabledByScope(scope, enabled);
    return newEnabled;
  }

  const disabled = readDisabledByScope(scope);
  const index = disabled.indexOf(key);
  let newEnabled: boolean;

  if (index !== -1) {
    disabled.splice(index, 1);
    newEnabled = true;
  } else {
    disabled.push(key);
    newEnabled = false;
  }

  writeDisabledByScope(scope, disabled);
  return newEnabled;
}

/**
 * 获取工具在某个作用域中的禁用状态。
 */
export function isMCPToolDisabledInScope(serviceName: string, toolName: string, scope: MCPConfigScope): boolean {
  const key = makeToolKey(serviceName, toolName);
  return getDisabledMCPToolsByScope(scope).includes(key);
}
