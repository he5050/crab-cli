/**
 * Agent 消息序列化测试。
 *
 * 覆盖:
 *   - generateMessageId: 唯一性 + 格式
 *   - MessageSerializer.serialize/deserialize 往返
 *   - checksum 篡改检测
 *   - 版本迁移 (migrate)
 *   - 校验: JSON 格式错误、字段缺失、版本过低
 *   - createRequest/Response/Error/Heartbeat 工厂
 *   - 类型守卫 isRequest/isResponse/isError/isHeartbeat
 */
import { beforeEach, describe, expect, test } from "bun:test";
import {
  CURRENT_VERSION,
  createError,
  createHeartbeat,
  createMessageSerializer,
  createRequest,
  createResponse,
  deserialize,
  generateMessageId,
  isError,
  isHeartbeat,
  isRequest,
  isResponse,
  MessageSerializer,
  MIN_VERSION,
  serialize,
} from "@/agent/session/serializer";

describe("session/serializer", () => {
  describe("generateMessageId", () => {
    test("生成非空字符串", () => {
      const id = generateMessageId();
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(5);
    });

    test("多次调用生成不同 ID", () => {
      const ids = new Set(Array.from({ length: 50 }, () => generateMessageId()));
      expect(ids.size).toBe(50);
    });
  });

  describe("MessageSerializer.serialize + deserialize 往返", () => {
    test("基本消息往返保持一致", () => {
      const s = new MessageSerializer();
      const original = createRequest(
        { foo: "bar" },
        { id: "fixed-id", sourceId: "agent-1", targetId: "agent-2", metadata: { k: "v" } },
      );
      const serialized = s.serialize(original);
      const restored = s.deserialize(serialized);

      expect(restored.id).toBe("fixed-id");
      expect(restored.type).toBe("request");
      expect(restored.sourceId).toBe("agent-1");
      expect(restored.targetId).toBe("agent-2");
      expect(restored.metadata).toEqual({ k: "v" });
      expect(restored.payload).toEqual({ foo: "bar" });
    });
    test("生成的序列化字符串带 checksum", () => {
      const s = new MessageSerializer();
      const msg = createRequest({ x: 1 });
      const text = s.serialize(msg);
      const parsed = JSON.parse(text) as { checksum?: string };
      expect(typeof parsed.checksum).toBe("string");
      // SHA-256 前 16 hex 字符(64-bit collision space)
      expect(parsed.checksum!.length).toBe(16);
    });

    test("无 metadata 字段的 deserialize 不报错", () => {
      const s = new MessageSerializer();
      const msg = createRequest({ ok: true });
      const text = s.serialize(msg);
      const restored = s.deserialize(text);
      expect(restored.metadata).toBeUndefined();
    });
  });

  describe("checksum 校验", () => {
    test("篡改 payload 后 checksum 校验失败", () => {
      const s = new MessageSerializer();
      const msg = createRequest({ foo: "bar" });
      const text = s.serialize(msg);

      // 模拟传输中 payload 被修改
      const parsed = JSON.parse(text) as Record<string, unknown>;
      parsed.payload = { foo: "BAZ" };
      const tampered = JSON.stringify(parsed);

      expect(() => s.deserialize(tampered)).toThrow(/校验和|checksum/i);
    });

    test("未篡改时 checksum 通过", () => {
      const s = new MessageSerializer();
      const msg = createRequest({ foo: "bar" });
      const text = s.serialize(msg);
      expect(() => s.deserialize(text)).not.toThrow();
    });
  });

  describe("版本迁移", () => {
    test("registerMigration 触发迁移", () => {
      const s = new MessageSerializer(2);
      s.registerMigration(1, (data: unknown) => ({ ...(data as object), migrated: true }));

      // 手动构造 v1 消息
      const v1 = {
        id: "m1",
        payload: { v: 1 },
        timestamp: Date.now(),
        type: "request",
        version: 1,
      };
      const text = JSON.stringify(v1);
      const restored = s.deserialize(text);
      expect((restored.payload as { migrated: boolean }).migrated).toBe(true);
    });

    test("无注册迁移时旧版本可读但不升级字段", () => {
      const s = new MessageSerializer(3);
      const v1 = {
        id: "m1",
        payload: { x: 1 },
        timestamp: Date.now(),
        type: "request",
        version: 1,
      };
      const restored = s.deserialize(JSON.stringify(v1));
      expect(restored.payload).toEqual({ x: 1 });
    });

    test("低于 MIN_VERSION 拒绝", () => {
      const s = new MessageSerializer();
      const tooOld = {
        id: "m1",
        payload: {},
        timestamp: Date.now(),
        type: "request",
        version: 0,
      };
      expect(() => s.deserialize(JSON.stringify(tooOld))).toThrow(/过低|too low|version|版本/i);
    });
  });

  describe("validate", () => {
    let s: MessageSerializer;
    beforeEach(() => {
      s = new MessageSerializer();
    });

    test("无效 JSON 返回 valid=false", () => {
      const r = s.validate("{ not json");
      expect(r.valid).toBe(false);
      expect(r.error).toBeDefined();
    });

    test("非对象返回 valid=false", () => {
      const r = s.validate("42");
      expect(r.valid).toBe(false);
    });

    test("缺 version 字段返回 valid=false", () => {
      const r = s.validate(JSON.stringify({ type: "request", id: "x", timestamp: 0 }));
      expect(r.valid).toBe(false);
    });

    test("缺 type 字段返回 valid=false", () => {
      const r = s.validate(JSON.stringify({ version: 1, id: "x", timestamp: 0 }));
      expect(r.valid).toBe(false);
    });

    test("合法消息返回 valid=true", () => {
      const msg = createRequest({ ok: true });
      const r = s.validate(serialize(msg));
      expect(r.valid).toBe(true);
    });
  });

  describe("工厂函数", () => {
    test("createRequest 设置 type=request 与 timestamp", () => {
      const before = Date.now();
      const msg = createRequest({ x: 1 });
      const after = Date.now();
      expect(msg.type).toBe("request");
      expect(msg.timestamp).toBeGreaterThanOrEqual(before);
      expect(msg.timestamp).toBeLessThanOrEqual(after);
    });

    test("createResponse 关联 originalId", () => {
      const msg = createResponse("orig-1", { ok: true });
      expect(msg.type).toBe("response");
      expect(msg.metadata?.originalId).toBe("orig-1");
    });

    test("createError 支持字符串和 Error 对象", () => {
      const fromStr = createError("orig", "boom");
      const fromErr = createError("orig", new Error("kaboom"));
      expect(fromStr.payload.message).toBe("boom");
      expect(fromErr.payload.message).toBe("kaboom");
      expect(fromErr.payload.stack).toBeDefined();
    });

    test("createHeartbeat 默认 status=alive", () => {
      const msg = createHeartbeat("agent-x");
      expect(msg.type).toBe("heartbeat");
      expect(msg.payload.status).toBe("alive");
    });

    test("createHeartbeat 可指定 status", () => {
      const msg = createHeartbeat("agent-x", "busy");
      expect(msg.payload.status).toBe("busy");
    });
  });

  describe("类型守卫", () => {
    test("isRequest/isResponse/isError/isHeartbeat 互斥", () => {
      const req = createRequest({});
      const res = createResponse("id", {});
      const err = createError("id", "x");
      const hb = createHeartbeat("a");

      expect(isRequest(req)).toBe(true);
      expect(isRequest(res)).toBe(false);
      expect(isResponse(res)).toBe(true);
      expect(isError(err)).toBe(true);
      expect(isHeartbeat(hb)).toBe(true);
    });
  });

  describe("module-level 便捷函数", () => {
    test("serialize/deserialize 包装器", () => {
      const msg = createRequest({ x: 1 });
      const text = serialize(msg);
      const restored = deserialize(text);
      expect(restored.payload).toEqual({ x: 1 });
    });

    test("createMessageSerializer 接受版本号", () => {
      const s = createMessageSerializer(5);
      expect(s.getVersion()).toBe(5);
    });

    test("CURRENT_VERSION 和 MIN_VERSION 导出", () => {
      expect(CURRENT_VERSION).toBeGreaterThanOrEqual(1);
      expect(MIN_VERSION).toBe(1);
    });
  });
});
