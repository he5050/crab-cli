/**
 * Snapshot Validator 单元测试
 *
 * 测试覆盖:
 *   - 快照验证器基本功能
 *   - 结构验证
 *   - 类型验证
 *   - 值域验证
 *   - 业务规则验证
 */

import { beforeEach, describe, expect, it } from "bun:test";
import {
  SnapshotValidator,
  type ValidationResult,
  createSnapshotValidator,
  validateSnapshot,
  validateSnapshotRequired,
} from "@/agent/snapshot/validator";
import { CURRENT_SCHEMA_VERSION } from "@/agent/snapshot/schema";

describe("SnapshotValidator", () => {
  let validator: SnapshotValidator;

  beforeEach(() => {
    validator = createSnapshotValidator();
  });

  // 辅助函数:创建有效快照
  const createValidSnapshot = (): Record<string, unknown> => ({
    agentId: "agent-123",
    agentName: "TestAgent",
    context: {
      maxSteps: 10,
      stepIndex: 1,
      toolCalls: [],
    },
    metadata: {
      createdAt: Date.now(),
    },
    state: "running",
    timestamp: Date.now(),
    version: CURRENT_SCHEMA_VERSION,
  });

  describe("基本功能", () => {
    it("should create validator with default config", () => {
      expect(validator).toBeInstanceOf(SnapshotValidator);
    });

    it("should create validator in strict mode", () => {
      const strictValidator = createSnapshotValidator(true);
      expect(strictValidator).toBeInstanceOf(SnapshotValidator);
    });

    it("should validate valid snapshot", () => {
      const snapshot = createValidSnapshot();
      const result = validator.validate(snapshot);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should use validateSnapshot shortcut", () => {
      const snapshot = createValidSnapshot();
      const result = validateSnapshot(snapshot);

      expect(result.valid).toBe(true);
    });

    it("should use validateSnapshotRequired shortcut", () => {
      const snapshot = createValidSnapshot();
      const result = validateSnapshotRequired(snapshot);

      expect(result.valid).toBe(true);
    });
  });

  describe("结构验证", () => {
    it("should fail for non-object snapshot", () => {
      const result = validator.validate("not an object");

      expect(result.valid).toBe(false);
      expect(result.errors[0]!.code).toBe("INVALID_TYPE");
    });

    it("should fail for null snapshot", () => {
      const result = validator.validate(null);

      expect(result.valid).toBe(false);
      expect(result.errors[0]!.code).toBe("INVALID_TYPE");
    });

    it("should fail for missing required fields", () => {
      const snapshot = { agentId: "test" };
      const result = validator.validate(snapshot);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "MISSING_FIELD")).toBe(true);
    });

    it("should validate required fields only with validateRequired", () => {
      const snapshot = createValidSnapshot();
      const result = validator.validateRequired(snapshot);

      expect(result.valid).toBe(true);
    });

    it("should fail validateRequired for missing fields", () => {
      const snapshot = { agentId: "test" };
      const result = validator.validateRequired(snapshot);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe("类型验证", () => {
    it("should fail for invalid version type", () => {
      const snapshot = createValidSnapshot();
      snapshot.version = "1.0";

      const result = validator.validate(snapshot);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === "$.version")).toBe(true);
    });

    it("should fail for invalid agentId type", () => {
      const snapshot = createValidSnapshot();
      snapshot.agentId = 123;

      const result = validator.validate(snapshot);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === "$.agentId")).toBe(true);
    });

    it("should fail for invalid timestamp type", () => {
      const snapshot = createValidSnapshot();
      snapshot.timestamp = "2024-01-01";

      const result = validator.validate(snapshot);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === "$.timestamp")).toBe(true);
    });

    it("should fail for invalid state type", () => {
      const snapshot = createValidSnapshot();
      snapshot.state = 123;

      const result = validator.validate(snapshot);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === "$.state")).toBe(true);
    });

    it("should fail for invalid context type", () => {
      const snapshot = createValidSnapshot();
      snapshot.context = "invalid";

      const result = validator.validate(snapshot);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === "$.context")).toBe(true);
    });

    it("should fail for invalid stepIndex type", () => {
      const snapshot = createValidSnapshot();
      (snapshot.context as Record<string, unknown>).stepIndex = "1";

      const result = validator.validate(snapshot);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === "$.context.stepIndex")).toBe(true);
    });

    it("should fail for invalid toolCalls type", () => {
      const snapshot = createValidSnapshot();
      (snapshot.context as Record<string, unknown>).toolCalls = "not an array";

      const result = validator.validate(snapshot);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === "$.context.toolCalls")).toBe(true);
    });

    it("should warn for non-object data", () => {
      const snapshot = createValidSnapshot();
      snapshot.data = "string data";

      const result = validator.validate(snapshot);

      expect(result.warnings.some((w) => w.path === "$.data")).toBe(true);
    });
  });

  describe("值域验证", () => {
    it("should fail for unsupported version", () => {
      const snapshot = createValidSnapshot();
      snapshot.version = 999;

      const result = validator.validate(snapshot);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "UNSUPPORTED_VERSION")).toBe(true);
    });

    it("should warn for future timestamp", () => {
      const snapshot = createValidSnapshot();
      snapshot.timestamp = Date.now() + 120_000; // 2 minutes in future

      const result = validator.validate(snapshot);

      expect(result.warnings.some((w) => w.code === "WARN_FUTURE_TIMESTAMP")).toBe(true);
    });

    it("should warn for old snapshot", () => {
      const snapshot = createValidSnapshot();
      snapshot.timestamp = Date.now() - 31 * 24 * 60 * 60 * 1000; // 31 days ago

      const result = validator.validate(snapshot);

      expect(result.warnings.some((w) => w.code === "WARN_OLD_SNAPSHOT")).toBe(true);
    });

    it("should fail for invalid state value", () => {
      const snapshot = createValidSnapshot();
      snapshot.state = "invalid_state";

      const result = validator.validate(snapshot);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "INVALID_STATE")).toBe(true);
    });

    it("should accept all valid states", () => {
      const validStates = ["idle", "initializing", "running", "waiting", "completed", "failed", "cancelled"];

      for (const state of validStates) {
        const snapshot = createValidSnapshot();
        snapshot.state = state;

        const result = validator.validate(snapshot);
        expect(result.errors.some((e) => e.code === "INVALID_STATE")).toBe(false);
      }
    });

    it("should fail for negative stepIndex", () => {
      const snapshot = createValidSnapshot();
      (snapshot.context as Record<string, unknown>).stepIndex = -1;

      const result = validator.validate(snapshot);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "INVALID_STEP_INDEX")).toBe(true);
    });

    it("should fail when stepIndex exceeds maxSteps", () => {
      const snapshot = createValidSnapshot();
      (snapshot.context as Record<string, unknown>).stepIndex = 15;
      (snapshot.context as Record<string, unknown>).maxSteps = 10;

      const result = validator.validate(snapshot);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "STEP_INDEX_EXCEEDS_MAX")).toBe(true);
    });
  });

  describe("业务规则验证", () => {
    it("should warn for completed state with empty toolCalls", () => {
      const snapshot = createValidSnapshot();
      snapshot.state = "completed";
      (snapshot.context as Record<string, unknown>).stepIndex = 5;
      (snapshot.context as Record<string, unknown>).toolCalls = [];

      const result = validator.validate(snapshot);

      expect(result.warnings.some((w) => w.code === "WARN_EMPTY_TOOL_CALLS")).toBe(true);
    });

    it("should warn for running state without execution info", () => {
      const snapshot = createValidSnapshot();
      snapshot.state = "running";
      (snapshot.context as Record<string, unknown>).currentTool = null;
      (snapshot.context as Record<string, unknown>).toolCalls = [];

      const result = validator.validate(snapshot);

      expect(result.warnings.some((w) => w.code === "WARN_MISSING_EXECUTION_INFO")).toBe(true);
    });

    it("should fail for invalid toolCalls timestamp order", () => {
      const snapshot = createValidSnapshot();
      const now = Date.now();
      (snapshot.context as Record<string, unknown>).toolCalls = [{ timestamp: now + 1000 }, { timestamp: now }];

      const result = validator.validate(snapshot);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "INVALID_TIMESTAMP_ORDER")).toBe(true);
    });

    it("should warn for error with non-failed state", () => {
      const snapshot = createValidSnapshot();
      snapshot.state = "running";
      snapshot.error = { message: "Something went wrong" };

      const result = validator.validate(snapshot);

      expect(result.warnings.some((w) => w.code === "WARN_STATE_ERROR_MISMATCH")).toBe(true);
    });

    it("should not warn for error with failed state", () => {
      const snapshot = createValidSnapshot();
      snapshot.state = "failed";
      snapshot.error = { message: "Something went wrong" };

      const result = validator.validate(snapshot);

      expect(result.warnings.some((w) => w.code === "WARN_STATE_ERROR_MISMATCH")).toBe(false);
    });

    it("should not warn for error with cancelled state", () => {
      const snapshot = createValidSnapshot();
      snapshot.state = "cancelled";
      snapshot.error = { message: "Task cancelled" };

      const result = validator.validate(snapshot);

      expect(result.warnings.some((w) => w.code === "WARN_STATE_ERROR_MISMATCH")).toBe(false);
    });
  });

  describe("严格模式", () => {
    it("should collect all errors in strict mode", () => {
      const strictValidator = createSnapshotValidator(true);
      const snapshot = {
        agentId: 123,
        timestamp: "invalid",
        version: "invalid",
      };

      const result = strictValidator.validate(snapshot);

      expect(result.errors.length).toBeGreaterThan(1);
    });
  });

  describe("上下文验证", () => {
    it("should fail for missing context fields", () => {
      const snapshot = createValidSnapshot();
      snapshot.context = {};

      const result = validator.validate(snapshot);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "MISSING_CONTEXT_FIELD")).toBe(true);
    });
  });

  describe("元数据验证", () => {
    it("should fail for missing metadata.createdAt", () => {
      const snapshot = createValidSnapshot();
      snapshot.metadata = {};

      const result = validator.validate(snapshot);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "MISSING_METADATA_FIELD")).toBe(true);
    });

    it("should warn for future metadata.createdAt", () => {
      const snapshot = createValidSnapshot();
      (snapshot.metadata as Record<string, unknown>).createdAt = Date.now() + 120_000;

      const result = validator.validate(snapshot);

      expect(result.warnings.some((w) => w.code === "WARN_FUTURE_TIMESTAMP")).toBe(true);
    });
  });

  describe("错误验证", () => {
    it("should fail for error without message", () => {
      const snapshot = createValidSnapshot();
      snapshot.error = { code: "ERR_001" };

      const result = validator.validate(snapshot);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "MISSING_ERROR_MESSAGE")).toBe(true);
    });

    it("should pass for valid error", () => {
      const snapshot = createValidSnapshot();
      snapshot.state = "failed";
      snapshot.error = { code: "ERR_001", message: "Error occurred" };

      const result = validator.validate(snapshot);

      expect(result.errors.some((e) => e.code === "MISSING_ERROR_MESSAGE")).toBe(false);
    });
  });
});
