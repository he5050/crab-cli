/**
 * Agent 消息序列化 — 跨进程消息传递和版本兼容。
 */
import { createHash } from "node:crypto";
import { createLogger } from "@/core/logging/logger";
import { messageId } from "@/core/id";
import { createAgentError } from "@/core/errors/appError";

const log = createLogger("agent:serializer");

export type MessageType = "request" | "response" | "error" | "event" | "heartbeat" | "close";

export interface SerializedMessage {
  version: number;
  type: MessageType;
  id: string;
  timestamp: number;
  payload: unknown;
  sourceId?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  checksum?: string;
}

export interface AgentMessage<T = unknown> {
  id: string;
  type: MessageType;
  sourceId?: string;
  targetId?: string;
  timestamp: number;
  payload: T;
  metadata?: Record<string, unknown>;
}

export type MigrationFn = (data: unknown) => unknown;

export interface VersionConfig {
  version: number;
  migrations?: MigrationFn[];
}

export const CURRENT_VERSION = 1;
export const MIN_VERSION = 1;

export function generateMessageId(): string {
  return messageId();
}

/**
 * 计算消息的 SHA-256 校验和(取前 16 hex 字符).
 *
 * 设计动机:
 *   - 原实现 (hash << 5) - hash 是 djb2 算法的简化版, 32-bit 空间,
 *     极弱; 不能防篡改, 仅能防意外损坏.
 *   - 改用 SHA-256 后取前 16 hex (64-bit), 兼顾存储开销与碰撞抗性.
 *   - 若需更高强度, 改本函数即可, 不影响调用方.
 *
 * 边界:
 *   1. 跨进程/跨 Node 版本行为一致(crypto.createHash 是 Node 核心 API).
 *   2. 输出格式保持 16 hex 字符(原 8 字符的 2 倍长度, 仍是固定宽度).
 */
function computeChecksum(data: string): string {
  const hash = createHash("sha256").update(data, "utf8").digest("hex");
  return hash.slice(0, 16);
}

function validateMessageStructure(data: unknown): data is SerializedMessage {
  if (typeof data !== "object" || data === null) {
    return false;
  }

  const msg = data as Record<string, unknown>;

  if (typeof msg.version !== "number") {
    log.warn("消息缺少 version 字段");
    return false;
  }

  if (typeof msg.type !== "string") {
    log.warn("消息缺少 type 字段");
    return false;
  }

  if (typeof msg.id !== "string") {
    log.warn("消息缺少 id 字段");
    return false;
  }

  if (typeof msg.timestamp !== "number") {
    log.warn("消息缺少 timestamp 字段");
    return false;
  }

  if (!msg.type || !msg.id) {
    return false;
  }

  return true;
}

export class MessageSerializer {
  private version: number;
  private migrations: Map<number, MigrationFn>;

  constructor(version: number = CURRENT_VERSION) {
    this.version = version;
    this.migrations = new Map();
  }

  registerMigration(fromVersion: number, migration: MigrationFn): void {
    this.migrations.set(fromVersion, migration);
    log.debug(`注册迁移函数: v${fromVersion} -> v${this.version}`);
  }

  serialize(message: AgentMessage): string {
    const withoutChecksum: Omit<SerializedMessage, "checksum"> = {
      id: message.id,
      metadata: message.metadata,
      payload: message.payload,
      sourceId: message.sourceId,
      targetId: message.targetId,
      timestamp: message.timestamp,
      type: message.type,
      version: this.version,
    };

    // 仅一次 JSON.stringify + 字符串拼接追加 checksum，避免双重序列化
    const json = JSON.stringify(withoutChecksum);
    const checksum = computeChecksum(json);
    return `${json.slice(0, -1)},"checksum":"${checksum}"}`;
  }

  deserialize(data: string): AgentMessage {
    let parsed: SerializedMessage;

    try {
      parsed = JSON.parse(data);
    } catch {
      throw createAgentError("AGENT_SERIALIZE_ERROR", `反序列化失败: 无效的 JSON 格式`);
    }

    if (!validateMessageStructure(parsed)) {
      throw createAgentError("AGENT_SERIALIZE_ERROR", `反序列化失败: 消息结构无效`);
    }

    if (parsed.version < MIN_VERSION) {
      throw createAgentError(
        "AGENT_SERIALIZE_ERROR",
        `反序列化失败: 版本 ${parsed.version} 过低，最低支持 v${MIN_VERSION}`,
      );
    }

    if (parsed.version > this.version) {
      throw createAgentError(
        "AGENT_SERIALIZE_ERROR",
        `反序列化失败: 版本 ${parsed.version} 高于当前支持 v${this.version}`,
      );
    }

    if (parsed.checksum) {
      const { checksum: expectedChecksum, ...msgWithoutChecksum } = parsed;
      const jsonWithoutChecksum = JSON.stringify(msgWithoutChecksum);
      const actualChecksum = computeChecksum(jsonWithoutChecksum);

      if (expectedChecksum !== actualChecksum) {
        throw createAgentError("AGENT_SERIALIZE_ERROR", `反序列化失败: 校验和不匹配，消息可能已损坏`);
      }
    }

    if (parsed.version < this.version) {
      parsed = this.migrate(parsed);
    }

    return {
      id: parsed.id,
      metadata: parsed.metadata,
      payload: parsed.payload,
      sourceId: parsed.sourceId,
      targetId: parsed.targetId,
      timestamp: parsed.timestamp,
      type: parsed.type,
    };
  }

