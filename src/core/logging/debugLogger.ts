/**
 * 调试日志脱敏工具 — 安全记录请求/响应内容。
 *
 * 职责:
 *   - 脱敏敏感信息（API keys、tokens、credentials）
 *   - 截断过长内容
 *   - 提供结构化调试日志
 *
 * 使用场景:
 *   - LLM 请求/响应调试
 *   - API 调用日志记录
 *   - 工具执行调试
 *
 * 注意: 本模块的 SENSITIVE_PATTERNS 与 @core/utilities/sanitize 中的
 * SENSITIVE_CONTENT_PATTERNS 有部分重叠。后者是项目统一的敏感信息检测源。
 * 本模块保留独立模式是因为调试日志场景需要更细粒度的 JSON 字段匹配
 * （如 "password"、"authorization" 等 JSON key），而 sanitize 侧重于文本流匹配。
 * 未来可考虑将两者统一为一份正则注册表。
 */
import { createLogger } from "@/core/logging/logger";

const log = createLogger("debug-sanitizer");

const SENSITIVE_PATTERNS = [
  { name: "api_key", regex: /sk-[a-zA-Z0-9]{20,}/g },
  { name: "bearer", regex: /Bearer\s+[a-zA-Z0-9_.-]{20,}/g },
  { name: "password", regex: /("password"\s*:\s*)"([^"]*)"/gi },
  { name: "secret", regex: /("secret"\s*:\s*)"([^"]*)"/gi },
  { name: "token", regex: /("token"\s*:\s*)"([^"]*)"/gi },
  { name: "authorization", regex: /("authorization"\s*:\s*)"([^"]*)"/gi },
  { name: "api_key_json", regex: /("api_key"\s*:\s*)"([^"]*)"/gi },
  { name: "access_key", regex: /(?:AK|ak)[a-zA-Z0-9]{10,}/g },
];

const MAX_LOG_LENGTH = 2000;

export interface SanitizeOptions {
  maxLength?: number;
  redactSensitive?: boolean;
}

export function sanitizeString(input: string, options: SanitizeOptions = {}): string {
  const { maxLength = MAX_LOG_LENGTH, redactSensitive = true } = options;

  let result = input;

  if (redactSensitive) {
    for (const { name, regex } of SENSITIVE_PATTERNS) {
      result = result.replace(regex, (match, group1, group2) => {
        if (group2 !== undefined) {
          return `${group1}"[REDACTED_${name.toUpperCase()}]"`;
        }
        return `[REDACTED_${name.toUpperCase()}]`;
      });
    }
  }

  if (result.length > maxLength) {
    const truncated = result.slice(0, maxLength);
    const omitted = result.length - maxLength;
    return `${truncated}\n... [TRUNCATED: ${omitted} chars omitted]`;
  }

  return result;
}

export function sanitizeObject<T extends object>(obj: T, options: SanitizeOptions = {}): T {
  const { maxLength = MAX_LOG_LENGTH, redactSensitive = true } = options;
  const json = JSON.stringify(obj, null, 2);
  const sanitized = sanitizeString(json, { maxLength, redactSensitive });

  try {
    return JSON.parse(sanitized) as T;
  } catch {
    return { _sanitized: sanitized, _truncated: sanitized.length >= maxLength } as T;
  }
}

export function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const sensitive = new Set([
    "authorization",
    "x-api-key",
    "cookie",
    "set-cookie",
    "proxy-authorization",
    "www-authenticate",
  ]);

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (sensitive.has(lower)) {
      result[key] = "[REDACTED]";
    } else if (value.length > 500) {
      result[key] = `${value.slice(0, 500)}... (${value.length - 500} chars omitted)`;
    } else {
      result[key] = value;
    }
  }
  return result;
}

export interface DebugLogContext {
  requestId?: string;
  sessionId?: string;
  providerId?: string;
  modelId?: string;
  toolName?: string;
}

export function logRequest(
  context: DebugLogContext,
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: unknown,
): void {
  log.debug(`[HTTP] ${method} ${url}`, {
    ...context,
    sanitizedHeaders: sanitizeHeaders(headers),
    body: body ? sanitizeObject(body as object) : undefined,
  });
}

export function logResponse(
  context: DebugLogContext,
  status: number,
  headers: Record<string, string>,
  body?: unknown,
  durationMs?: number,
): void {
  log.debug(`[HTTP] ${status} ${durationMs !== undefined ? `${durationMs}ms` : ""}`, {
    ...context,
    status,
    sanitizedHeaders: sanitizeHeaders(headers),
    body: body ? sanitizeObject(body as object) : undefined,
    durationMs,
  });
}

export function logToolCall(context: DebugLogContext, toolName: string, params: unknown): void {
  log.debug(`[TOOL] ${toolName}`, {
    ...context,
    toolName,
    params: params ? sanitizeObject(params as object) : undefined,
  });
}

export function logToolResult(context: DebugLogContext, toolName: string, result: unknown, durationMs?: number): void {
  log.debug(`[TOOL] ${toolName} → ${durationMs !== undefined ? `${durationMs}ms` : ""}`, {
    ...context,
    toolName,
    result: result ? sanitizeObject(result as object) : undefined,
    durationMs,
  });
}

export function logLlmRequest(context: DebugLogContext, messages: unknown, options?: unknown): void {
  log.debug(`[LLM] request (${context.providerId}/${context.modelId})`, {
    ...context,
    messages: messages ? sanitizeObject(messages as object) : undefined,
    options: options ? sanitizeObject(options as object) : undefined,
  });
}

export function logLlmResponse(
  context: DebugLogContext,
  text: string,
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number },
  durationMs?: number,
): void {
  log.debug(
    `[LLM] response (${context.providerId}/${context.modelId})${durationMs !== undefined ? ` ${durationMs}ms` : ""}`,
    {
      ...context,
      text: sanitizeString(text),
      usage,
      durationMs,
    },
  );
}
