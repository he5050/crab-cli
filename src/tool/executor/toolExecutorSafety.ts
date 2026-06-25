/**
 * ToolExecutor safety helpers.
 *
 * Keeps permission pattern matching and command safety checks outside the
 * execution orchestration class so runtime behavior can be tested in isolation.
 */

/** 匹配权限标识(支持通配符) */
export function matchPermission(toolPerm: string, rulePerm: string): boolean {
  if (rulePerm === "*") {
    return true;
  }
  if (rulePerm.endsWith(".*")) {
    const prefix = rulePerm.slice(0, -2);
    return toolPerm === prefix || toolPerm.startsWith(`${prefix}.`);
  }
  return toolPerm === rulePerm;
}

/**
 * 匹配参数模式
 *
 * 支持:
 *   - "*" / "**" → 匹配所有
 *   - "rm *" / "git push*" → 匹配 command 字段前缀
 *   - "exact" → 精确匹配 command 字段
 *
 * 对非 terminal 类工具(无 command 字段)，pattern 非 * 时返回 false
 */
/** matchPattern 的实现 */
export function matchPattern(args: Record<string, unknown>, pattern: string): boolean {
  if (pattern === "*" || pattern === "**") {
    return true;
  }

  const command = extractCommandField(args);
  if (!command) {
    return false;
  }

  const cmd = command.toLowerCase().trim();
  const pat = pattern.toLowerCase().trim();

  if (pat.endsWith("*")) {
    const prefix = pat.slice(0, -1).trimEnd();
    return cmd.startsWith(prefix);
  }

  if (pat.startsWith("*")) {
    const suffix = pat.slice(1).trimStart();
    return cmd.endsWith(suffix);
  }

  return cmd === pat;
}

/**
 * 从工具参数中提取命令字符串。
 * 统一处理 command / cmd / script 三种常见命名。
 */
/** extractCommandField 的实现 */
export function extractCommandField(args: Record<string, unknown>): string {
  const command = args.command ?? args.cmd ?? args.script ?? "";
  return typeof command === "string" ? command : "";
}

/**
 * 敏感命令关键词 — 静态硬编码安全拦截层（hard-deny）。
 *
 * ⚠️ 本模块与 @/permission/security/sensitiveCommand 是两个独立的安全层:
 *   - 本模块 (SENSITIVE_PATTERNS): 静态硬编码, 用于 isSensitiveCall(), 检测绝对危险的 shell 命令
 *   - @/permission/security/sensitiveCommand: 用户可配置的通配符模式, 用于权限提示 (soft-confirm)
 *   - 二者职责不同, 不可合并: 一个是安全底线, 一个是权限策略
 */
const SENSITIVE_PATTERNS = [
  /\brm\s+-rf\b/,
  /\brm\s+-r\s+/,
  /\bdd\s+if=/,
  /\bmkfs\b/,
  /\bfdisk\b/,
  /\bformat\b/i,
  /\bshred\b/,
  /\bchmod\s+777\b/,
  /\bchown\s+root\b/,
  />\s*\/dev\//,
  /\bsudo\s+rm\b/,
  /\bgit\s+push\s+--force\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bdrop\s+(table|database)\b/i,
  /\btruncate\s+table\b/i,
  /\bDELETE\s+FROM\b/i,
];

/**
 * 仅包含绝对危险的命令，用于 MCP 外部工具的高危检测。
 * 比 SENSITIVE_PATTERNS 收窄，避免对 MCP 工具正常操作产生误报。
 */
const HIGH_RISK_PATTERNS = [
  /\brm\s+(-[rfRF]+\s+)?\/\s/,
  /\brm\s+(-[rfRF]+\s+)?~\//,
  /\bdd\s+.*of=\/dev\//,
  /\bmkfs\b/,
  /\bshutdown\b/,
  /\breboot\b/,
  />\s*\/dev\//,
  /\b(fdisk|parted|sgdisk)\b/,
];

