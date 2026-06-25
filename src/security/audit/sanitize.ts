/**
 * 审计日志脱敏工具 — 自动检测并遮蔽敏感字段。
 *
 * 脱敏规则:
 *   - 字段名匹配: apiKey, api_key, apiSecret, api_secret, token, password, secret,
 *     authorization, accessToken, access_token, refreshToken, refresh_token,
 *     private_key, privateKey, credentials, cookie, sessionToken
 *   - 脱敏方式: 保留前4字符 + **** + 保留后4字符
 *     - 短值(<9字符): 保留前2 + **** + 保留后2
 *     - 极短值(<5字符): 全部替换为 ****
 *   - 嵌套对象: 递归脱敏 metadata 和 subject 中的对象
 */

/** 需要脱敏的字段名（小写匹配） */
const SENSITIVE_FIELD_NAMES = new Set([
  "apikey",
  "api_key",
  "apisecret",
  "api_secret",
  "token",
  "password",
  "secret",
  "authorization",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "privatekey",
  "private_key",
  "credentials",
  "cookie",
  "sessiontoken",
  "session_token",
  "bearer",
  "xapikey",
  "x_api_key",
  "secretkey",
  "secret_key",
  "passphrase",
  "pin",
]);

/**
 * 脱敏单个值
 */
function maskValue(value: string): string {
  if (value.length < 5) return "****";
  if (value.length < 9) return `${value.slice(0, 2)}****${value.slice(-2)}`;
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

/**
 * 递归脱敏对象中的敏感字段。
 * 返回新对象，不修改原对象。
 */
export function sanitizeAuditData(data: unknown, depth = 0, visited?: Set<object>): unknown {
  if (depth > 5) return data;
  if (data === null || data === undefined) return data;
  if (typeof data === "string") return data;
  if (typeof data !== "object") return data;

  // 循环引用防护: 追踪已访问对象，防止 A→B→C→A 导致栈溢出
  const obj = data as object;
  if (visited?.has(obj)) return data;
  const newVisited = visited ? new Set(visited) : new Set<object>();
  newVisited.add(obj);

  if (Array.isArray(data)) {
    return data.map((item) =>
      typeof item === "object" && item !== null ? sanitizeAuditData(item, depth + 1, newVisited) : item,
    );
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase().replace(/[-_]/g, "");
    if (SENSITIVE_FIELD_NAMES.has(lowerKey) && typeof value === "string") {
      result[key] = maskValue(value);
    } else if (typeof value === "object" && value !== null) {
      result[key] = sanitizeAuditData(value, depth + 1, newVisited);
    } else {
      result[key] = value;
    }
  }
  return result;
}
