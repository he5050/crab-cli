/**
 * MessageSerializer 单元测试
 *
 * 测试覆盖:
 *   - 消息序列化/反序列化
 *   - 校验和验证
 *   - 版本迁移
 *   - 消息类型辅助函数
 *   - 错误处理
 */

import { describe, expect, it, vi } from "bun:test";
import {
  type AgentMessage,
  CURRENT_VERSION,
  MIN_VERSION,
  MessageSerializer,
  type MessageType,
  createError,
  createHeartbeat,
  createMessageSerializer,
  createRequest,
  createResponse,
  createVersionedSerializer,
  deserialize,
  generateMessageId,
  getOriginalId,
  isError,
  isHeartbeat,
  isRequest,
  isResponse,
  serialize,
} from "@/agent/session/serializer";

describe("MessageSerializer", () => {
  describe("基本序列化", () => {
    it("should serialize and deserialize message", () => {
      const serializer = createMessageSerializer();
      const msg: AgentMessage = {
        id: "msg-1",
        payload: { key: "value" },
        timestamp: Date.now(),
        type: "request",
      };

      const serialized = serializer.serialize(msg);
      const deserialized = serializer.deserialize(serialized);

      expect(deserialized.id).toBe(msg.id);
      expect(deserialized.type).toBe(msg.type);
      expect(deserialized.payload).toEqual(msg.payload);
    });

    it("should generate checksum on serialization", () => {
      const serializer = createMessageSerializer();
      const msg: AgentMessage = {
        id: "msg-1",
        payload: { test: true },
        timestamp: Date.now(),
        type: "request",
      };

      const serialized = serializer.serialize(msg);
      const parsed = JSON.parse(serialized);
      expect(parsed.checksum).toBeDefined();
      expect(typeof parsed.checksum).toBe("string");
    });

    it("should verify checksum on deserialization", () => {
      const serializer = createMessageSerializer();
      const msg: AgentMessage = {
        id: "msg-1",
        payload: "hello",
        timestamp: Date.now(),
        type: "response",
      };

      const serialized = serializer.serialize(msg);
      // Should not throw
      expect(() => serializer.deserialize(serialized)).not.toThrow();
    });

    it("should throw on corrupted checksum", () => {
      const serializer = createMessageSerializer();
      const msg: AgentMessage = {
        id: "msg-1",
        payload: {},
        timestamp: Date.now(),
        type: "request",
      };

      const serialized = serializer.serialize(msg);
      const corrupted = serialized.replace(/"checksum":"[^"]*"/, '"checksum":"deadbeef"');

      expect(() => serializer.deserialize(corrupted)).toThrow();
    });

    it("should throw on invalid JSON", () => {
      const serializer = createMessageSerializer();
      expect(() => serializer.deserialize("not json")).toThrow();
    });

    it("should throw on invalid message structure", () => {
      const serializer = createMessageSerializer();
      expect(() => serializer.deserialize(JSON.stringify({ foo: "bar" }))).toThrow();
    });
  });

  describe("版本迁移", () => {
    it("should handle same-version serialize/deserialize", () => {
      const serializer = createMessageSerializer(CURRENT_VERSION);
      const msg = createRequest({ data: "test" });
      const serialized = serializer.serialize(msg);
      const deserialized = serializer.deserialize(serialized);
      expect(deserialized.type).toBe("request");
    });

    it("should apply migration when deserializing older version", () => {
      const migrationFn = vi.fn().mockImplementation((payload) => ({
        ...payload,
        migrated: true,
      }));

      const serializer = new MessageSerializer(2);
      serializer.registerMigration(1, migrationFn);

      // Simulate a v1 message
      const v1Msg: AgentMessage = {
        id: "old-msg",
        payload: { original: true },
        timestamp: Date.now(),
        type: "request",
      };

      const v1Serialized = new MessageSerializer(1).serialize(v1Msg);
      const deserialized = serializer.deserialize(v1Serialized);

      expect(migrationFn).toHaveBeenCalled();
      expect(deserialized.payload).toHaveProperty("migrated", true);
    });

    it("should throw on unsupported version", () => {
      const serializer = createMessageSerializer();
      const oldMsg = {
        id: "old",
        payload: {},
        timestamp: Date.now(),
        type: "request",
        version: 0,
      };
      const corrupted = JSON.stringify(oldMsg);
      expect(() => serializer.deserialize(corrupted)).toThrow();
    });

    it("should update version during migration", () => {
      const serializer = new MessageSerializer(2);
      serializer.registerMigration(1, (p) => p);

      const serialized = new MessageSerializer(1).serialize({
        id: "old",
        payload: {},
        timestamp: Date.now(),
        type: "request",
      });
      const deserialized = serializer.deserialize(serialized);
      // After migration, version should be updated to 2
      const reparsed = JSON.parse(serializer.serialize(deserialized));
      expect(reparsed.version).toBe(2);
    });
  });

  describe("validate", () => {
    it("should return valid for well-formed message", () => {
      const serializer = createMessageSerializer();
      const msg = createRequest({ test: true });
      const serialized = serializer.serialize(msg);
      const result = serializer.validate(serialized);
      expect(result.valid).toBe(true);
    });

    it("should return invalid for bad JSON", () => {
      const serializer = createMessageSerializer();
      const result = serializer.validate("not json");
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should return invalid for missing fields", () => {
      const serializer = createMessageSerializer();
      const result = serializer.validate(JSON.stringify({ incomplete: true }));
      expect(result.valid).toBe(false);
    });

    it("should return invalid for unsupported version", () => {
      const serializer = createMessageSerializer();
      const badMsg = JSON.stringify({ id: "x", payload: {}, timestamp: 123, type: "request", version: 0 });
      const result = serializer.validate(badMsg);
      expect(result.valid).toBe(false);
    });
  });

  describe("getVersion", () => {
    it("should return serializer version", () => {
      const serializer = createMessageSerializer(3);
      expect(serializer.getVersion()).toBe(3);
    });
  });
});

