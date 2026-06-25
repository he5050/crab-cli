/**
 * 错误处理器友好提示测试。
 *
 * 测试用例:
 *   - extractErrorDetail 提取 cause / errorBody / data
 *   - getFriendlyError 用户可读错误
 *   - toApiAppError 错误转 AppError
 */
import { describe, expect, test } from "bun:test";
import { AppError } from "@/core/errors/appError";
import { extractErrorDetail, getFriendlyError, toApiAppError } from "@/api";

describe("LLM 错误友好提示", () => {
  test("extractErrorDetail 优先提取 cause message", () => {
    const err = new Error("outer", { cause: new Error("inner cause") });

    expect(extractErrorDetail(err)).toBe("inner cause");
  });

  test("extractErrorDetail 支持 errorBody 和 data 字段", () => {
    const bodyError = Object.assign(new Error("body"), { errorBody: { code: "bad_request" } });
    const dataError = Object.assign(new Error("data"), { data: "raw-data" });

    expect(extractErrorDetail(bodyError)).toBe(JSON.stringify({ code: "bad_request" }));
    expect(extractErrorDetail(dataError)).toBe("raw-data");
    expect(extractErrorDetail(new Error("plain"))).toBeNull();
  });

  test("getFriendlyError 处理非 Error 输入", () => {
    const friendly = getFriendlyError("boom");

    expect(friendly.type).toBe("unknown");
    expect(friendly.message).toBe("boom");
  });

  test("getFriendlyError 覆盖认证和权限错误", () => {
    expect(getFriendlyError(new Error("401 Unauthorized")).title).toBe("API Key 无效");
    expect(getFriendlyError(new Error("403 Forbidden")).title).toBe("访问被拒绝");
    expect(getFriendlyError(new Error("Invalid API key")).type).toBe("auth");
  });

  test("getFriendlyError 覆盖模型、网络、超时、限流和余额边界", () => {
    expect(getFriendlyError(new Error("404 model not found")).type).toBe("model");
    expect(getFriendlyError(new Error("ECONNREFUSED")).type).toBe("network");
    expect(getFriendlyError(new Error("stream timeout")).type).toBe("timeout");
    expect(getFriendlyError(new Error("429 rate limit")).type).toBe("rate_limit");
    expect(getFriendlyError(new Error("insufficient quota billing")).title).toBe("账户余额不足");
  });

  test("getFriendlyError 未分类错误保留原始 message", () => {
    const friendly = getFriendlyError(new Error("provider exploded"));

    expect(friendly.type).toBe("unknown");
    expect(friendly.message).toBe("provider exploded");
  });

  test("toApiAppError 将 API 错误映射为统一 AppError code 和 context", () => {
    const auth = toApiAppError(new Error("401 Unauthorized"), {
      modelId: "gpt-test",
      providerId: "openai",
      requestMethod: "responses",
    });
    const forbidden = toApiAppError(new Error("403 Forbidden"));
    const network = toApiAppError(new Error("ECONNREFUSED"));
    const timeout = toApiAppError(new Error("stream timeout"));
    const model = toApiAppError(new Error("404 model not found"));
    const quota = toApiAppError(new Error("429 rate limit"));

    expect(auth).toBeInstanceOf(AppError);
    expect(auth.code).toBe("SECURITY-700");
    expect(auth.context.providerId).toBe("openai");
    expect(auth.context.apiErrorType).toBe("auth");
    expect(forbidden.code).toBe("SECURITY-701");
    expect(network.code).toBe("NETWORK-100");
    expect(timeout.code).toBe("NETWORK-102");
    expect(model.code).toBe("USER-204");
    expect(quota.code).toBe("USER-207");
  });

  test("toApiAppError 保留既有 AppError 实例", () => {
    const existing = toApiAppError(new Error("plain"));

    expect(toApiAppError(existing)).toBe(existing);
  });
});
