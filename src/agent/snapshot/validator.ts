/**
 * 快照验证器 — 验证快照数据的完整性和正确性。
 *
 * 职责:
 *   - 验证快照数据结构
 *   - 验证快照字段类型
 *   - 验证快照业务规则
 *   - 提供详细的验证错误信息
 *
 * 验证层次:
 *   1. 结构验证:必需字段是否存在
 *   2. 类型验证:字段类型是否正确
 *   3. 值域验证:字段值是否在有效范围内
 *   4. 业务规则验证:快照内部逻辑一致性
 *
 * 边界:
 *   1. 不修改原始快照数据
 *   2. 验证失败返回详细的错误信息
 *   3. 支持部分验证(仅验证特定字段)
 */

import { createLogger } from "@/core/logging/logger";
import type { AgentSnapshot, AgentState, SnapshotContext } from "./schema";
import {
  CURRENT_SCHEMA_VERSION,
  MIN_SCHEMA_VERSION,
  REQUIRED_CONTEXT_FIELDS,
  REQUIRED_SNAPSHOT_FIELDS,
  isVersionSupported,
} from "./schema";

const log = createLogger("agent:snapshot:validator");

// ─── 验证结果类型 ─────────────────────────────────────────────────────

/** 验证错误 */
export interface ValidationError {
  /** 错误路径 */
  path: string;
  /** 错误消息 */
  message: string;
  /** 错误代码 */
  code: string;
}

/** 验证结果 */
export interface ValidationResult {
  /** 是否通过验证 */
  valid: boolean;
  /** 错误列表 */
  errors: ValidationError[];
  /** 警告列表(不影响有效性) */
  warnings: ValidationError[];
}

// ─── 验证器类 ─────────────────────────────────────────────────────

/**
 * 快照验证器
 */
export class SnapshotValidator {
  private strict: boolean;

  /**
   * @param strict 严格模式:验证所有可能的错误，而非快速返回
   */
  constructor(strict = false) {
    this.strict = strict;
  }

  /**
   * 验证快照完整性
   */
  validate(snapshot: unknown): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    // 基本类型检查
    if (typeof snapshot !== "object" || snapshot === null) {
      return {
        errors: [
          {
            code: "INVALID_TYPE",
            message: "快照必须是对象类型",
            path: "$",
          },
        ],
        valid: false,
        warnings: [],
      };
    }

    const snap = snapshot as Record<string, unknown>;

    // 1. 结构验证
    this.validateStructure(snap, errors);

    // 如果结构验证失败，可能导致后续验证崩溃
    if (errors.length > 0 && !this.strict) {
      return { errors, valid: false, warnings };
    }

    // 2. 类型验证
    this.validateTypes(snap, errors, warnings);

    // 3. 值域验证
    this.validateValues(snap as unknown as AgentSnapshot, errors, warnings);

    // 4. 业务规则验证
    this.validateBusinessRules(snap as unknown as AgentSnapshot, errors, warnings);

