/**
 * 统一 ID 生成模块 — 全项目唯一标识符的生成入口。
 *
 * 职责:
 *   - 提供品牌化 ID（带前缀 + ULID，时间有序）
 *   - 提供紧凑 ID（时间戳 + 随机字符，内部使用）
 *   - 提供安全 Nonce（密码学随机，防重放场景）
 *   - 与 schema/ids.ts 的 Zod Schema 配合，确保 ID 格式合规
 *
 * 支持的 ID 格式:
 *   - branded: prefix_ + 26位 ULID（如 ses_01KVQ8JAZSEYT2KNDVWH8PMMNS）
 *   - compact: 时间戳 + 随机字符（如 1715234567890-a1b2c3d4）
 *   - nonce: 纯密码学随机 hex（如 a1b2c3d4e5f6）
 *   - uuid: 标准 UUID v4（如 550e8400-e29b-41d4-a716-446655440000）
 *
 * 使用场景:
 *   - 会话/消息/任务等业务实体 → brandedId
 *   - 内部临时标识（文件名、日志 ID）→ compactId
 *   - 安全场景（Nonce、Token）→ nonce / secureId
 *
 * 边界:
 *   1. ULID 使用 node:crypto.randomBytes 保证密码学安全
 *   2. compactId 使用 Date.now() 时间戳，保证时间有序
 *   3. nonce 仅用于安全场景，不做业务 ID
 *   4. 所有 ID 生成函数均为纯函数，无副作用
 */
import { randomBytes, randomUUID } from "node:crypto";
import { ulid } from "ulid";

// ─── 品牌 ID（带前缀 + ULID）──────────────────────────────────────────

/**
 * 生成品牌化 ID — 前缀 + 26 位 ULID。
 *
 * ULID 特性:
 *   - 48 位时间戳 + 80 位随机数，按 Crockford Base32 编码
 *   - 时间有序: 同一毫秒内生成的 ID 按字典序排列
 *   - 26 个字符，大小写不敏感
 *
 * @param prefix 前缀（如 "ses"、"msg"、"tool"）
 * @returns 格式: "prefix_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
 *
 * @example
 * brandedId("ses")  // "ses_01KVQ8JAZSEYT2KNDVWH8PMMNS"
 * brandedId("task") // "task_01KVQ8JB5N3P0XMEKTSV4RRFFQ"
 */
export function brandedId(prefix: string): string {
  return `${prefix}_${ulid()}`;
}

// ─── 紧凑 ID（时间戳 + 随机）──────────────────────────────────────────

/**
 * 生成紧凑 ID — 时间戳 + 随机字符。
 *
 * 适用于内部临时标识: 文件名、日志条目、连接 ID 等。
 *
 * @param separator 分隔符，默认 "-"
 * @param randomLen 随机字符长度，默认 8
 * @returns 格式: "时间戳分隔符随机字符"
 *
 * @example
 * compactId()                // "1715234567890-a1b2c3d4"
 * compactId("_", 6)          // "1715234567890_f3g4h5"
 */
export function compactId(separator = "-", randomLen = 8): string {
  const rand = randomBytes(randomLen).toString("hex").slice(0, randomLen);
  return `${Date.now()}${separator}${rand}`;
}

/**
 * 生成带前缀的紧凑 ID。
 *
 * @param prefix 前缀（如 "agent"、"task"、"todo"）
 * @param separator 分隔符，默认 "_"
 * @param randomLen 随机字符长度，默认 6
 * @returns 格式: "prefix时间戳分隔符随机字符"
 *
 * @example
 * prefixedId("agent")   // "agent_1715234567890_a1b2c3"
 * prefixedId("todo", "_", 6)  // "todo_1715234567890_f3g4h5"
 */
export function prefixedId(prefix: string, separator = "_", randomLen = 6): string {
  const rand = randomBytes(randomLen).toString("hex").slice(0, randomLen);
  return `${prefix}${separator}${Date.now().toString(36)}${separator}${rand}`;
}

// ─── 安全 ID / Nonce ──────────────────────────────────────────────────

/**
 * 生成密码学安全的随机 hex 字符串。
 *
 * 适用于安全场景: Nonce、认证 Token、会话密钥等。
 *
 * @param bytes 随机字节数，默认 16
 * @returns hex 编码的随机字符串
 *
 * @example
 * secureId()      // "a1b2c3d4e5f67890"  (32 chars)
 * secureId(32)   // "a1b2c3d4e5f67890abcdef01234567890"  (64 chars)
 */
export function secureId(bytes = 16): string {
  return randomBytes(bytes).toString("hex");
}

/**
 * 生成 Nonce — 时间戳 + 密码学随机。
 *
 * 与 secureId 不同，Nonce 包含时间戳用于 TTL 过期检查。
 *
 * @param randomBytesLen 随机字节数，默认 12
 * @returns 格式: "时间戳-随机hex"
 *
 * @example
 * nonce()  // "1715234567890-a1b2c3d4e5f6"
 */
export function nonce(randomBytesLen = 12): string {
  const rand = randomBytes(randomBytesLen).toString("hex");
  return `${Date.now()}-${rand}`;
}

// ─── UUID ──────────────────────────────────────────────────────────────

/**
 * 生成 UUID v4。
 *
 * @example
 * uuid()  // "550e8400-e29b-41d4-a716-446655440000"
 */
export function uuid(): string {
  return randomUUID();
}

/**
 * 生成短 UUID — 去掉横线的 UUID v4。
 *
 * @example
 * shortUuid()  // "550e8400e29b41d4a716446655440000"
 */
export function shortUuid(): string {
  return randomUUID().replace(/-/g, "");
}

// ─── 便捷方法（匹配 schema/ids.ts 中的品牌 ID）───────────────────────

/** 生成会话 ID: ses_ + ULID */
export function sessionId(): string {
  return brandedId("ses");
}

/** 生成消息 ID: msg_ + ULID */
export function messageId(): string {
  return brandedId("msg");
}

/** 生成消息部分 ID: prt_ + ULID */
export function partId(): string {
  return brandedId("prt");
}

/** 生成工具调用 ID: tool_ + ULID */
export function toolCallId(): string {
  return brandedId("tool");
}

/** 生成任务 ID: task_ + ULID */
export function taskId(): string {
  return brandedId("task");
}

/** 生成审计 ID: audit_ + ULID */
export function auditId(): string {
  return brandedId("audit");
}

/** 生成 Agent ID: agent_ + ULID */
export function agentId(): string {
  return brandedId("agent");
}

/** 生成权限 ID: perm_ + ULID */
export function permissionId(): string {
  return brandedId("perm");
}
