import { describe, expect, it } from "bun:test";
import { sanitizeString, sanitizeObject, sanitizeHeaders } from "@/core/logging/debugLogger";

describe("sanitizeString", () => {
  it("redacts API keys", () => {
    const result = sanitizeString("key: sk-abcdefghij1234567890abcd");
    expect(result).toContain("[REDACTED_API_KEY]");
    expect(result).not.toContain("sk-abcdefghij1234567890abcd");
  });

  it("redacts Bearer tokens", () => {
    const result = sanitizeString("Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    expect(result).toContain("[REDACTED_BEARER]");
    expect(result).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
  });

  it("redacts password fields", () => {
    const result = sanitizeString('{"password": "secret123"}');
    expect(result).toContain("[REDACTED_PASSWORD]");
    expect(result).not.toContain("secret123");
  });

  it("truncates long strings", () => {
    const long = "a".repeat(3000);
    const result = sanitizeString(long, { maxLength: 100 });
    expect(result.length).toBeLessThan(200);
    expect(result).toContain("TRUNCATED");
  });

  it("does not redact when disabled", () => {
    const result = sanitizeString('{"password": "secret"}', { redactSensitive: false });
    expect(result).toContain("secret");
  });
});

describe("sanitizeObject", () => {
  it("sanitizes nested objects", () => {
    const obj = {
      apiKey: "sk-abcdefghij1234567890abcd",
      nested: { password: "secret" },
    };
    const result = sanitizeObject(obj);
    expect(JSON.stringify(result)).not.toContain("sk-abcdefghij1234567890abcd");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("handles truncation gracefully", () => {
    const obj = { text: "a".repeat(5000) };
    const result = sanitizeObject(obj, { maxLength: 100 });
    expect(result).toHaveProperty("_sanitized");
  });
});

describe("sanitizeHeaders", () => {
  it("redacts sensitive headers", () => {
    const headers = {
      "content-type": "application/json",
      authorization: "Bearer token123",
      "x-api-key": "secret-key",
    };
    const result = sanitizeHeaders(headers);
    expect(result["content-type"]).toBe("application/json");
    expect(result.authorization).toBe("[REDACTED]");
    expect(result["x-api-key"]).toBe("[REDACTED]");
  });

  it("truncates long header values", () => {
    const headers = { "long-header": "a".repeat(1000) };
    const result = sanitizeHeaders(headers);
    expect(result["long-header"]!.length).toBeLessThan(600);
    expect(result["long-header"]).toContain("omitted");
  });
});
