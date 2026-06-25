/**
 * 审计日志完整性校验 — HMAC-SHA256 签名与验证。
 *
 * 设计:
 *   - 每个 entry 持久化前计算 hmacSha256(secretKey, canonicalJson(entry))
 *   - 写入 entry.integrity 字段(hex 编码)
 *   - 读取时重新计算并比对，失败抛 IntegrityError
 *   - 旧 entry(无 integrity 字段)视为「无签名」——查询仍可读，verify 视为未验证
 *
 * Canonical JSON 规则:按 key 字典序排序后序列化，确保签名稳定。
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export class IntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrityError";
  }
}

/** 稳定 JSON 序列化:键按字典序排序后输出。 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).toSorted();
  const parts: string[] = [];
  for (const key of keys) {
    parts.push(`${JSON.stringify(key)}:${canonicalJson(obj[key])}`);
  }
  return `{${parts.join(",")}}`;
}

/** 对 `entry` 的 canonical JSON 计算 hex 编码的 HMAC-SHA256。 */
export function signEntry(entry: unknown, secretKey: string | Buffer): string {
  if (!secretKey) {
    throw new IntegrityError("审计日志密钥未配置，无法计算完整性签名");
  }
  const payload = canonicalJson(entry);
  return createHmac("sha256", secretKey).update(payload, "utf8").digest("hex");
}

/**
 * 校验 entry 上的完整性字段。返回:
 *   - `true`  签名匹配(entry 已签名且未被篡改)
 *   - `false` entry 没有 integrity 字段(旧版/未签名)
 * 若 entry 已有签名但与重新计算值不匹配，抛 `IntegrityError`。
 */
export function verifyEntry(
  entry: { integrity?: string; [key: string]: unknown },
  secretKey: string | Buffer,
): boolean {
  if (!entry.integrity) {
    return false;
  }
  if (!secretKey) {
    throw new IntegrityError("审计日志密钥未配置，无法验证完整性");
  }
  // 重新计算签名（排除 integrity 字段本身）
  const rest: Record<string, unknown> = {};
  for (const key of Object.keys(entry)) {
    if (key === "integrity") {
      continue;
    }
    rest[key] = entry[key];
  }
  const expected = signEntry(rest, secretKey);
  const a = Buffer.from(entry.integrity, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) {
    throw new IntegrityError(`审计日志完整性校验失败:${String((entry as { id?: unknown }).id ?? "(unknown id)")}`);
  }
  if (!timingSafeEqual(a, b)) {
    throw new IntegrityError(`审计日志完整性校验失败:${String((entry as { id?: unknown }).id ?? "(unknown id)")}`);
  }
  return true;
}

/**
 * 为 entry 添加或刷新 integrity 签名字段。
 * 返回新对象，不修改原输入（与审计日志的不可变模式一致）。
 */
export function stampEntry<T extends object>(entry: T, secretKey: string | Buffer): T & { integrity: string } {
  const rest: Record<string, unknown> = {};
  for (const key of Object.keys(entry)) {
    if (key === "integrity") {
      continue;
    }
    rest[key] = (entry as Record<string, unknown>)[key];
  }
  const signature = signEntry(rest, secretKey);
  return { ...rest, integrity: signature } as T & { integrity: string };
}
