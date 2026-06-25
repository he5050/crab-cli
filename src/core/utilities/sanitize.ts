/**
 * 敏感信息过滤与文本脱敏工具。
 *
 * 职责:
 *   - 检测和替换文本中的敏感信息(API key、token、密码等)
 *   - 统一的文本截断
 *   - 供 tool-executor、compaction、UI 层共同使用
 *
 * 模块功能:
 *   - sanitizeSensitiveInfo: 对敏感信息进行脱敏处理
 *   - containsSensitiveInfo: 检查是否包含敏感信息
 *   - truncateString: 截断文本到指定长度
 *   - sanitizeAndTruncate: 先脱敏再截断
 *
 * 使用场景:
 *   - 日志记录前脱敏
 *   - 工具输出序列化
 *   - 用户输入安全检查
 *   - 文本展示截断
 *
 * 边界:
 *   1. 纯函数，无副作用，不读写文件
 *   2. 基于正则表达式匹配敏感信息
 *   3. 支持多种敏感信息格式
 *
 * 流程:
 *   1. 接收原始文本
 *   2. 使用正则匹配敏感信息
 *   3. 替换为脱敏标记
 *   4. 截断到指定长度(如需要)
 *   5. 返回处理后的文本
 */
import { createLogger } from "@/core/logging/logger";

const log = createLogger("core:sanitize");

// ─── 敏感信息检测模式 ──────────────────────────────────────

