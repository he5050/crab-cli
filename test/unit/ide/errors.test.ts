/**
 * IDE 错误处理模块测试
 */
import { describe, it, expect } from "bun:test";
import { AppError } from "@/core/errors/appError";
import { createIdeError, getIdeErrorMessage, toIdeLogPayload } from "@/ide/errors";

describe("IDE 错误处理", () => {
  describe("getIdeErrorMessage", () => {
    it("Error 实例返回 message", () => {
      const err = new Error("test error");
      expect(getIdeErrorMessage(err)).toBe("test error");
    });

    it("字符串返回 String() 转换结果", () => {
      expect(getIdeErrorMessage("some string")).toBe("some string");
    });

    it("数字等其他类型返回 String()", () => {
      expect(getIdeErrorMessage(42)).toBe("42");
      expect(getIdeErrorMessage(null)).toBe("null");
      expect(getIdeErrorMessage(undefined)).toBe("undefined");
      expect(getIdeErrorMessage({ key: "val" })).toBe("[object Object]");
    });
  });

  describe("createIdeError", () => {
    it("传入 AppError 直接返回（不重包装）", () => {
      const original = new AppError("INTERNAL-904", "original error");
      const result = createIdeError(original, { operation: "test" }, "handler");
      expect(result).toBe(original);
    });

    it("reason=client_missing 映射到 RESOURCE_NOT_FOUND", () => {
      const err = new Error("not found");
      const result = createIdeError(err, { operation: "sendToIDE", clientId: "c1" }, "client_missing");
      expect(result).toBeInstanceOf(AppError);
      expect(result.code).toBe("USER-204");
      expect(result.message).toBe("not found");
      expect(result.context).toMatchObject({
        operation: "sendToIDE",
        clientId: "c1",
        ideErrorReason: "client_missing",
      });
    });

    it("reason=unsupported_request 映射到 INVALID_PARAMETER", () => {
      const err = new Error("unsupported");
      const result = createIdeError(err, { operation: "handle", requestType: "bad" }, "unsupported_request");
      expect(result.code).toBe("USER-202");
      expect(result.context.ideErrorReason).toBe("unsupported_request");
    });

    it("reason=handler（默认）映射到 INTERNAL_ERROR", () => {
      const err = new Error("handler fail");
      const result = createIdeError(err, { operation: "op" }, "handler");
      expect(result.code).toBe("INTERNAL-900");
    });

    it("reason=callback 映射到 INTERNAL_ERROR", () => {
      const err = new Error("cb fail");
      const result = createIdeError(err, { operation: "cb" }, "callback");
      expect(result.code).toBe("INTERNAL-900");
    });

    it("未指定 reason 默认为 handler", () => {
      const err = new Error("default");
      const result = createIdeError(err, { operation: "op" });
      expect(result.code).toBe("INTERNAL-900");
      expect(result.context.ideErrorReason).toBe("handler");
    });

    it("cause 为 Error 实例时保留原始 error", () => {
      const err = new Error("root cause");
      const result = createIdeError(err, { operation: "op" }, "handler");
      expect(result.cause).toBe(err);
    });

    it("cause 为非 Error 时不设置 cause", () => {
      const result = createIdeError("string error", { operation: "op" }, "handler");
      expect(result.cause).toBeUndefined();
    });
  });

  describe("toIdeLogPayload", () => {
    it("返回 { error, errorCode }", () => {
      const err = createIdeError(new Error("test"), { operation: "op" }, "handler");
      const payload = toIdeLogPayload(err);
      expect(payload).toEqual({ error: "test", errorCode: "INTERNAL-900" });
    });
  });
});