const COMMAND_INJECTION_SEPARATORS = [/;\s*\w+/, /&&\s*\w+/, /\|\|\s*\w+/, /\|\s*\w+/, /\n\s*\w+/, /\$\(/, /`[^`]*`/];

const DANGEROUS_INJECTED_COMMANDS = [
  /\brm\s+-rf\b/,
  /\bdd\s+/,
  /\bmkfs\b/,
  /\bfdisk\b/,
  /\bcurl\b.*\|\s*\w+/,
  /\bwget\b.*\|\s*\w+/,
  /\beval\b/,
  /\bexec\b/,
  /\bshutdown\b/,
  /\breboot\b/,
];

/** 命令注入检测结果 */
export interface CommandInjectionCheckResult {
  hasInjection: boolean;
  reason?: string;
}

/**
 * 检测命令注入攻击。
 * 场景: git commit -m "fix; rm -rf /"
 *
 * 检测逻辑:
 *   - 标准分隔符(; && || | \n)→ 检查分隔符之后的命令内容
 *   - 子 shell $(command) → 递归检测括号内部的命令内容
 *   - 反引号 `command` → 递归检测反引号内部的命令内容
 *   - 管道后跟子shell $(...) 或反引号 → 递归检测
 */
/** checkCommandInjection 的实现 */
export function checkCommandInjection(command: string): CommandInjectionCheckResult {
  const trimmed = command.trim();

  for (const separator of COMMAND_INJECTION_SEPARATORS) {
    const match = trimmed.match(separator);
    if (!match) {
      continue;
    }

    const isSubshell = separator.source === String.raw`\$\(`;
    const isBacktick = separator.source.startsWith("`");
    let injectedPart: string;

    if (isBacktick && match[0].length > 2) {
      injectedPart = match[0].slice(1, -1).trim();
    } else if (isSubshell) {
      const startIdx = match.index! + 2;
      const rest = trimmed.substring(startIdx);
      const closeParen = rest.indexOf(")");
      injectedPart = closeParen !== -1 ? rest.substring(0, closeParen).trim() : rest.trim();
    } else {
      injectedPart = trimmed.substring(match.index! + match[0].length).trim();
    }

    for (const dangerous of DANGEROUS_INJECTED_COMMANDS) {
      if (dangerous.test(injectedPart)) {
        return {
          hasInjection: true,
          reason: `检测到命令注入攻击: 在 "${match[0]}..." 后检测到危险命令`,
        };
      }
    }

    // 递归检测嵌套的子shell $(...) 和反引号，防止 `| $(rm -rf /)` 或 `| \`rm -rf /\`` 绕过
    if (injectedPart.includes("$(") || injectedPart.includes("`")) {
      const nested = checkCommandInjection(injectedPart);
      if (nested.hasInjection) {
        return {
          hasInjection: true,
          reason: `检测到命令注入攻击: 在 "${match[0]}..." 后检测到嵌套危险命令 — ${nested.reason}`,
        };
      }
    }
  }

  return { hasInjection: false };
}

/**
 * 检测工具调用是否包含敏感命令。
 *
 * 检测策略:
 *   1. 内置终端工具(bash, shell, terminal 等)→ 完整敏感检测。
 *   2. MCP/外部工具(含下划线的非内置终端工具)→ 高危检测。
 *   3. 非终端工具 → 不检测。
 */
/** isSensitiveCall 的实现 */
export function isSensitiveCall(toolName: string, args: Record<string, unknown>): boolean {
  const command = extractCommandField(args);
  if (!command) {
    return false;
  }

  const name = toolName.toLowerCase();

  if (toolName.includes("_")) {
    const isBuiltInTerminal = /^(bash|shell|terminal|exec|command|run|sh|zsh|fish|sql|database)_/.test(name);
    if (isBuiltInTerminal) {
      return SENSITIVE_PATTERNS.some((p) => p.test(command));
    }
    return HIGH_RISK_PATTERNS.some((p) => p.test(command));
  }

  const isTerminalTool = /^(bash|shell|terminal|exec|command|run|sh|zsh|fish|sql|database)([_-]|$)/.test(name);
  if (!isTerminalTool) {
    return false;
  }

  return SENSITIVE_PATTERNS.some((p) => p.test(command));
}