/** 需要脱敏的敏感信息正则列表 */
const SENSITIVE_CONTENT_PATTERNS: { pattern: RegExp; label: string }[] = [
  // API Key(常见格式)
  { label: "API_KEY", pattern: /\b(sk-[a-zA-Z0-9]{20,})\b/g },
  { label: "PUBLIC_KEY", pattern: /\b(pk_[a-z]+_[a-zA-Z0-9]{20,})\b/g },
  { label: "API_KEY", pattern: /\b(key-[a-zA-Z0-9]{20,})\b/g },
  // Bearer Token
  { label: "BEARER_TOKEN", pattern: /\b(Bearer\s+)([a-zA-Z0-9\-_.]{20,})\b/g },
  // 通用 token/secret 模式
  { label: "TOKEN", pattern: /\b(token[=:]\s*["']?)([a-zA-Z0-9\-_.]{16,})(["']?)\b/gi },
  { label: "SECRET", pattern: /\b(secret[=:]\s*["']?)([a-zA-Z0-9\-_.]{8,})(["']?)\b/gi },
  { label: "PASSWORD", pattern: /\b(password[=:]\s*["']?)([^\s"'<>]{4,})(["']?)\b/gi },
  // AWS 密钥
  { label: "AWS_ACCESS_KEY", pattern: /\b(AKIA[A-Z0-9]{16})\b/g },
  // 私钥标记
  {
    label: "PRIVATE_KEY",
    pattern: /(-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----)[\s\S]*?(-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----)/g,
  },
  // 含密码的连接字符串
  { label: "DB_CONNECTION_STRING", pattern: /(mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis):\/\/[^:]+:([^@]+)@/g },
  // Authorization 请求头
  { label: "AUTH_HEADER", pattern: /\b(Authorization:\s*Basic\s+)([a-zA-Z0-9+/=]{8,})\b/g },
];

const PROMPT_INJECTION_PATTERNS: { pattern: RegExp; label: string }[] = [
  { label: "role_override", pattern: /\byou\s+are\s+now\b/i },
  {
    label: "instruction_override",
    pattern: /\bignore\s+(?:all\s+)?(?:(?:your|the)\s+)?(?:previous|prior|above|original)\s+instructions?\b/i,
  },
  { label: "system_prompt_override", pattern: /\bsystem\s+prompt\s*:/i },
  { label: "tagged_instruction_override", pattern: /\[(?:system|developer|override|previous message)\]/i },
  { label: "role_reassignment", pattern: /\bfrom\s+now\s+on\s+you\s+are\b/i },
  {
    label: "secret_exfiltration",
    pattern: /\breveal(?:s|ing)?\s+(?:all\s+)?(?:your\s+)?(?:system\s+prompt|secrets?)\b/i,
  },
  { label: "jailbreak_instruction", pattern: /\bdo\s+anything\s+(?:now|you\s+want)\b/i },
];

export interface PromptInjectionCheck {
  isInjection: boolean;
  labels: string[];
}

// ─── 脱敏函数 ──────────────────────────────────────────────

/**
 * 对文本中的敏感信息进行脱敏处理。
 * 将 API key、token、密码等替换为 `[LABEL_REDACTED]` 标记。
 *
 * @param text - 原始文本
 * @param options - 脱敏选项
 * @returns 脱敏后的文本
 */
export function sanitizeSensitiveInfo(text: string, options?: { preserveLength?: boolean }): string {
  let result = text;

  for (const { pattern, label } of SENSITIVE_CONTENT_PATTERNS) {
    // 重置正则状态(patterns 带 global 标志，需要每次新建实例)
    const regex = new RegExp(pattern.source, pattern.flags);
    result = result.replace(regex, (match, ...groups) => {
      // 提取捕获的 secret 捕获组(去掉最后的 offset 与 source 字符串参数)
      // 对于 "(Bearer\s+)(token)" 这类带前缀的模式，仅替换 secret 部分
      const captured = groups.slice(0, -2); // 去掉 offset 和 source 字符串
      if (captured.length >= 2) {
        // 包含 prefix + secret + 可选 suffix
        const prefix = captured[0] ?? "";
        const secret = captured[1] ?? "";
        const suffix = captured[2] ?? "";
        if (options?.preserveLength) {
          const masked = secret.slice(0, 4) + "*".repeat(Math.max(0, secret.length - 4));
          return `${prefix}${masked}${suffix}`;
        }
        return `${prefix}[${label}_REDACTED]${suffix}`;
      }
      // 单一捕获组 — 替换整段匹配
      if (options?.preserveLength) {
        const masked = match.slice(0, 4) + "*".repeat(Math.max(0, match.length - 4));
        return masked;
      }
      return `[${label}_REDACTED]`;
    });
  }

  return result;
}

/**
 * 检查文本是否包含敏感信息(不执行替换)。
 */
export function containsSensitiveInfo(text: string): boolean {
  for (const { pattern } of SENSITIVE_CONTENT_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    if (regex.test(text)) {
      return true;
    }
  }
  return false;
}

export function detectPromptInjection(text: string): PromptInjectionCheck {
  const labels = new Set<string>();
  for (const { pattern, label } of PROMPT_INJECTION_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    if (regex.test(text)) {
      labels.add(label);
    }
  }
  return { isInjection: labels.size > 0, labels: [...labels] };
}

export function sanitizePromptInjection(text: string): string {
  let result = text;
  for (const { pattern, label } of PROMPT_INJECTION_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    result = result.replace(regex, `[PROMPT_INJECTION_${label.toUpperCase()}]`);
  }
  return result;
}

// ─── 统一截断函数 ──────────────────────────────────────────

/**
 * 截断文本到指定长度(替代各处散落的 truncateStr)。
 * 截断时附加可读的后缀提示。
 *
 * @param str - 原始文本
 * @param maxLen - 最大长度
 * @returns 截断后的文本
 */
export function truncateString(str: string, maxLen: number): string {
  if (str.length <= maxLen) {
    return str;
  }
  return `${str.slice(0, maxLen)}\n...[截断，原始长度 ${str.length} 字符]`;
}

/**
 * 截断并脱敏:先脱敏敏感信息，再截断到指定长度。
 * 适用于工具输出序列化、日志记录等场景。
 */
export function sanitizeAndTruncate(str: string, maxLen: number): string {
  const sanitized = sanitizeSensitiveInfo(str);
  return truncateString(sanitized, maxLen);
}
