/**
 * Agent 状态快照 Schema — 定义快照数据结构和版本管理。
 *
 * 职责:
 *   - 定义快照数据类型和结构
 *   - Schema 版本管理
 *   - 提供快照创建辅助函数
 *
 * 快照数据结构:
 *   - version: Schema 版本号
 *   - agentId: Agent 标识
 *   - timestamp: 快照时间戳
 *   - state: Agent 状态
 *   - context: 执行上下文
 *   - metadata: 额外元数据
 *
 * 边界:
 *   1. Schema 版本独立于消息协议版本
 *   2. 支持向后兼容和升级
 */

import { createLogger } from "@/core/logging/logger";

const log = createLogger("agent:snapshot:schema");

// ─── 类型定义 ─────────────────────────────────────────────────────

/** Agent 状态 */
export type AgentState = "idle" | "initializing" | "running" | "waiting" | "completed" | "failed" | "cancelled";

/** 快照元数据 */
export interface SnapshotMetadata {
  /** 快照创建时间 */
  createdAt: number;
  /** 快照标签 */
  label?: string;
  /** 创建原因 */
  reason?: "manual" | "auto" | "error" | "timeout" | "shutdown";
  /** 序列化的字节大小 */
  sizeBytes?: number;
}

/** Agent 上下文信息 */
export interface SnapshotContext {
  /** 当前步骤索引 */
  stepIndex: number;
  /** 最大步骤数 */
  maxSteps?: number;
  /** 当前工具调用 */
  currentTool?: string;
  /** 工具调用历史 */
  toolCalls: {
    tool: string;
    args: Record<string, unknown>;
    result?: unknown;
    timestamp: number;
    durationMs?: number;
  }[];
  /** 内存使用(字节) */
  memoryUsage?: number;
  /** CPU 时间(毫秒) */
  cpuTimeMs?: number;
}

/** Agent 快照 */
export interface AgentSnapshot {
  /** Schema 版本 */
  version: number;
  /** Agent ID */
  agentId: string;
  /** Agent 名称 */
  agentName: string;
  /** 快照时间戳 */
  timestamp: number;
  /** Agent 状态 */
  state: AgentState;
  /** 错误信息(如果失败) */
  error?: {
    message: string;
    code?: string;
    stack?: string;
  };
  /** 执行上下文 */
  context: SnapshotContext;
  /** 快照元数据 */
  metadata: SnapshotMetadata;
  /** 自定义数据 */
  data?: Record<string, unknown>;
}

// ─── Schema 版本常量 ─────────────────────────────────────────────────────

/** 当前 Schema 版本 */
export const CURRENT_SCHEMA_VERSION = 1;

/** 最小支持 Schema 版本 */
export const MIN_SCHEMA_VERSION = 1;

/** Schema 版本范围 */
export const SUPPORTED_SCHEMA_VERSIONS: readonly number[] = [1];

// ─── Schema 验证规则 ─────────────────────────────────────────────────────

/** 状态快照必需字段 */
export const REQUIRED_SNAPSHOT_FIELDS: (keyof AgentSnapshot)[] = [
  "version",
  "agentId",
  "agentName",
  "timestamp",
  "state",
  "context",
  "metadata",
];

/** 必需的执行上下文字段 */
export const REQUIRED_CONTEXT_FIELDS: (keyof SnapshotContext)[] = ["stepIndex", "toolCalls"];

// ─── 快照创建 ─────────────────────────────────────────────────────

/**
 * 创建空快照
 */
export function createEmptySnapshot(agentId: string, agentName: string): AgentSnapshot {
  return {
    agentId,
    agentName,
    context: {
      stepIndex: 0,
      toolCalls: [],
    },
    metadata: {
      createdAt: Date.now(),
      reason: "manual",
    },
    state: "idle",
    timestamp: Date.now(),
    version: CURRENT_SCHEMA_VERSION,
  };
}

/**
 * 从当前状态创建快照
 */