describe("便捷函数", () => {
  describe("serialize/deserialize", () => {
    it("should serialize with default serializer", () => {
      const msg = createRequest({ key: "value" });
      const serialized = serialize(msg);
      expect(typeof serialized).toBe("string");

      const parsed = JSON.parse(serialized);
      expect(parsed.type).toBe("request");
    });

    it("should deserialize with default serializer", () => {
      const msg = createRequest({ data: 42 });
      const serialized = serialize(msg);
      const deserialized = deserialize(serialized);
      expect(deserialized.payload).toEqual({ data: 42 });
    });
  });

  describe("createRequest", () => {
    it("should create request message", () => {
      const msg = createRequest({ query: "test" });
      expect(msg.type).toBe("request");
      expect(msg.payload).toEqual({ query: "test" });
      expect(msg.id).toBeDefined();
      expect(msg.timestamp).toBeDefined();
    });

    it("should accept custom options", () => {
      const msg = createRequest(
        { data: "test" },
        { id: "custom-id", metadata: { custom: true }, sourceId: "src", targetId: "tgt" },
      );
      expect(msg.id).toBe("custom-id");
      expect(msg.sourceId).toBe("src");
      expect(msg.targetId).toBe("tgt");
      expect(msg.metadata).toEqual({ custom: true });
    });

    it("should generate id if not provided", () => {
      const msg = createRequest({});
      expect(msg.id).toMatch(/^msg_/);
    });
  });

  describe("createResponse", () => {
    it("should create response message", () => {
      const msg = createResponse("req-1", { result: "ok" });
      expect(msg.type).toBe("response");
      expect(msg.payload).toEqual({ result: "ok" });
      expect(msg.metadata?.originalId).toBe("req-1");
    });

    it("should accept sourceId and targetId", () => {
      const msg = createResponse("req-1", {}, { sourceId: "agent", targetId: "user" });
      expect(msg.sourceId).toBe("agent");
      expect(msg.targetId).toBe("user");
    });
  });

  describe("createError", () => {
    it("should create error message from Error object", () => {
      const err = new Error("test error");
      err.stack = "stack trace";
      const msg = createError("req-1", err);
      expect(msg.type).toBe("error");
      expect(msg.payload.message).toBe("test error");
      expect(msg.payload.stack).toBe("stack trace");
      expect(msg.metadata?.originalId).toBe("req-1");
    });

    it("should create error message from string", () => {
      const msg = createError("req-1", "something went wrong");
      expect(msg.type).toBe("error");
      expect(msg.payload.message).toBe("something went wrong");
      expect(msg.payload.stack).toBeUndefined();
    });
  });

  describe("createHeartbeat", () => {
    it("should create heartbeat message", () => {
      const msg = createHeartbeat("agent-1");
      expect(msg.type).toBe("heartbeat");
      expect(msg.payload.agentId).toBe("agent-1");
      expect(msg.payload.status).toBe("alive");
    });

    it("should accept custom status", () => {
      const msg = createHeartbeat("agent-1", "busy");
      expect(msg.payload.status).toBe("busy");
    });
  });

  describe("类型守卫", () => {
    it("should identify request messages", () => {
      const req = createRequest({});
      expect(isRequest(req)).toBe(true);
      expect(isResponse(req)).toBe(false);
      expect(isError(req)).toBe(false);
      expect(isHeartbeat(req)).toBe(false);
    });

    it("should identify response messages", () => {
      const res = createResponse("id", {});
      expect(isResponse(res)).toBe(true);
      expect(isRequest(res)).toBe(false);
    });

    it("should identify error messages", () => {
      const err = createError("id", "error");
      expect(isError(err)).toBe(true);
      expect(isRequest(err)).toBe(false);
    });

    it("should identify heartbeat messages", () => {
      const hb = createHeartbeat("agent");
      expect(isHeartbeat(hb)).toBe(true);
      expect(isRequest(hb)).toBe(false);
    });
  });

  describe("getOriginalId", () => {
    it("should extract originalId from response", () => {
      const res = createResponse("original-123", {});
      expect(getOriginalId(res)).toBe("original-123");
    });

    it("should return undefined for request", () => {
      const req = createRequest({});
      expect(getOriginalId(req)).toBeUndefined();
    });
  });

  describe("generateMessageId", () => {
    it("should generate unique ids", () => {
      const ids = new Set();
      for (let i = 0; i < 100; i++) {
        ids.add(generateMessageId());
      }
      expect(ids.size).toBe(100);
    });

    it("should generate ids with msg_ prefix", () => {
      const id = generateMessageId();
      expect(id).toMatch(/^msg_/);
    });
  });
});

describe("createVersionedSerializer", () => {
  it("should create serializer with latest version", () => {
    const serializer = createVersionedSerializer([{ version: 1 }, { version: 2 }, { version: 3 }]);
    expect(serializer.getVersion()).toBe(3);
  });

  it("should register migrations from configs", () => {
    const migration = vi.fn().mockImplementation((p) => ({ ...p, v2: true }));
    const serializer = createVersionedSerializer([{ migrations: [migration], version: 1 }, { version: 2 }]);

    const serialized = new MessageSerializer(1).serialize({
      id: "old",
      payload: {},
      timestamp: Date.now(),
      type: "request",
    });
    serializer.deserialize(serialized);

    expect(migration).toHaveBeenCalled();
  });
});

describe("常量", () => {
  it("should have CURRENT_VERSION >= MIN_VERSION", () => {
    expect(CURRENT_VERSION).toBeGreaterThanOrEqual(MIN_VERSION);
  });
});