    return {
      errors,
      valid: errors.length === 0,
      warnings,
    };
  }

  /**
   * 快速验证(仅检查必需字段)
   */
  validateRequired(snapshot: unknown): ValidationResult {
    const errors: ValidationError[] = [];

    if (typeof snapshot !== "object" || snapshot === null) {
      errors.push({
        code: "INVALID_TYPE",
        message: "快照必须是对象类型",
        path: "$",
      });
      return { errors, valid: false, warnings: [] };
    }

    const snap = snapshot as Record<string, unknown>;

    for (const field of REQUIRED_SNAPSHOT_FIELDS) {
      if (!(field in snap)) {
        errors.push({
          code: "MISSING_FIELD",
          message: `缺少必需字段: ${field}`,
          path: `$.${field}`,
        });
      }
    }

    return { errors, valid: errors.length === 0, warnings: [] };
  }

  /**
   * 验证快照结构(必需字段)
   */
  private validateStructure(snap: Record<string, unknown>, errors: ValidationError[]): void {
    for (const field of REQUIRED_SNAPSHOT_FIELDS) {
      if (!(field in snap)) {
        errors.push({
          code: "MISSING_FIELD",
          message: `缺少必需字段: ${field}`,
          path: `$.${field}`,
        });
      }
    }

    // 验证 context 内部结构
    if ("context" in snap && typeof snap.context === "object" && snap.context !== null) {
      const ctx = snap.context as Record<string, unknown>;
      for (const field of REQUIRED_CONTEXT_FIELDS) {
        if (!(field in ctx)) {
          errors.push({
            code: "MISSING_CONTEXT_FIELD",
            message: `缺少必需的上下文字段: ${field}`,
            path: `$.context.${field}`,
          });
        }
      }
    }

    // 验证 metadata 内部结构
    if ("metadata" in snap && typeof snap.metadata === "object" && snap.metadata !== null) {
      const meta = snap.metadata as Record<string, unknown>;
      if (!("createdAt" in meta)) {
        errors.push({
          code: "MISSING_METADATA_FIELD",
          message: `缺少必需的元数字段: createdAt`,
          path: `$.metadata.createdAt`,
        });
      }
    }
  }

  /**
   * 验证字段类型
   */
  private validateTypes(snap: Record<string, unknown>, errors: ValidationError[], warnings: ValidationError[]): void {
    // Version
    if ("version" in snap && typeof snap.version !== "number") {
      errors.push({
        code: "INVALID_TYPE",
        message: "version 必须是数字类型",
        path: "$.version",
      });
    }

    // AgentId
    if ("agentId" in snap && typeof snap.agentId !== "string") {
      errors.push({
        code: "INVALID_TYPE",
        message: "agentId 必须是字符串类型",
        path: "$.agentId",
      });
    }

    // AgentName
    if ("agentName" in snap && typeof snap.agentName !== "string") {
      errors.push({
        code: "INVALID_TYPE",
        message: "agentName 必须是字符串类型",
        path: "$.agentName",
      });
    }

    // Timestamp
    if ("timestamp" in snap && typeof snap.timestamp !== "number") {
      errors.push({
        code: "INVALID_TYPE",
        message: "timestamp 必须是数字类型",
        path: "$.timestamp",
      });
    }

    // State
    if ("state" in snap && typeof snap.state !== "string") {
      errors.push({
        code: "INVALID_TYPE",
        message: "state 必须是字符串类型",
        path: "$.state",
      });
    }

    // Context
    if ("context" in snap && typeof snap.context !== "object") {
      errors.push({
        code: "INVALID_TYPE",
        message: "context 必须是对象类型",
        path: "$.context",
      });
    }

    // StepIndex
    if ("context" in snap && typeof snap.context === "object") {
      const ctx = snap.context as Record<string, unknown>;
      if ("stepIndex" in ctx && typeof ctx.stepIndex !== "number") {
        errors.push({
          code: "INVALID_TYPE",
          message: "stepIndex 必须是数字类型",
          path: "$.context.stepIndex",
        });
      }

      // ToolCalls
      if ("toolCalls" in ctx && !Array.isArray(ctx.toolCalls)) {
        errors.push({
          code: "INVALID_TYPE",
          message: "toolCalls 必须是数组类型",
          path: "$.context.toolCalls",
        });
      }
    }

    // Metadata
    if ("metadata" in snap && typeof snap.metadata !== "object") {
      errors.push({
        code: "INVALID_TYPE",
        message: "metadata 必须是对象类型",
        path: "$.metadata",
      });
    }

    // 警告:data 应该是对象或 undefined
    if ("data" in snap && typeof snap.data !== "object" && snap.data !== undefined) {
      warnings.push({
        code: "WARN_TYPE",
        message: "data 建议为对象类型",
        path: "$.data",
      });
    }
  }

  /**
   * 验证字段值范围
   */
  private validateValues(snap: AgentSnapshot, errors: ValidationError[], warnings: ValidationError[]): void {
    // Version 范围
    if (typeof snap.version === "number") {
      if (!isVersionSupported(snap.version)) {
        errors.push({
          code: "UNSUPPORTED_VERSION",
          message: `不支持的 Schema 版本: v${snap.version}`,
          path: "$.version",
        });
      }
    }

    // Timestamp 范围
    if (typeof snap.timestamp === "number") {
      const now = Date.now();
      if (snap.timestamp > now + 60_000) {
        // 未来 1 分钟内
        warnings.push({
          code: "WARN_FUTURE_TIMESTAMP",
          message: "timestamp 超过当前时间，可能来自未来",
          path: "$.timestamp",
        });
      }
      if (snap.timestamp < now - 30 * 24 * 60 * 60 * 1000) {
        // 30 天前
        warnings.push({
          code: "WARN_OLD_SNAPSHOT",
          message: "timestamp 超过 30 天，可能是旧快照",
          path: "$.timestamp",
        });
      }
    }

    // State 值域
    if (typeof snap.state === "string") {
      const validStates: AgentState[] = [
        "idle",
        "initializing",
        "running",
        "waiting",
        "completed",
        "failed",
        "cancelled",
      ];
      if (!validStates.includes(snap.state as AgentState)) {
        errors.push({
          code: "INVALID_STATE",
          message: `无效的 Agent 状态: ${snap.state}`,
          path: "$.state",
        });
      }
    }

    // StepIndex 值域
    if (typeof snap.context?.stepIndex === "number") {
      if (snap.context.stepIndex < 0) {
        errors.push({
          code: "INVALID_STEP_INDEX",
          message: "stepIndex 不能为负数",
          path: "$.context.stepIndex",
        });
      }

      if (typeof snap.context.maxSteps === "number" && snap.context.stepIndex > snap.context.maxSteps) {
        errors.push({
          code: "STEP_INDEX_EXCEEDS_MAX",
          message: `stepIndex (${snap.context.stepIndex}) 超过 maxSteps (${snap.context.maxSteps})`,
          path: "$.context.stepIndex",
        });
      }
    }

    // Metadata.createdAt 值域
    if (typeof snap.metadata?.createdAt === "number") {
      if (snap.metadata.createdAt > Date.now() + 60_000) {
        warnings.push({
          code: "WARN_FUTURE_TIMESTAMP",
          message: "metadata.createdAt 超过当前时间",
          path: "$.metadata.createdAt",
        });
      }
    }

    // Error 字段(如果存在)
    if (snap.error) {
      if (!snap.error.message) {
        errors.push({
          code: "MISSING_ERROR_MESSAGE",
          message: "error.message 不能为空",
          path: "$.error.message",
        });
      }
    }
  }

  /**
   * 验证业务规则
   */
  private validateBusinessRules(snap: AgentSnapshot, errors: ValidationError[], warnings: ValidationError[]): void {
    // 如果 context 不是对象，跳过业务规则验证
    if (typeof snap.context !== "object" || snap.context === null) {
      return;
    }

    // Completed/failed/cancelled 状态的快照不应该有后续步骤
    if (["completed", "failed", "cancelled"].includes(snap.state)) {
      if (snap.context.stepIndex > 0 && snap.context.toolCalls?.length === 0) {
        warnings.push({
          code: "WARN_EMPTY_TOOL_CALLS",
          message: "终态快照的 toolCalls 为空，可能存在数据问题",
          path: "$.context",
        });
      }
    }

    // Running 状态应该有正在执行的工具或最近有工具调用
    if (snap.state === "running") {
      if (!snap.context.currentTool && snap.context.toolCalls?.length === 0) {
        warnings.push({
          code: "WARN_MISSING_EXECUTION_INFO",
          message: "running 状态的快照缺少 currentTool 或 toolCalls",
          path: "$.context",
        });
      }
    }

    // ToolCalls 时间顺序
    if (snap.context.toolCalls?.length > 1) {
      for (let i = 1; i < snap.context.toolCalls.length; i++) {
        const prev = snap.context.toolCalls[i - 1];
        const curr = snap.context.toolCalls[i];
        if (!curr || !prev) continue;

        const prevTs = prev.timestamp;
        const currTs = curr.timestamp;
        if (typeof prevTs !== "number" || typeof currTs !== "number") {
          if (typeof prevTs !== "number") {
            warnings.push({
              code: "WARN_MISSING_TIMESTAMP",
              message: `toolCalls[${i - 1}] 缺少 timestamp`,
              path: `$.context.toolCalls[${i - 1}].timestamp`,
            });
          }
          if (typeof currTs !== "number") {
            warnings.push({
              code: "WARN_MISSING_TIMESTAMP",
              message: `toolCalls[${i}] 缺少 timestamp`,
              path: `$.context.toolCalls[${i}].timestamp`,
            });
          }
          continue;
        }

        if (currTs < prevTs) {
          errors.push({
            code: "INVALID_TIMESTAMP_ORDER",
            message: `toolCalls 时间戳顺序错误: [${i - 1}]=${prevTs}, [${i}]=${currTs}`,
            path: `$.context.toolCalls[${i}].timestamp`,
          });
        }
      }
    }

    // Error 和 state 的一致性
    if (snap.error && snap.state !== "failed" && snap.state !== "cancelled") {
      warnings.push({
        code: "WARN_STATE_ERROR_MISMATCH",
        message: `存在 error 但状态为 ${snap.state}，可能不一致`,
        path: "$.state",
      });
    }
  }
}

// ─── 工厂函数 ─────────────────────────────────────────────────────

/**
 * 创建快照验证器
 */
export function createSnapshotValidator(strict = false): SnapshotValidator {
  return new SnapshotValidator(strict);
}

/**
 * 快捷验证函数
 */
export function validateSnapshot(snapshot: unknown): ValidationResult {
  return createSnapshotValidator().validate(snapshot);
}

/**
 * 快速验证函数(仅检查必需字段)
 */
export function validateSnapshotRequired(snapshot: unknown): ValidationResult {
  return createSnapshotValidator().validateRequired(snapshot);
}
