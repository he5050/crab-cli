/**
 * 子代理权限隔离 — 限制子代理可用的工具集和权限。
 *
 * 职责:
 *   - 根据 Agent 定义过滤可用工具(支持前缀匹配)
 *   - 为子代理生成受限的权限规则集
 *   - 防止权限逃逸
 *   - 验证子代理定义的安全性
 *
 * 模块功能:
 *   - toolNameMatches: 判断工具名是否匹配允许列表中的条目
 *   - filterToolsForAgent: 根据 Agent 定义过滤可用工具
 *   - isToolAllowedForAgent: 检查工具是否允许被 Agent 使用
 *   - buildSubagentPermissions: 为子代理生成受限的权限规则集
 *   - isPermissionAllowedForSubagent: 检查权限类别是否允许子代理使用
 *   - validateSubagentSecurity: 验证子代理定义是否安全
 *
 * 使用场景:
 *   - 子代理创建时过滤可用工具
 *   - 构建子代理的权限规则集
 *   - 验证子代理配置的安全性
 *   - 防止子代理权限逃逸
 *
 * 边界:
 *   1. 仅提供权限过滤函数，不执行实际的权限检查
 *   2. 工具匹配支持三种模式:精确匹配、前缀匹配、后缀匹配
 *   3. 子代理默认禁止 config.write 和 agent.manage 权限
 *   4. 安全检查仅返回警告，不阻止子代理创建
 *
 * 流程:
 *   1. 子代理创建时调用 buildSubagentPermissions() 构建权限规则
 *   2. 调用 filterToolsForAgent() 过滤可用工具
 *   3. 调用 validateSubagentSecurity() 验证配置安全性
 *   4. 运行时通过 isToolAllowedForAgent() 检查工具权限
 */
import type { AgentInfo } from "@/agent/core/manager";
import type { PermissionRuleset } from "@/schema/permission";
import { createLogger } from "@/core/logging/logger";
import { toolNameMatches } from "@/tool/registry/toolNameMatcher";
import { getYoloPassthroughRuleset } from "@/agent/runtime/yolo";
import { SUBAGENT_DENIED_TOOL_SET, SUBAGENT_DENIED_TOOLS } from "./deniedTools";

const log = createLogger("agent:subagent-permissions");

// ─── 子代理默认权限规则 ───────────────────────────────────────

export { SUBAGENT_DENIED_TOOL_SET, SUBAGENT_DENIED_TOOLS };

/** 子代理禁止的权限类别 */
const SUBAGENT_DENIED_PERMISSIONS = [
  // 子代理不能修改系统配置
  "config.write",
  // 子代理不能管理其他代理
  "agent.manage",
];

// ─── 工具过滤(支持前缀匹配) ─────────────────────────────────

/**
 * 判断工具名是否匹配允许列表中的条目。
 *
 * 支持三种匹配模式:
 *   1. 精确匹配:`filesystem-read` 匹配 `filesystem-read`
 *   2. 前缀匹配:`filesystem-` 匹配 `filesystem-read`、`filesystem-write` 等
 *   3. 后缀匹配:`mytool` 匹配 `external-mytool`(外部工具无前缀时的兼容)
 *
 * @param toolName - 待检查的工具名
 * @param allowedTool - 允许列表中的条目
 * @returns 是否匹配
 */
/**
 * 根据Agent定义过滤可用工具。
 *
 * 如果 agent.allowedTools 已定义，则只允许白名单中的工具。
 * 如果未定义，则允许所有工具(但受全局权限规则约束)。
 *
 * 支持前缀匹配:如 `filesystem-` 匹配所有 filesystem 相关工具。
 *
 * @param toolNames - 所有可用工具名称列表
 * @param agent - Agent 定义
 * @returns 过滤后的工具名称列表
 */
