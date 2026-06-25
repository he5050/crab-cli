/**
 * Bash 安全检查工具 — 统一导出入口（向后兼容）
 *
 * 本文件是纯重导出层，保持所有公开 API 签名不变。
 * 实际实现已拆分到三个职责单一的子模块:
 *   - dangerDetector.ts       — 危险/自毁命令检测 + 输出截断
 *   - sensitiveCommandStore.ts — 敏感命令 CRUD + 持久化配置
 *   - sensitiveCommandMatcher.ts — 通配符匹配 + 组合命令拆分
 *
 * 使用场景:
 *   - Bash 权限请求前的安全预检
 *   - 敏感命令的启用/禁用管理
 *   - 用户自定义敏感命令规则
 *   - 命令输出的长度控制
 *
 * 流程:
 * 1. 权限请求触发时调用 checkSensitiveCommand
 * 2. 首先检查 isDangerousCommand，命中直接阻止
 * 3. 然后检查 isSelfDestructiveCommand，命中直接阻止
 * 4. 最后检查 isSensitiveCommand，命中进入审批确认
 * 5. 用户审批决策通过 ApprovalStore 持久化
 */

// ─── 重导出子模块 ────────────────────────────────────────

export {
  isDangerousCommand,
  isSelfDestructiveCommand,
  truncateOutput,
  type SelfDestructiveResult,
} from "./dangerDetector";

export {
  PRESET_SENSITIVE_COMMANDS,
  loadSensitiveCommands,
  saveSensitiveCommands,
  getAllSensitiveCommands,
  addSensitiveCommand,
  removeSensitiveCommand,
  toggleSensitiveCommand,
  resetSensitiveCommands,
  createFileSensitiveCommandConfigStore,
  type SensitiveCommand,
  type SensitiveCommandsConfig,
  type SensitiveCommandScope,
  type ISensitiveCommandConfigStore,
} from "./sensitiveCommandStore";

export { isSensitiveCommand, type SensitiveCheckResult, type SensitiveCommandResult } from "./sensitiveCommandMatcher";

// ─── 跨子模块编排 ────────────────────────────────────────

import { isDangerousCommand, isSelfDestructiveCommand } from "./dangerDetector";
import { isSensitiveCommand } from "./sensitiveCommandMatcher";
import type { SensitiveCommandResult } from "./sensitiveCommandMatcher";

/**
 * 向后兼容的敏感命令检查。
 * 保留原有签名，内部编排: 危险 → 自毁 → 敏感。
 */
export function checkSensitiveCommand(command: string): SensitiveCommandResult {
  // 1. 危险命令 → 直接阻止
  if (isDangerousCommand(command)) {
    return {
      action: "block",
      isSensitive: true,
      matchedDescription: "危险命令(可能造成不可逆损害)",
      matchedPattern: "dangerous",
    };
  }

  // 2. 自毁命令 → 直接阻止
  const selfCheck = isSelfDestructiveCommand(command);
  if (selfCheck.isSelfDestructive) {
    return {
      action: "block",
      isSensitive: true,
      matchedDescription: selfCheck.reason ?? "自毁命令",
      matchedPattern: "self-destructive",
    };
  }

  // 3. 敏感命令 → 确认
  const result = isSensitiveCommand(command);
  if (result.isSensitive && result.matchedCommand) {
    return {
      action: "confirm",
      isSensitive: true,
      matchedDescription: result.matchedCommand.description,
      matchedPattern: result.matchedCommand.pattern,
    };
  }

  return { action: "confirm", isSensitive: false };
}
