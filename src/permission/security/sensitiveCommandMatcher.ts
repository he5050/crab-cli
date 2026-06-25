/**
 * 敏感命令匹配模块 — 用户可配置的通配符模式匹配 + 组合命令拆分（权限提示层）。
 *
 * 职责:
 *   - 使用通配符引擎进行安全模式匹配（消除 ReDoS 风险）
 *   - 输入清洗（ANSI 转义序列、零宽字符）
 *   - 分割组合命令（; && || | \n）
 *   - 检查命令是否匹配任何已启用的敏感模式
 *
 * ⚠️ 本模块与 @/tool/executor/toolExecutorSafety 是两个独立的安全层:
 *   - 本模块: 用户可配置的通配符模式, 用于权限提示 (soft-confirm), 模式来源于 sensitiveCommandStore
 *   - toolExecutorSafety.SENSITIVE_PATTERNS: 静态硬编码, 用于 isSensitiveCall(), 检测绝对危险命令 (hard-deny)
 *   - 二者职责不同, 不可合并: 一个是权限策略, 一个是安全底线
 *
 * 边界:
 *   - 不涉及配置持久化（由 sensitiveCommandStore 负责）
 *   - 不涉及危险/自毁命令检测（由 dangerDetector 负责）
 */

import { wildcardMatch } from "../core/wildcard";
import { type SensitiveCommand, getAllSensitiveCommands } from "./sensitiveCommandStore";

// ─── 内存缓存 ──────────────────────────────────────────────

let cachedEnabledCommands: SensitiveCommand[] | null = null;

/** 使敏感命令缓存失效（由 sensitiveCommandStore 写操作调用） */
export function invalidateSensitiveCommandCache(): void {
  cachedEnabledCommands = null;
}

/** 获取已启用的敏感命令（带内存缓存） */
function getEnabledSensitiveCommands(): SensitiveCommand[] {
  if (cachedEnabledCommands) return cachedEnabledCommands;
  cachedEnabledCommands = getAllSensitiveCommands().filter((cmd) => cmd.enabled);
  return cachedEnabledCommands;
}

// ─── 输入清洗 ────────────────────────────────────────────

/**
 * 清洗命令输入：移除 ANSI 转义序列和零宽字符。
 */
function sanitizeCommand(command: string): string {
  // 移除 ANSI 转义序列
  let cleaned = command.replace(/\x1B\[[0-9;]*m/g, "");
  // 移除零宽字符 (U+200B 零宽空格, U+200C 零宽非连接符, U+200D 零宽连接符, U+FEFF BOM, U+00AD 软连字符)
  // 逐字符替换以避免 oxlint no-misleading-character-class 对 ZWJ (U+200D) 的误报
  const zeroWidthChars = ["​", "‌", "‍", "﻿", "­"] as const;
  for (const zwc of zeroWidthChars) {
    cleaned = cleaned.replaceAll(zwc, "");
  }
  return cleaned;
}

// ─── 模式匹配 ────────────────────────────────────────────

/**
 * 使用通配符引擎匹配命令与模式（不区分大小写）。
 * 模式若不以 * 结尾则自动追加，使其语义等同于旧正则的"前缀匹配"。
 */
function commandMatchesPattern(command: string, pattern: string): boolean {
  const effectivePattern = pattern.endsWith("*") ? pattern : `${pattern}*`;
  return wildcardMatch(effectivePattern.toLowerCase(), command.toLowerCase());
}

/**
 * 分割组合命令为单个命令。
 * 支持 ; && || | 等分隔符。
 */
function splitCommand(command: string): string[] {
  const cleanCommand = command.trim().replace(/\s+/g, " ");
  const parts = cleanCommand.split(/\s*(?:;|&&|\|\||\||\n)\s*/);
  return parts.filter((part) => part.trim().length > 0);
}

// ─── 公开匹配接口 ────────────────────────────────────────

export interface SensitiveCheckResult {
  isSensitive: boolean;
  matchedCommand?: SensitiveCommand;
}

/**
 * 检查命令是否匹配任何已启用的敏感模式。
 * 支持组合命令拆分(; && || |)和通配符匹配。
 * 使用通配符引擎替代正则引擎，消除 ReDoS 风险。
 */
export function isSensitiveCommand(command: string): SensitiveCheckResult {
  const enabledCommands = getEnabledSensitiveCommands();
  const cleaned = sanitizeCommand(command);
  const commandParts = splitCommand(cleaned);

  for (const part of commandParts) {
    const trimmedPart = part.trim();

    for (const cmd of enabledCommands) {
      if (commandMatchesPattern(trimmedPart, cmd.pattern)) {
        return { isSensitive: true, matchedCommand: cmd };
      }
    }
  }

  return { isSensitive: false };
}

// ─── 向后兼容组合结果类型 ────────────────────────────────

/** checkSensitiveCommand 返回的完整结果类型 */
export interface SensitiveCommandResult {
  isSensitive: boolean;
  matchedDescription?: string;
  matchedPattern?: string;
  action: "confirm" | "block";
}
