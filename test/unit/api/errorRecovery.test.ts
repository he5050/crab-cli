/**
 * 错误恢复测试。
 *
 * 测试用例:
 *   - 可恢复错误识别
 *   - 不可恢复错误识别
 *   - HTTP 错误分类
 *   - 网络错误处理
 */
import { describe, expect, test } from "bun:test";
import { isRecoverableError } from "@/api";

describe("LLM 降级逻辑 — isRecoverableError", () => {
  test("非 Error 对象返回 true", () => {
    expect(isRecoverableError("string error")).toBe(true);
    expect(isRecoverableError(null)).toBe(true);
    expect(isRecoverableError(undefined)).toBe(true);
    expect(isRecoverableError(42)).toBe(true);
  });

  test("HTTP 协议类错误可恢复", () => {
    expect(isRecoverableError(new Error("404 Not Found"))).toBe(true);
    expect(isRecoverableError(new Error("400 Bad Request"))).toBe(true);
    expect(isRecoverableError(new Error("422 Unprocessable Entity"))).toBe(true);
    expect(isRecoverableError(new Error("500 Internal Server Error"))).toBe(true);
  });

  test("网络错误可恢复", () => {
    expect(isRecoverableError(new Error("ECONNREFUSED"))).toBe(true);
    expect(isRecoverableError(new Error("ENOTFOUND"))).toBe(true);
    expect(isRecoverableError(new Error("Fetch failed"))).toBe(true);
    expect(isRecoverableError(new Error("Network error"))).toBe(true);
  });

  test("认证类错误不可恢复", () => {
    expect(isRecoverableError(new Error("401 Unauthorized"))).toBe(false);
    expect(isRecoverableError(new Error("403 Forbidden"))).toBe(false);
    expect(isRecoverableError(new Error("Invalid API key"))).toBe(false);
    expect(isRecoverableError(new Error("Authentication failed"))).toBe(false);
    expect(isRecoverableError(new Error("unauthorized access"))).toBe(false);
    expect(isRecoverableError(new Error("forbidden: insufficient scope"))).toBe(false);
  });

  test("普通业务错误不可恢复", () => {
    expect(isRecoverableError(new Error("Fatal error"))).toBe(false);
    expect(isRecoverableError(new Error("Something went wrong"))).toBe(false);
    expect(isRecoverableError(new Error("Out of memory"))).toBe(false);
  });

  test("大小写不敏感", () => {
    expect(isRecoverableError(new Error("FETCH FAILED"))).toBe(true);
    expect(isRecoverableError(new Error("Not Found"))).toBe(true);
    expect(isRecoverableError(new Error("UNSUPPORTED"))).toBe(true);
  });
});