  private migrate(message: SerializedMessage): SerializedMessage {
    const current = message;

    for (let v = message.version; v < this.version; v++) {
      const migration = this.migrations.get(v);
      if (migration) {
        log.debug(`执行迁移: v${v} -> v${v + 1}`);
        current.payload = migration(current.payload);
      }
    }

    current.version = this.version;
    return current;
  }

  validate(data: string): { valid: boolean; error?: string } {
    try {
      const parsed = JSON.parse(data);
      if (!validateMessageStructure(parsed)) {
        return { error: "消息结构无效", valid: false };
      }

      if (parsed.version < MIN_VERSION) {
        return { error: `版本 ${parsed.version} 不支持`, valid: false };
      }

      return { valid: true };
    } catch (error) {
      return { error: `JSON 解析失败: ${error instanceof Error ? error.message : String(error)}`, valid: false };
    }
  }

  getVersion(): number {
    return this.version;
  }
}

export function createMessageSerializer(version?: number): MessageSerializer {
  return new MessageSerializer(version);
}

export function createVersionedSerializer(configs: VersionConfig[]): MessageSerializer {
  if (configs.length === 0) {
    // 空配置数组: 退化到默认版本, 避免 Math.max() 返回 -Infinity.
    // 调用方应始终至少传一个 VersionConfig; 此处仅作防御.
    return new MessageSerializer();
  }
  const latestVersion = Math.max(...configs.map((c) => c.version));
  const serializer = new MessageSerializer(latestVersion);

  for (const config of configs) {
    if (config.migrations) {
      for (let v = config.version; v < latestVersion; v++) {
        const migrationIndex = v - config.version;
        if (config.migrations[migrationIndex]) {
          serializer.registerMigration(v, config.migrations[migrationIndex]);
        }
      }
    }
  }

  return serializer;
}

export function serialize(message: AgentMessage): string {
  return createMessageSerializer().serialize(message);
}

export function deserialize<T = unknown>(data: string): AgentMessage<T> {
  const msg = createMessageSerializer().deserialize(data);
  // payload 已在 deserialize 中通过 JSON.parse 还原，此处仅做泛型透传
  return msg as AgentMessage<T>;
}

export function createRequest<T = unknown>(
  payload: T,
  options: {
    id?: string;
    sourceId?: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
  } = {},
): AgentMessage<T> {
  return {
    id: options.id ?? generateMessageId(),
    metadata: options.metadata,
    payload,
    sourceId: options.sourceId,
    targetId: options.targetId,
    timestamp: Date.now(),
    type: "request",
  };
}

export function createResponse<T = unknown>(
  originalId: string,
  payload: T,
  options: {
    sourceId?: string;
    targetId?: string;
  } = {},
): AgentMessage<T> {
  return {
    id: generateMessageId(),
    metadata: { originalId },
    payload,
    sourceId: options.sourceId,
    targetId: options.targetId,
    timestamp: Date.now(),
    type: "response",
  };
}

export function createError(
  originalId: string,
  error: Error | string,
  options: {
    sourceId?: string;
    targetId?: string;
  } = {},
): AgentMessage<{ message: string; stack?: string }> {
  const errorMessage = typeof error === "string" ? error : error.message;
  const errorStack = typeof error === "string" ? undefined : error.stack;

  return {
    id: generateMessageId(),
    metadata: { originalId },
    payload: {
      message: errorMessage,
      stack: errorStack,
    },
    sourceId: options.sourceId,
    targetId: options.targetId,
    timestamp: Date.now(),
    type: "error",
  };
}

export function createHeartbeat(
  agentId: string,
  status: "alive" | "busy" | "idle" = "alive",
): AgentMessage<{ agentId: string; status: string }> {
  return {
    id: generateMessageId(),
    payload: { agentId, status },
    timestamp: Date.now(),
    type: "heartbeat",
  };
}

export function isRequest(msg: AgentMessage): boolean {
  return msg.type === "request";
}

export function isResponse(msg: AgentMessage): boolean {
  return msg.type === "response";
}

export function isError(msg: AgentMessage): boolean {
  return msg.type === "error";
}

export function isHeartbeat(msg: AgentMessage): boolean {
  return msg.type === "heartbeat";
}

export function getOriginalId(msg: AgentMessage): string | undefined {
  return msg.metadata?.originalId as string | undefined;
}
