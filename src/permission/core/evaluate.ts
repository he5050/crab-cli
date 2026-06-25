/**
 * 权限规则评估器 — 根据规则集判断操作权限。
 *
 * 职责:
 *   - 遍历规则集，找到最匹配的规则
 *   - 返回 allow/deny/ask 动作
 *   - 支持多层规则集评估
 *   - 批量评估多个模式
 *
 * 模块功能:
 *   - evaluate: 评估权限
 *   - evaluateBatch: 批量评估权限
 *   - EvaluateResult: 评估结果类型
 *   - DEFAULT_ACTION: 默认动作常量
 *
 * 使用场景:
 *   - 工具调用前权限评估
 *   - 权限规则匹配
 *   - 批量权限检查
 *   - 权限策略决策
 *
 * 边界:
 *   1. 纯评估逻辑，不涉及审批 UI 或持久化
 *   2. 规则优先级:deny > allow > ask
 *   3. 按规则顺序，第一个匹配生效
 *   4. 支持通配符匹配
 *
 * 流程:
 *   1. 接收权限名称和操作模式
 *   2. 按优先级遍历规则集
 *   3. 使用通配符匹配检查每条规则
 *   4. 返回第一个匹配的规则和动作
 *   5. 无匹配时返回默认动作 ask
 */
import type { PermissionAction, PermissionRule, PermissionRuleset } from "@/schema/permission";
import { wildcardMatch } from "./wildcard";
import { createLogger } from "@/core/logging/logger";
import { getGlobalAuditLogger } from "@/security/audit/auditLogger";
const log = createLogger("perm:eval");

/** 评估结果 */
export interface EvaluateResult {
  /** 匹配到的规则，未匹配则为 null */
  rule: PermissionRule | null;
  /** 最终动作 */
  action: PermissionAction;
}

/** 默认动作(无规则匹配时) */
const DEFAULT_ACTION: PermissionAction = "ask";

/**
 * 评估权限。
 * 按规则顺序遍历，返回第一个匹配的规则。
 * 支持多层规则集(如:用户批准 > 项目配置 > 全局默认)。
 *
 * @param permission - 权限名称(如 "bash"、"fs.write")
 * @param pattern - 操作模式，如 glob 匹配的文件路径
 * @param rulesets - 规则集数组，按优先级从高到低排列
 * @returns 评估结果
 */
export function evaluate(permission: string, pattern: string, ...rulesets: PermissionRuleset[]): EvaluateResult {
  log.debug(`权限评估开始: ${permission} ${pattern}`, {
    eventType: "permission.evaluate.start",
    rulesetCount: rulesets.length,
  });

  const auditLogger = getGlobalAuditLogger();
  const startTime = Date.now();

  let checkedRules = 0;
  let result: EvaluateResult | null = null;

  for (let i = 0; i < rulesets.length; i++) {
    const ruleset = rulesets[i]!;
    for (const rule of ruleset) {
      checkedRules++;
      if (permissionMatches(permission, rule.permission) && patternMatches(pattern, rule.pattern)) {
        result = { action: rule.action, rule };
        log.debug(`权限评估匹配: ${permission} → ${rule.action} (规则集 ${i + 1}/${rulesets.length})`, {
          action: rule.action,
          checkedRules,
          eventType: "permission.evaluate.matched",
          rulesetIndex: i,
        });
        break;
      }
    }
    if (result) {
      break;
    }
  }

  if (!result) {
    log.debug(`权限评估: ${permission} → ${DEFAULT_ACTION} (无匹配规则, 检查了 ${checkedRules} 条规则)`);
    result = { action: DEFAULT_ACTION, rule: null };
  }

  // 仅在非 allow 场景记录审计日志（deny/ask）
  if (result.action !== "allow") {
    const duration = Date.now() - startTime;
    auditLogger.logAuthz(`permission.evaluate:${permission}`, {
      allowed: false,
      duration,
      metadata: {
        action: result.action,
        checkedRules,
        matchedRule: result.rule ? `${result.rule.permission}:${result.rule.pattern}` : null,
        pattern,
      },
      resource: { id: permission, name: pattern, type: "permission" },
    });
  }

  return result;
}

/**
 * 检查请求的权限是否匹配规则定义的权限。
 * 支持通配符(如 "fs.*" 匹配 "fs.read" 和 "fs.write")。
 */
function permissionMatches(requested: string, defined: string): boolean {
  if (defined === "*" || defined === "**") {
    return true;
  }
  if (requested === defined) {
    return true;
  }
  return wildcardMatch(defined, requested);
}

/**
 * 检查操作模式是否匹配规则模式。
 * 使用通配符匹配引擎。
 */
function patternMatches(input: string, pattern: string): boolean {
  return wildcardMatch(pattern, input);
}

/**
 * 批量评估多个模式。
 * 只要有一个模式被 deny，则整体 deny；
 * 全部 allow 则 allow；
 * 否则 ask。
 */
export function evaluateBatch(
  permission: string,
  patterns: string[],
  ...rulesets: PermissionRuleset[]
): EvaluateResult {
  let highestAction: PermissionAction = "allow";

  for (const pattern of patterns) {
    const result = evaluate(permission, pattern, ...rulesets);
    if (result.action === "deny") {
      return { action: "deny", rule: result.rule };
    }
    if (result.action === "ask") {
      highestAction = "ask";
    }
  }

  return { action: highestAction, rule: null };
}
