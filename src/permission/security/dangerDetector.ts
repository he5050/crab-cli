/**
 * 危险命令 & 自毁命令检测模块
 *
 * 职责:
 *   - 危险命令检测（rm -rf /, mkfs, dd 等）— 匹配到直接阻止
 *   - 自毁命令检测（killall node, pkill node 等）— 保护 CLI 自身进程
 *   - 输出截断 — 防止终端过载的通用工具
 *
 * 与 riskPatterns.ts 的关系:
 *   - riskPatterns.ts 的 HIGH_RISK_COMMAND_PATTERNS: 字符串子串模式，用于风险等级分类
 *   - 本模块的 DANGEROUS_PATTERNS: 正则模式，用于检测组合攻击模式(fork bomb、反弹 shell 等)
 *   - isDangerousCommand() 先用 riskPatterns.isHighRiskCommand 做预检，
 *     再用 DANGEROUS_PATTERNS 检测组合攻击模式（正则无法用简单子串匹配替代）
 *
 * 边界:
 *   - 不涉及敏感命令的 CRUD 或匹配逻辑
 *   - 不涉及持久化配置
 */

import { isHighRiskCommand } from "./riskPatterns";

// ─── 危险命令检测 ─────────────────────────────────────────

/**
 * 组合攻击模式正则（无法用 riskPatterns 的子串匹配替代）。
 * 以下模式检测的是"组合命令模式"如 fork bomb、反弹 shell、命令链注入，
 * 需要 Regex 的结构化匹配能力。
 *
 * 基础危险命令（rm -rf、dd、mkfs 等）已由 riskPatterns.ts 的
 * HIGH_RISK_COMMAND_PATTERNS 统一管理，isDangerousCommand() 通过
 * isHighRiskCommand() 预检覆盖。
 */
