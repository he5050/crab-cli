/**
 * MCP errors 模块单元测试
 */

import { describe, expect, it } from "bun:test";
import { createToolError, createUserError } from "@/core/errors/appError";
import { createMcpError, getMcpErrorMessage, toMcpLogPayload, type McpErrorContext } from "@/mcp/core/errors";

describe("MCP errors", () => {
  describe("getMcpErrorMessage", () => {
    it("extracts message from Error instance", () => {
      expect(getMcpErrorMessage(new Error("timeout"))).toBe("timeout");
    });

    it("converts non-Error to string", () => {
      expect(getMcpErrorMessage("str")).toBe("str");
      expect(getMcpErrorMessage(123)).toBe("123");
      expect(getMcpErrorMessage(null)).toBe("null");
    });
  });

  describe("createMcpError", () => {
    const ctx: McpErrorContext = { operation: "callTool", serverName: "test" };

    it("passes through existing AppError", () => {
      const existing = createUserError("RESOURCE_NOT_FOUND", "wrapped");
      expect(createMcpError(existing, ctx)).toBe(existing);
    });

    it("maps not_found to USER-204", () => {
      const result = createMcpError(new Error("not found"), ctx, "not_found");
      expect(result.code).toBe("USER-204");
      expect((result.context as McpErrorContext).mcpErrorReason).toBe("not_found");
    });

    it("maps unsupported to TOOL-604", () => {
      const result = createMcpError(new Error("unsupported"), ctx, "unsupported");
      expect(result.code).toBe("TOOL-604");
    });

    it("maps network to NETWORK-100", () => {
      const result = createMcpError(new Error("ECONNREFUSED"), ctx, "network");
      expect(result.code).toBe("NETWORK-100");
    });

    it("maps runtime (default) to TOOL-601", () => {
      const result = createMcpError(new Error("runtime"), ctx);
      expect(result.code).toBe("TOOL-601");
    });

    it("preserves cause from Error instances", () => {
      const original = new Error("root");
      const result = createMcpError(original, ctx, "runtime");
      expect(result.cause).toBe(original);
    });

    it("cause is undefined for non-Error values", () => {
      const result = createMcpError("string", ctx, "runtime");
      expect(result.cause).toBeUndefined();
    });

    it("merges context with mcpErrorReason", () => {
      const result = createMcpError(new Error("t"), { operation: "op", transportType: "stdio" }, "network");
      const c = result.context as McpErrorContext;
      expect(c.operation).toBe("op");
      expect(c.transportType).toBe("stdio");
      expect(c.mcpErrorReason).toBe("network");
    });
  });

  describe("toMcpLogPayload", () => {
    it("extracts message and code", () => {
      const err = createToolError("TOOL_EXEC_ERROR", "failed");
      expect(toMcpLogPayload(err)).toEqual({ error: "failed", errorCode: "TOOL-601" });
    });

    it("works with any AppError subtype", () => {
      const err = createUserError("RESOURCE_NOT_FOUND", "not found");
      const payload = toMcpLogPayload(err);
      expect(payload.errorCode).toBe("USER-204");
    });
  });
});
