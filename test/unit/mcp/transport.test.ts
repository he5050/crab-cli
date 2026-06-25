/**
 * MCP transport 模块单元测试
 */
import { describe, expect, it, mock } from "bun:test";
import { isConnectionError, shouldFallbackToSSE } from "@/mcp/client/transport";

describe("MCP transport", () => {
  describe("isConnectionError", () => {
    it("returns false for non-Error values", () => {
      expect(isConnectionError("string")).toBe(false);
      expect(isConnectionError(null)).toBe(false);
      expect(isConnectionError(undefined)).toBe(false);
      expect(isConnectionError(123)).toBe(false);
      expect(isConnectionError({ message: "error" })).toBe(false);
    });

    it("returns false for non-connection errors", () => {
      expect(isConnectionError(new Error("invalid parameter"))).toBe(false);
      expect(isConnectionError(new Error("permission denied"))).toBe(false);
      expect(isConnectionError(new Error("file not found"))).toBe(false);
    });

    it("detects stream errors", () => {
      expect(isConnectionError(new Error("stream closed"))).toBe(true);
      expect(isConnectionError(new Error("stream destroyed"))).toBe(true);
    });

    it("detects network errors", () => {
      expect(isConnectionError(new Error("ECONNREFUSED"))).toBe(true);
      expect(isConnectionError(new Error("ETIMEDOUT"))).toBe(true);
      expect(isConnectionError(new Error("network error"))).toBe(true);
    });

    it("detects socket errors", () => {
      expect(isConnectionError(new Error("socket hang up"))).toBe(true);
    });

    it("detects fetch failures", () => {
      expect(isConnectionError(new Error("fetch failed"))).toBe(true);
    });

    it("detects abort/timeout", () => {
      expect(isConnectionError(new Error("abort"))).toBe(true);
      expect(isConnectionError(new Error("timeout"))).toBe(true);
      expect(isConnectionError(new Error("cancel"))).toBe(true);
    });

    it("is case insensitive", () => {
      expect(isConnectionError(new Error("ECONNRESET"))).toBe(true);
      expect(isConnectionError(new Error("TIMEOUT"))).toBe(true);
    });
  });

  describe("shouldFallbackToSSE", () => {
    it("detects HTTP 404 from error code", () => {
      expect(shouldFallbackToSSE({ code: 404 })).toBe(true);
    });

    it("detects HTTP 405 from error code", () => {
      expect(shouldFallbackToSSE({ code: 405 })).toBe(true);
    });

    it("detects HTTP 406 from error code", () => {
      expect(shouldFallbackToSSE({ code: 406 })).toBe(true);
    });

    it("detects HTTP 415 from error code", () => {
      expect(shouldFallbackToSSE({ code: 415 })).toBe(true);
    });

    it("detects HTTP 501 from error code", () => {
      expect(shouldFallbackToSSE({ code: 501 })).toBe(true);
    });

    it("does not fallback for other status codes", () => {
      expect(shouldFallbackToSSE({ code: 200 })).toBe(false);
      expect(shouldFallbackToSSE({ code: 400 })).toBe(false);
      expect(shouldFallbackToSSE({ code: 401 })).toBe(false);
      expect(shouldFallbackToSSE({ code: 500 })).toBe(false);
    });

    it("detects fallback messages", () => {
      expect(shouldFallbackToSSE(new Error("Error posting to endpoint (HTTP 404)"))).toBe(true);
      expect(shouldFallbackToSSE(new Error("Error posting to endpoint (HTTP 405)"))).toBe(true);
      expect(shouldFallbackToSSE(new Error("Method Not Allowed"))).toBe(true);
      expect(shouldFallbackToSSE(new Error("Unexpected Content Type"))).toBe(true);
    });

    it("does not fallback for non-matching messages", () => {
      expect(shouldFallbackToSSE(new Error("Connection refused"))).toBe(false);
      expect(shouldFallbackToSSE(new Error("Server error"))).toBe(false);
    });

    it("handles non-object values", () => {
      expect(shouldFallbackToSSE(null)).toBe(false);
      expect(shouldFallbackToSSE(undefined)).toBe(false);
      expect(shouldFallbackToSSE("string")).toBe(false);
    });
  });
});
