/**
 * auditSanitize 单元测试 — 审计日志脱敏功能
 */
import { describe, it, expect } from "bun:test";
import { sanitizeAuditData } from "@/security/audit/sanitize";

describe("sanitizeAuditData", () => {
  describe("非敏感字段不被脱敏", () => {
    it("普通字符串字段保持不变", () => {
      const result = sanitizeAuditData({ name: "hello", count: 42 });
      expect(result).toEqual({ name: "hello", count: 42 });
    });

    it("顶层字符串直接返回", () => {
      const result = sanitizeAuditData("plain text");
      expect(result).toBe("plain text");
    });
  });

  describe("apiKey 字段被脱敏（各种长度）", () => {
    it("8字符 apiKey — 保留前2+****+后2", () => {
      const result = sanitizeAuditData({ apiKey: "abcdefgh" });
      expect(result).toEqual({ apiKey: "ab****gh" });
    });

    it("16字符 apiKey — 保留前4+****+后4", () => {
      const result = sanitizeAuditData({ apiKey: "abcdefghijklmnop" });
      expect(result).toEqual({ apiKey: "abcd****mnop" });
    });

    it("32字符 apiKey — 保留前4+****+后4", () => {
      const key = "abcdefghijklmnopqrstuvwxyz123456";
      const result = sanitizeAuditData({ apiKey: key });
      expect(result).toEqual({ apiKey: "abcd****3456" });
    });

    it("64字符 apiKey — 保留前4+****+后4", () => {
      const key = "a".repeat(64);
      const result = sanitizeAuditData({ apiKey: key });
      expect(result).toEqual({ apiKey: "aaaa****aaaa" });
    });
  });

  describe("password 字段被脱敏", () => {
    it("短密码全部替换为 ****", () => {
      const result = sanitizeAuditData({ password: "abc" });
      expect(result).toEqual({ password: "****" });
    });

    it("中等长度密码保留前2+****+后2", () => {
      const result = sanitizeAuditData({ password: "mypass12" });
      expect(result).toEqual({ password: "my****12" });
    });

    it("长密码保留前4+****+后4", () => {
      const result = sanitizeAuditData({ password: "my_super_secret_password_123" });
      expect(result).toEqual({ password: "my_s****_123" });
    });
  });

  describe("token 字段被脱敏", () => {
    it("短 token 全部替换", () => {
      const result = sanitizeAuditData({ token: "xyz" });
      expect(result).toEqual({ token: "****" });
    });

    it("Bearer token 被脱敏", () => {
      const result = sanitizeAuditData({ token: "Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig" });
      expect(result).toEqual({ token: "Bear****.sig" });
    });
  });

  describe("其他敏感字段名被脱敏", () => {
    it("api_key (snake_case) 被脱敏", () => {
      const result = sanitizeAuditData({ api_key: "sk-1234567890abcdef" });
      expect(result).toEqual({ api_key: "sk-1****cdef" });
    });

    it("apiSecret (camelCase) 被脱敏", () => {
      const result = sanitizeAuditData({ apiSecret: "secret1234567890" });
      expect(result).toEqual({ apiSecret: "secr****7890" });
    });

    it("accessToken 被脱敏", () => {
      const result = sanitizeAuditData({ accessToken: "at_abcdef1234567890" });
      expect(result).toEqual({ accessToken: "at_a****7890" });
    });

    it("refresh_token 被脱敏", () => {
      const result = sanitizeAuditData({ refresh_token: "rt_abcdefghijklmnop" });
      expect(result).toEqual({ refresh_token: "rt_a****mnop" });
    });

    it("authorization 被脱敏", () => {
      const result = sanitizeAuditData({ authorization: "Bearer longtoken12345678" });
      expect(result).toEqual({ authorization: "Bear****5678" });
    });

    it("privateKey 被脱敏", () => {
      const result = sanitizeAuditData({ privateKey: "-----BEGIN RSA PRIVATE KEY-----" });
      // 31字符: 前4 "----" + "****" + 后4 "----"
      expect(result).toEqual({ privateKey: "----****----" });
    });

    it("credentials 被脱敏", () => {
      const result = sanitizeAuditData({ credentials: "user:pass1234567890" });
      expect(result).toEqual({ credentials: "user****7890" });
    });

    it("cookie 被脱敏", () => {
      const result = sanitizeAuditData({ cookie: "session=abcdef1234567890" });
      expect(result).toEqual({ cookie: "sess****7890" });
    });

    it("sessionToken 被脱敏", () => {
      const result = sanitizeAuditData({ sessionToken: "st_abcdefghijklmnop" });
      expect(result).toEqual({ sessionToken: "st_a****mnop" });
    });
  });

  describe("嵌套对象中的敏感字段被脱敏", () => {
    it("深层嵌套对象的敏感字段被脱敏", () => {
      const result = sanitizeAuditData({
        level1: {
          level2: {
            password: "secret123",
            name: "safe",
          },
        },
      });
      // "secret123" 是9字符，>=9 用长格式: "secr" + "****" + "t123"
      expect(result).toEqual({
        level1: {
          level2: {
            password: "secr****t123",
            name: "safe",
          },
        },
      });
    });
  });

  describe("数组中的对象被递归脱敏", () => {
    it("数组内对象的敏感字段被脱敏", () => {
      const result = sanitizeAuditData([
        { name: "item1", apiKey: "key1234567890" },
        { name: "item2", token: "tokabcdefghij" },
      ]);
      expect(result).toEqual([
        { name: "item1", apiKey: "key1****7890" },
        { name: "item2", token: "toka****ghij" },
      ]);
    });
  });

  describe("null/undefined/基本类型不被修改", () => {
    it("null 返回 null", () => {
      expect(sanitizeAuditData(null)).toBeNull();
    });

    it("undefined 返回 undefined", () => {
      expect(sanitizeAuditData(undefined)).toBeUndefined();
    });

    it("数字不被修改", () => {
      expect(sanitizeAuditData(42)).toBe(42);
    });

    it("布尔值不被修改", () => {
      expect(sanitizeAuditData(true)).toBe(true);
    });

    it("空对象返回空对象", () => {
      expect(sanitizeAuditData({})).toEqual({});
    });
  });

  describe("深度限制(depth > 5)停止递归", () => {
    it("超过5层递归时停止脱敏，原样返回", () => {
      // 构造嵌套对象: depth=0(root) -> depth=1(d1) -> ... -> depth=6(d6.password)
      // sanitizeAuditData(root, 0):
      //   遍历 root -> 递归 d1(depth=1) -> d2(2) -> d3(3) -> d4(4) -> d5(5) -> d6(6, >5 停止)
      // d6 作为对象在 depth=6 时被原样返回，password 不被脱敏
      const deep: Record<string, unknown> = {
        d1: {
          d2: {
            d3: {
              d4: {
                d5: {
                  d6: {
                    password: "should_not_be_masked",
                  },
                },
              },
            },
          },
        },
      };
      const result = sanitizeAuditData(deep) as Record<string, unknown>;
      // d6 层 (depth=6 > 5) 原样返回，password 不被脱敏
      const d1 = result.d1 as Record<string, unknown>;
      const d2 = d1.d2 as Record<string, unknown>;
      const d3 = d2.d3 as Record<string, unknown>;
      const d4 = d3.d4 as Record<string, unknown>;
      const d5 = d4.d5 as Record<string, unknown>;
      const d6 = d5.d6 as Record<string, unknown>;
      expect(d6.password).toBe("should_not_be_masked");

      // 对比: depth=5 层的 password 仍然会被脱敏
      const deepMasked: Record<string, unknown> = {
        d1: {
          d2: {
            d3: {
              d4: {
                d5: {
                  password: "should_be_masked_1234",
                },
              },
            },
          },
        },
      };
      const resultMasked = sanitizeAuditData(deepMasked) as Record<string, unknown>;
      const m1 = resultMasked.d1 as Record<string, unknown>;
      const m2 = m1.d2 as Record<string, unknown>;
      const m3 = m2.d3 as Record<string, unknown>;
      const m4 = m3.d4 as Record<string, unknown>;
      const m5 = m4.d5 as Record<string, unknown>;
      expect(m5.password).toBe("shou****1234");
    });
  });

  describe("不修改原对象", () => {
    it("返回新对象，原对象保持不变", () => {
      const original = { apiKey: "secret1234567890", name: "test" };
      const result = sanitizeAuditData(original);
      expect(original.apiKey).toBe("secret1234567890");
      expect((result as Record<string, unknown>).apiKey).toBe("secr****7890");
    });
  });
});
