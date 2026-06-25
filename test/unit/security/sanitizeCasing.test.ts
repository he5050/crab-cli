/**
 * sanitizeAuditData 大小写混合匹配测试
 */
import { describe, it, expect } from "bun:test";
import { sanitizeAuditData } from "@/security/audit/sanitize";

describe("sanitizeAuditData 大小写混合匹配", () => {
  it("PascalCase (ApiKey) 被脱敏", () => {
    const result = sanitizeAuditData({ ApiKey: "sk-1234567890abcdef" });
    expect(result).toEqual({ ApiKey: "sk-1****cdef" });
  });

  it("SCREAMING_SNAKE_CASE (API_KEY) 被脱敏", () => {
    const result = sanitizeAuditData({ API_KEY: "sk-1234567890abcdef" });
    expect(result).toEqual({ API_KEY: "sk-1****cdef" });
  });

  it("kebab-case (Api-Key) 被脱敏（去除连字符后匹配）", () => {
    const result = sanitizeAuditData({ "Api-Key": "sk-1234567890abcdef" });
    expect(result).toEqual({ "Api-Key": "sk-1****cdef" });
  });

  it("ACCESS_TOKEN 被脱敏", () => {
    const result = sanitizeAuditData({ ACCESS_TOKEN: "at_abcdefghijklmnop" });
    expect(result).toEqual({ ACCESS_TOKEN: "at_a****mnop" });
  });

  it("API_SECRET 被脱敏", () => {
    const result = sanitizeAuditData({ API_SECRET: "secret1234567890" });
    expect(result).toEqual({ API_SECRET: "secr****7890" });
  });

  it("PRIVATE_KEY 被脱敏", () => {
    const result = sanitizeAuditData({ PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----" });
    expect(result).toEqual({ PRIVATE_KEY: "----****----" });
  });

  it("BEARER 字段被脱敏", () => {
    const result = sanitizeAuditData({ Bearer: "Bearer longtoken12345678" });
    expect(result).toEqual({ Bearer: "Bear****5678" });
  });

  it("PASSPHRASE 被脱敏", () => {
    const result = sanitizeAuditData({ PASSPHRASE: "my_super_secret_passphrase" });
    expect(result).toEqual({ PASSPHRASE: "my_s****rase" });
  });

  it("PIN 被脱敏", () => {
    const result = sanitizeAuditData({ PIN: "1234" });
    expect(result).toEqual({ PIN: "****" });
  });

  it("X-Api-Key (带前缀连字符) 被脱敏", () => {
    const result = sanitizeAuditData({ "X-Api-Key": "sak_abcdefghijklmnop" });
    // "xapikey" 在敏感字段列表中
    expect(result).toEqual({ "X-Api-Key": "sak_****mnop" });
  });

  it("SessionToken (camelCase) 被脱敏", () => {
    const result = sanitizeAuditData({ SessionToken: "st_abcdefghijklmnop" });
    expect(result).toEqual({ SessionToken: "st_a****mnop" });
  });

  it("SecretKey (camelCase) 被脱敏", () => {
    const result = sanitizeAuditData({ SecretKey: "secret1234567890" });
    expect(result).toEqual({ SecretKey: "secr****7890" });
  });

  it("混合大小写对象: 多种格式共存", () => {
    const result = sanitizeAuditData({
      apiKey: "sk-1234567890abcdef",
      API_KEY: "ak-abcdefghijklmnop",
      "Api-Key": "ak2-zyxwvutsrqponmlk",
      userName: "alice",
    });
    expect(result).toEqual({
      apiKey: "sk-1****cdef",
      API_KEY: "ak-a****mnop",
      "Api-Key": "ak2-****nmlk",
      userName: "alice",
    });
  });
});