export function createSnapshot(
  agentId: string,
  agentName: string,
  state: AgentState,
  context: Partial<SnapshotContext>,
  options: {
    label?: string;
    reason?: SnapshotMetadata["reason"];
    error?: AgentSnapshot["error"];
    data?: Record<string, unknown>;
  } = {},
): AgentSnapshot {
  return {
    agentId,
    agentName,
    context: {
      cpuTimeMs: context.cpuTimeMs,
      currentTool: context.currentTool,
      maxSteps: context.maxSteps,
      memoryUsage: context.memoryUsage,
      stepIndex: context.stepIndex ?? 0,
      toolCalls: context.toolCalls ?? [],
    },
    data: options.data,
    error: options.error,
    metadata: {
      createdAt: Date.now(),
      label: options.label,
      reason: options.reason ?? "auto",
    },
    state,
    timestamp: Date.now(),
    version: CURRENT_SCHEMA_VERSION,
  };
}

/**
 * 深拷贝快照对象
 */
function deepCloneSnapshot(snapshot: AgentSnapshot): AgentSnapshot {
  if (typeof structuredClone === "function") {
    return structuredClone(snapshot);
  }
  // 降级:递归浅拷贝(覆盖已知嵌套字段)
  return {
    ...snapshot,
    context: {
      ...snapshot.context,
      toolCalls: snapshot.context.toolCalls.map((tc) => ({ ...tc })),
    },
    error: snapshot.error ? { ...snapshot.error } : undefined,
    metadata: { ...snapshot.metadata },
    data: snapshot.data ? { ...snapshot.data } : undefined,
  };
}

/**
 * 复制快照(更新版本)
 */
export function cloneSnapshot(
  snapshot: AgentSnapshot,
  updates: Partial<Omit<AgentSnapshot, "version" | "agentId">>,
): AgentSnapshot {
  const cloned = deepCloneSnapshot(snapshot);
  const merged: AgentSnapshot = {
    ...cloned,
    ...updates,
    context: {
      ...cloned.context,
      ...updates.context,
    },
    metadata: {
      ...cloned.metadata,
      ...updates.metadata,
      createdAt: Date.now(),
      reason: "auto",
    },
    timestamp: Date.now(),
    version: CURRENT_SCHEMA_VERSION,
  };
  return merged;
}

// ─── Schema 版本迁移 ─────────────────────────────────────────────────────

/**
 * 快照迁移函数类型
 */
export type SnapshotMigrationFn = (snapshot: unknown) => AgentSnapshot;

/**
 * 获取指定版本的迁移函数
 */
export function getMigrationFn(targetVersion: number): SnapshotMigrationFn | null {
  // 当前只有版本 1，无需迁移
  if (targetVersion === 1) {
    return (snapshot) => snapshot as AgentSnapshot;
  }

  log.warn(`不支持的 Schema 版本: v${targetVersion}`);
  return null;
}

// ─── Schema 信息 ─────────────────────────────────────────────────────

/**
 * 获取 Schema 版本信息
 */
export function getSchemaVersionInfo(): {
  current: number;
  min: number;
  supported: readonly number[];
} {
  return {
    current: CURRENT_SCHEMA_VERSION,
    min: MIN_SCHEMA_VERSION,
    supported: SUPPORTED_SCHEMA_VERSIONS,
  };
}

/**
 * 检查版本是否支持
 */
export function isVersionSupported(version: number): boolean {
  return SUPPORTED_SCHEMA_VERSIONS.includes(version);
}

// ─── 快照合并 ─────────────────────────────────────────────────────

/**
 * 合并两个快照(用于增量快照)
 */
export function mergeSnapshots(base: AgentSnapshot, update: Partial<AgentSnapshot>): AgentSnapshot {
  const clonedBase = deepCloneSnapshot(base);
  return {
    ...clonedBase,
    ...update,
    context: {
      ...clonedBase.context,
      ...update.context,
    },
    metadata: {
      ...clonedBase.metadata,
      ...update.metadata,
      createdAt: Date.now(),
    },
    timestamp: Date.now(),
    version: CURRENT_SCHEMA_VERSION,
  };
}
