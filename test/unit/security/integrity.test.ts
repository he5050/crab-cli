/**
 * integrity 单元测试 — HMAC-SHA256 审计日志完整性校验
 */
import { describe, it, expect } from "bun:test";
import { canonicalJson, signEntry, verifyEntry, stampEntry, IntegrityError } from "@/security/audit/integrity";

const TEST_SECRET = "test-secret-key-for-integrity";

describe("integrity", () => {
  describe("canonicalJson", () => {
    it("字符串值直接序列化", () => {
      expect(canonicalJson("hello")).toBe('"hello"');
    });

    it("数值直接序列化", () => {
      expect(canonicalJson(42)).toBe("42");
      expect(canonicalJson(3.14)).toBe("3.14");
    });

    it("布尔值直接序列化", () => {
      expect(canonicalJson(true)).toBe("true");
      expect(canonicalJson(false)).toBe("false");
    });

    it("null 直接序列化", () => {
      expect(canonicalJson(null)).toBe("null");
    });

    it("对象按键字典序排序", () => {
      const result = canonicalJson({ z: 1, a: 2, m: 3 });
      expect(result).toBe('{"a":2,"m":3,"z":1}');
    });

    it("嵌套对象按键字典序排序", () => {
      const result = canonicalJson({ outer: { z: 1, a: 2 } });
      expect(result).toBe('{"outer":{"a":2,"z":1}}');
    });

    it("数组按原始顺序排列", () => {
      const result = canonicalJson([3, 1, 2]);
      expect(result).toBe("[3,1,2]");
    });

    it("嵌套对象中包含数组", () => {
      const result = canonicalJson({ arr: [2, 1], key: "val" });
      expect(result).toBe('{"arr":[2,1],"key":"val"}');
    });

    it("空对象序列化", () => {
      expect(canonicalJson({})).toBe("{}");
    });

    it("空数组序列化", () => {
      expect(canonicalJson([])).toBe("[]");
    });

    it("嵌套空对象和空数组", () => {
      const result = canonicalJson({ a: {}, b: [] });
      expect(result).toBe('{"a":{},"b":[]}');
    });
  });

  describe("signEntry", () => {
    it("正常签名返回 hex 字符串", () => {
      const signature = signEntry({ id: "1", action: "test" }, TEST_SECRET);
      expect(signature).toHaveLength(64); // SHA-256 hex = 64 chars
      expect(/^[0-9a-f]{64}$/.test(signature)).toBe(true);
    });

    it("不同 entry 产生不同签名", () => {
      const sig1 = signEntry({ id: "1" }, TEST_SECRET);
      const sig2 = signEntry({ id: "2" }, TEST_SECRET);
      expect(sig1).not.toBe(sig2);
    });

    it("不同密钥产生不同签名", () => {
      const entry = { id: "1" };
      const sig1 = signEntry(entry, "key-a");
      const sig2 = signEntry(entry, "key-b");
      expect(sig1).not.toBe(sig2);
    });

    it("相同输入产生相同签名(确定性)", () => {
      const entry = { id: "1", action: "test" };
      const sig1 = signEntry(entry, TEST_SECRET);
      const sig2 = signEntry(entry, TEST_SECRET);
      expect(sig1).toBe(sig2);
    });

    it("空密钥抛 IntegrityError", () => {
      expect(() => signEntry({ id: "1" }, "")).toThrow(IntegrityError);
    });

    it("Buffer 密钥可正常签名", () => {
      const sig = signEntry({ id: "1" }, Buffer.from("buffer-key"));
      expect(sig).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(sig)).toBe(true);
    });
  });

  describe("verifyEntry", () => {
    it("正常签名验证返回 true", () => {
      const entry = { id: "1", action: "test", integrity: "" };
      const signature = signEntry({ id: "1", action: "test" }, TEST_SECRET);
      entry.integrity = signature;
      expect(verifyEntry(entry, TEST_SECRET)).toBe(true);
    });

    it("无 integrity 字段返回 false", () => {
      expect(verifyEntry({ id: "1" }, TEST_SECRET)).toBe(false);
    });

    it("integrity 为空字符串返回 false", () => {
      expect(verifyEntry({ id: "1", integrity: "" }, TEST_SECRET)).toBe(false);
    });

    it("签名不匹配抛 IntegrityError", () => {
      const entry = { id: "1", integrity: "a".repeat(64) };
      expect(() => verifyEntry(entry, TEST_SECRET)).toThrow(IntegrityError);
    });

    it("篡改 entry 字段后验证失败", () => {
      const entry = { id: "1", action: "original", integrity: "" };
      const signature = signEntry({ id: "1", action: "original" }, TEST_SECRET);
      entry.integrity = signature;
      // 篡改
      entry.action = "tampered";
      expect(() => verifyEntry(entry, TEST_SECRET)).toThrow(IntegrityError);
    });

    it("空密钥抛 IntegrityError", () => {
      const entry = { id: "1", integrity: "abc" };
      expect(() => verifyEntry(entry, "")).toThrow(IntegrityError);
    });

    it("错误信息包含 entry id", () => {
      const entry = { id: "test-id-123", integrity: "bad".repeat(32) };
      try {
        verifyEntry(entry, TEST_SECRET);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(IntegrityError);
        expect((err as IntegrityError).message).toContain("test-id-123");
      }
    });
  });

  describe("stampEntry", () => {
    it("返回新对象不修改原对象", () => {
      const original = { id: "1", action: "test" };
      const stamped = stampEntry(original, TEST_SECRET);
      expect("integrity" in original).toBe(false);
      expect(stamped).not.toBe(original);
    });

    it("包含 integrity 字段", () => {
      const stamped = stampEntry({ id: "1" }, TEST_SECRET);
      expect(stamped.integrity).toBeDefined();
      expect(stamped.integrity).toHaveLength(64);
    });

    it("签名的 entry 可通过验证", () => {
      const stamped = stampEntry({ id: "1", action: "test" }, TEST_SECRET);
      expect(verifyEntry(stamped, TEST_SECRET)).toBe(true);
    });

    it("保留原有字段", () => {
      const stamped = stampEntry({ id: "1", action: "test", extra: true }, TEST_SECRET);
      expect(stamped.id).toBe("1");
      expect(stamped.action).toBe("test");
      expect(stamped.extra).toBe(true);
    });

    it("替换已有的 integrity 字段", () => {
      const entry = { id: "1", integrity: "old-signature" };
      const stamped = stampEntry(entry, TEST_SECRET);
      expect(stamped.integrity).not.toBe("old-signature");
      expect(verifyEntry(stamped, TEST_SECRET)).toBe(true);
    });
  });

  describe("IntegrityError", () => {
    it("name 属性为 IntegrityError", () => {
      const err = new IntegrityError("test message");
      expect(err.name).toBe("IntegrityError");
    });

    it("message 正确传递", () => {
      const err = new IntegrityError("test message");
      expect(err.message).toBe("test message");
    });

    it("是 Error 的实例", () => {
      const err = new IntegrityError("test");
      expect(err).toBeInstanceOf(Error);
    });
  });
});