export function filterToolsForAgent(toolNames: string[], agent: AgentInfo): string[] {
  const safeToolNames = toolNames.filter((name) => !SUBAGENT_DENIED_TOOL_SET.has(name));
  if (!agent.allowedTools) {
    // 无白名单 → 允许所有非危险工具
    return safeToolNames;
  }

  const { allowedTools } = agent;
  const filtered = safeToolNames.filter((name) => allowedTools.some((allowed) => toolNameMatches(name, allowed)));

  if (filtered.length < toolNames.length) {
    log.debug(`Agent ${agent.name}: 工具已过滤 ${toolNames.length} → ${filtered.length}`);
  }

  return filtered;
}

/**
 * 检查工具是否允许被 Agent 使用。
 */
export function isToolAllowedForAgent(toolName: string, agent: AgentInfo): boolean {
  if (SUBAGENT_DENIED_TOOL_SET.has(toolName)) {
    return false;
  }
  if (!agent.allowedTools) {
    return true;
  }
  return agent.allowedTools.some((allowed) => toolNameMatches(toolName, allowed));
}

// ─── 权限规则过滤 ─────────────────────────────────────────────

/**
 * 为子代理生成受限的权限规则集。
 *
 * 策略:
 *   - 继承父代理的权限规则
 *   - 添加子代理专用的限制规则
 *   - 如果 agent.permissions 已定义，使用自定义规则
 *
 * @param agent - 子代理定义
 * @param parentPermissions - 父代理的权限规则集(可选)
 * @returns 子代理的权限规则集
 */
export function buildSubagentPermissions(agent: AgentInfo, parentPermissions?: PermissionRuleset): PermissionRuleset {
  const denyRules = getSubagentDenyRules();
  // 如果 Agent 自定义了权限规则，优先使用
  if (agent.permissions) {
    return [...denyRules, ...agent.permissions];
  }

  // 继承父代理权限 + 子代理限制
  const rules: PermissionRuleset = parentPermissions ? [...parentPermissions] : [];

  // 添加 YOLO 透传规则（如果主会话处于 YOLO 模式）
  const yoloRuleset = getYoloPassthroughRuleset();
  if (yoloRuleset) {
    rules.push(...yoloRuleset);
  }

  // 添加子代理专用限制
  rules.unshift(...denyRules);

  return rules;
}

/**
 * 获取子代理专用的拒绝规则。
 */
function getSubagentDenyRules(): PermissionRuleset {
  return SUBAGENT_DENIED_PERMISSIONS.map((perm) => ({
    action: "deny" as const,
    metadata: { source: "subagent-deny" },
    pattern: "*",
    permission: perm,
  }));
}

/**
 * 检查权限类别是否允许子代理使用。
 */
export function isPermissionAllowedForSubagent(permission: string): boolean {
  return !SUBAGENT_DENIED_PERMISSIONS.includes(permission);
}

// ─── 安全检查 ─────────────────────────────────────────────────

/**
 * 验证子代理定义是否安全。
 * 检查是否存在权限逃逸风险。
 */
export function validateSubagentSecurity(agent: AgentInfo): {
  valid: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];

  // 子代理不应该有 agent.manage 权限
  if (agent.permissions) {
    for (const rule of agent.permissions) {
      if (rule.permission === "agent.manage" && rule.action === "allow") {
        warnings.push(`子代理 ${agent.name} 具有 agent.manage 权限，存在逃逸风险`);
      }
    }
  }

  // 子代理的白名单不应为空(除非是 compaction 类型)
  if (agent.allowedTools && agent.allowedTools.length === 0 && agent.mode === "subagent") {
    // Compaction Agent 确实不需要工具，跳过
    if (agent.name !== "compaction") {
      warnings.push(`子代理 ${agent.name} 的工具白名单为空`);
    }
  }

  if (warnings.length > 0) {
    log.warn(`子代理安全检查: ${agent.name}`, { warnings });
  }

  return { valid: warnings.length === 0, warnings };
}