const COMBO_ATTACK_PATTERNS: RegExp[] = [
  /:\(\)\{\s*:\|:&\s*\};:\s*/, // Fork bomb
  /nc\s+-[elLp]\s+/i, // Netcat 反弹 shell
  /mkfifo\s+/i, // 命名管道反弹 shell
  /bash\s+-i\s+[><].*\/dev\//i, // Bash 反弹 shell
  /sh\s+-i\s+[><].*\/dev\//i, // SH 反弹 shell
  /perl\s+-e\s+['"]use\s+Socket/i, // Perl 反弹 shell
  /python.*socket/i, // Python 反弹 shell
  /ruby\s+-rsocket/i, // Ruby 反弹 shell
  /php.*socket_create/i, // PHP 反弹 shell
  /curl\b.*\|\s*(ba)?sh\b/i, // Curl 管道执行 (handles spaces around |)
  /wget\b.*\|\s*(ba)?sh\b/i, // Wget 管道执行 (handles spaces around |)
  /npm\s+audit\s+--force/i, // npm audit --force (silently installs vuln fixes)
  /;\s*(rm|mkfs|dd)\b/i, // 分号连接的危险命令链
  />\s*\/dev\/sd[a-z]/i, // 写入磁盘设备（结构化路径匹配）
  />\s*\/dev\/nvme\d+/i, // 写入 NVMe 设备（结构化路径匹配）
];

/**
 * 检查命令是否包含危险模式。
 *
 * 检测分两层:
 *   1. 预检: 使用 riskPatterns.isHighRiskCommand() 覆盖基础危险命令
 *      （rm -rf、dd、mkfs、sudo、chmod 777 / 等，来自 HIGH_RISK_COMMAND_PATTERNS）
 *   2. 精检: 使用 COMBO_ATTACK_PATTERNS 正则检测组合攻击模式
 *      （fork bomb、反弹 shell、命令链注入等，需要结构化正则匹配）
 *
 * 这些命令几乎不可能是有意执行的，直接阻止。
 */
export function isDangerousCommand(command: string): boolean {
  // 预检: 基础危险命令（来自 riskPatterns.ts HIGH_RISK_COMMAND_PATTERNS）
  if (isHighRiskCommand(command)) {
    return true;
  }
  // 精检: 组合攻击模式（fork bomb、反弹 shell、命令链注入等）
  return COMBO_ATTACK_PATTERNS.some((pattern) => pattern.test(command));
}

// ─── 自毁命令检测 ─────────────────────────────────────────

export interface SelfDestructiveResult {
  isSelfDestructive: boolean;
  reason?: string;
  suggestion?: string;
}

/**
 * 自毁命令检测 — 防止命令杀死 crab-cli 自身进程。
 *
 * crab-cli 运行在 Node.js/Bun 进程中，以下命令会连同 CLI 一起终止:
 *   - Stop-Process (PowerShell) 目标为 node
 *   - taskkill (Windows) 目标为 node.exe
 *   - killall node / pkill node (Unix)
 *   - 直接针对当前 PID 的 kill
 */
export function isSelfDestructiveCommand(command: string): SelfDestructiveResult {
  const lower = command.toLowerCase();
  const cliPid = process.pid;

  if (/\bkill\s+(-\d+\s+)*\$\$/i.test(command) || /\bkill\s+.*\$ppid/i.test(command)) {
    return {
      isSelfDestructive: true,
      reason: "命令会终止当前 shell 或父进程，可能导致当前 CLI 会话中断",
      suggestion: `避免使用 shell 变量直接 kill 当前进程链；当前 CLI PID 为 ${cliPid}。`,
    };
  }

  // PowerShell: Stop-Process targeting node processes
  if (lower.includes("stop-process") && /\b(node|bun|crab(-cli)?)\b/i.test(command)) {
    return {
      isSelfDestructive: true,
      reason: "命令会终止当前 CLI 运行时进程，包括当前会话自身",
      suggestion: `当前 CLI 运行时 PID 为 ${cliPid}。添加 PID 排除过滤器。`,
    };
  }

  // Windows CMD: taskkill targeting node.exe
  if (/\btaskkill\b/i.test(command) && /\b(node|bun|crab(-cli)?)(\.exe)?\b/i.test(command)) {
    return {
      isSelfDestructive: true,
      reason: "命令会终止当前 CLI 运行时进程，包括当前会话自身",
      suggestion: `当前 CLI PID 为 ${cliPid}。使用 "taskkill /PID <目标PID>" 排除 PID ${cliPid}。`,
    };
  }

  // Unix: killall node / bun / crab-cli
  if (/\bkillall\s+(-\w+\s+)*(node|bun|crab(-cli)?)\b/i.test(command)) {
    return {
      isSelfDestructive: true,
      reason: "killall 会终止当前 CLI 运行时或自身命名进程，包括当前会话",
      suggestion: `使用 "kill <具体PID>" 来指定目标进程，排除 PID ${cliPid}。`,
    };
  }

  // Unix: pkill node / bun / crab-cli
  if (/\bpkill\s+(-\w+\s+)*(node|bun|crab(-cli)?)\b/i.test(command)) {
    return {
      isSelfDestructive: true,
      reason: "pkill 会终止当前 CLI 运行时或自身命名进程，包括当前会话",
      suggestion: `使用 "kill <具体PID>" 来指定目标进程，排除 PID ${cliPid}。`,
    };
  }

  // 直接针对 CLI 自身 PID
  const pidPatterns = [
    new RegExp(`\\bkill\\s+(-\\d+\\s+)*${cliPid}\\b`),
    new RegExp(`\\bStop-Process\\s+.*-Id\\s+${cliPid}\\b`, "i"),
    new RegExp(`\\btaskkill\\b.*\\/PID\\s+${cliPid}\\b`, "i"),
  ];
  if (pidPatterns.some((p) => p.test(command))) {
    return {
      isSelfDestructive: true,
      reason: `命令直接针对当前 CLI 进程 (PID: ${cliPid})`,
      suggestion: `PID ${cliPid} 是 crab-cli 进程。终止它会导致当前会话中断。`,
    };
  }

  return { isSelfDestructive: false };
}

// ─── 输出截断 ─────────────────────────────────────────────

/**
 * 截断超长输出。
 */
export function truncateOutput(output: string, maxLength: number): string {
  if (!output) {
    return "";
  }
  if (output.length > maxLength) {
    return `${output.slice(0, maxLength)}\n... (输出已截断)`;
  }
  return output;
}
