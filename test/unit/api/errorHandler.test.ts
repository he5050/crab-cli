/**
 * errorHandler 模块单元测试
 *
 * 测试目标:
 * - 错误分类准确性（classifyError 返回 ErrorClassification 对象）
 * - 可恢复性判断（isRecoverableError 接收 unknown）
 * - 友好错误消息生成（getFriendlyError 返回 FriendlyError）
 * - 错误详情提取（extractErrorDetail 返回 string | null）
 */

import { describe, it, expect } from "bun:test";
import {
  classifyError,
  isRecoverableError,
  getFriendlyError,
  extractErrorDetail,
  toApiAppError,
  type ApiErrorType,
} from "@/api/core/errorHandler";
import { createNetworkError } from "@/core/errors/appError";

describe("classifyError", () => {
  it("应该将网络超时错误分类为 timeout 类型", () => {
    const error = new Error("timeout: stream timed out");
    const result = classifyError(error);
    expect(result.type).toBe("timeout");
    // "timeout" 在 KEYWORD_RULES 中标记为 recoverable=true
    expect(result.recoverable).toBe(true);
    expect(result.friendly.title).toContain("超时");
  });

  it("应该将 ECONNREFUSED 错误分类为 network 类型", () => {
    const error = new Error("fetch failed: ECONNREFUSED");
    const result = classifyError(error);
    expect(result.type).toBe("network");
    expect(result.recoverable).toBe(true);
  });

  it("应该将 401 状态码分类为 auth 类型", () => {
    const error = Object.assign(new Error("Unauthorized"), { status: 401 });
    const result = classifyError(error);
    expect(result.type).toBe("auth");
    expect(result.recoverable).toBe(false);
    expect(result.httpStatus).toBe(401);
  });

  it("应该将 429 状态码分类为 rate_limit 类型", () => {
    const error = Object.assign(new Error("Too Many Requests"), { status: 429 });
    const result = classifyError(error);
    expect(result.type).toBe("rate_limit");
    expect(result.recoverable).toBe(true);
    expect(result.httpStatus).toBe(429);
  });

  it("应该将 5xx 状态码分类为 network 类型", () => {
    const error = Object.assign(new Error("Internal Server Error"), { status: 500 });
    const result = classifyError(error);
    expect(result.type).toBe("network");
    expect(result.recoverable).toBe(true);
    expect(result.httpStatus).toBe(500);
  });

  it("应该将 404 状态码分类为 model 类型", () => {
    const error = Object.assign(new Error("Not found"), { status: 404 });
    const result = classifyError(error);
    expect(result.type).toBe("model");
    expect(result.httpStatus).toBe(404);
  });

  it("应该将未知错误分类为 unknown 类型", () => {
    const error = new Error("Something weird happened");
    const result = classifyError(error);
    expect(result.type).toBe("unknown");
  });

  it("应该返回完整的 ErrorClassification 结构", () => {
    const error = Object.assign(new Error("Unauthorized"), { status: 401 });
    const result = classifyError(error, { providerId: "openai" });
    expect(result.originalError).toBe(error);
    expect(result.appError).toBeDefined();
    expect(result.detail).toBe(null);
  });
});

describe("isRecoverableError", () => {
  it("应该认为网络错误是可恢复的", () => {
    const error = new Error("fetch failed: ECONNREFUSED");
    expect(isRecoverableError(error)).toBe(true);
  });

  it("应该认为 5xx 错误是可恢复的", () => {
    const error = Object.assign(new Error("Server error"), { status: 500 });
    expect(isRecoverableError(error)).toBe(true);
  });

  it("应该认为 429 错误是可恢复的", () => {
    const error = Object.assign(new Error("Rate limited"), { status: 429 });
    expect(isRecoverableError(error)).toBe(true);
  });

  it("应该认为 401 错误是不可恢复的", () => {
    const error = Object.assign(new Error("Unauthorized"), { status: 401 });
    expect(isRecoverableError(error)).toBe(false);
  });

  it("应该认为 403 错误是不可恢复的", () => {
    const error = Object.assign(new Error("Forbidden"), { status: 403 });
    expect(isRecoverableError(error)).toBe(false);
  });

  it("应该对非 Error 对象默认返回 true", () => {
    expect(isRecoverableError("some string")).toBe(true);
    expect(isRecoverableError(null)).toBe(true);
  });
});

describe("getFriendlyError", () => {
  it("应该为网络错误返回友好的中文消息", () => {
    const error = new Error("fetch failed: ECONNREFUSED");
    const friendly = getFriendlyError(error, "zh");
    expect(friendly.type).toBe("network");
    expect(friendly.title).toContain("网络");
    expect(friendly.suggestion).toBeDefined();
  });

  it("应该为 401 错误返回认证失败提示", () => {
    const error = Object.assign(new Error("Invalid API key"), { status: 401 });
    const friendly = getFriendlyError(error, "zh");
    expect(friendly.type).toBe("auth");
    expect(friendly.title).toContain("API Key");
  });

  it("应该为 429 错误返回限流提示", () => {
    const error = Object.assign(new Error("Rate limit exceeded"), { status: 429 });
    const friendly = getFriendlyError(error, "zh");
    expect(friendly.type).toBe("rate_limit");
    expect(friendly.title).toContain("频繁");
  });

  it("应该包含错误消息", () => {
    const error = new Error("Custom error message");
    const friendly = getFriendlyError(error);
    expect(friendly.message).toBeDefined();
  });

  it("应该支持英文 locale", () => {
    const error = Object.assign(new Error("Unauthorized"), { status: 401 });
    const friendly = getFriendlyError(error, "en");
    expect(friendly.title).toContain("API Key");
  });

  it("应该处理非 Error 输入", () => {
    const friendly = getFriendlyError("string error");
    expect(friendly.type).toBe("unknown");
  });
});

describe("extractErrorDetail", () => {
  it("应该从带 cause 的 Error 提取 cause 消息", () => {
    const cause = new Error("root cause");
    const error = new Error("wrapper", { cause });
    const detail = extractErrorDetail(error);
    expect(detail).toBe("root cause");
  });

  it("应该从带 errorBody 的错误提取详情", () => {
    const error = Object.assign(new Error("API error"), {
      errorBody: "detailed error info",
    });
    const detail = extractErrorDetail(error);
    expect(detail).toBe("detailed error info");
  });

  it("应该从带 data 的错误提取详情", () => {
    const error = Object.assign(new Error("API error"), {
      data: { code: "invalid_request" },
    });
    const detail = extractErrorDetail(error);
    expect(detail).toContain("invalid_request");
  });

  it("应该在无额外信息时返回 null", () => {
    const error = new Error("simple error");
    const detail = extractErrorDetail(error);
    expect(detail).toBe(null);
  });
});

describe("toApiAppError", () => {
  it("应该将网络错误转换为 AppError", () => {
    const error = new Error("fetch failed: ECONNREFUSED");
    const appError = toApiAppError(error, { providerId: "openai" });
    expect(appError).toBeDefined();
    expect(appError.code).toBeDefined();
  });

  it("应该将 401 错误转换为 AppError", () => {
    const error = Object.assign(new Error("Unauthorized"), { status: 401 });
    const appError = toApiAppError(error);
    expect(appError).toBeDefined();
  });

  it("应该对 AppError 直接返回", () => {
    const original = createNetworkError("CONNECTION_FAILED", "test");
    const result = toApiAppError(original);
    expect(result).toBe(original);
  });
});
