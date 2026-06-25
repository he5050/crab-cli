/**
 * IDE WebSocket 消息适配器测试
 */
import { describe, it, expect } from "bun:test";
import {
  editorContextFromParams,
  diagnosticsFromParams,
  validateSimpleMessageBounds,
} from "@/ide/connection/wsMessageAdapters";

describe("wsMessageAdapters", () => {
  describe("editorContextFromParams", () => {
    it("完整参数正确映射", () => {
      const params = {
        activeFile: "/tmp/test.ts",
        selectedText: "hello",
        cursorPosition: { line: 1, character: 0 },
        workspaceFolder: "/tmp",
      };
      const ctx = editorContextFromParams(params);
      expect(ctx.activeFile).toBe("/tmp/test.ts");
      expect(ctx.selectedText).toBe("hello");
      expect(ctx.cursorPosition).toEqual({ line: 1, character: 0 });
      expect(ctx.workspaceFolder).toBe("/tmp");
    });

    it("部分缺失参数降级为 undefined", () => {
      const ctx = editorContextFromParams({ activeFile: "/a.ts" });
      expect(ctx.activeFile).toBe("/a.ts");
      expect(ctx.selectedText).toBeUndefined();
      expect(ctx.cursorPosition).toBeUndefined();
      expect(ctx.workspaceFolder).toBeUndefined();
    });

    it("空参数返回全 undefined", () => {
      const ctx = editorContextFromParams({});
      expect(ctx.activeFile).toBeUndefined();
      expect(ctx.selectedText).toBeUndefined();
      expect(ctx.cursorPosition).toBeUndefined();
      expect(ctx.workspaceFolder).toBeUndefined();
    });
  });

  describe("diagnosticsFromParams", () => {
    it("正常数组正确映射", () => {
      const diagnostics = [
        { message: "err", severity: "error", line: 10, character: 5, source: "ts" },
        { message: "warn", severity: "warning", line: 0, character: 0 },
      ];
      const result = diagnosticsFromParams(diagnostics);
      expect(result).toHaveLength(2);
      expect(result![0]).toEqual({
        character: 5,
        line: 10,
        message: "err",
        severity: "error",
        source: "ts",
      });
      expect(result![1]).toEqual({
        character: 0,
        line: 0,
        message: "warn",
        severity: "warning",
        source: undefined,
      });
    });

    it("undefined 返回 undefined", () => {
      expect(diagnosticsFromParams(undefined)).toBeUndefined();
    });

    it("字段缺失时使用默认值", () => {
      const diagnostics = [{ message: "" }];
      const result = diagnosticsFromParams(diagnostics);
      expect(result![0]).toEqual({
        character: 0,
        line: 0,
        message: "",
        severity: "info",
        source: undefined,
      });
    });

    it("空数组返回空数组", () => {
      const result = diagnosticsFromParams([]);
      expect(result).toEqual([]);
    });
  });

  describe("validateSimpleMessageBounds", () => {
    it("正常 context 消息返回 null", () => {
      const data = {
        type: "context",
        activeFile: "/tmp/file.ts",
        selectedText: "short",
        workspaceFolder: "/tmp",
      };
      expect(validateSimpleMessageBounds(data)).toBeNull();
    });

    it("正常 diagnostics 消息返回 null", () => {
      const data = { type: "diagnostics", filePath: "/tmp/file.ts" };
      expect(validateSimpleMessageBounds(data)).toBeNull();
    });

    it("activeFile 超长返回错误", () => {
      const data = { type: "context", activeFile: "a".repeat(1025) };
      expect(validateSimpleMessageBounds(data)).toBe("activeFile 超长，已截断");
    });

    it("activeFile 刚好 1024 字符返回 null", () => {
      const data = { type: "context", activeFile: "a".repeat(1024) };
      expect(validateSimpleMessageBounds(data)).toBeNull();
    });

    it("selectedText 超长返回错误", () => {
      const data = { type: "context", selectedText: "x".repeat(100 * 1024 + 1) };
      expect(validateSimpleMessageBounds(data)).toBe("selectedText 超长，已截断");
    });

    it("filePath 超长返回错误（diagnostics 消息）", () => {
      const data = { type: "diagnostics", filePath: "f".repeat(1025) };
      expect(validateSimpleMessageBounds(data)).toBe("filePath 超长，已截断");
    });

    it("未知 type 返回 null", () => {
      const data = { type: "unknown" };
      expect(validateSimpleMessageBounds(data)).toBeNull();
    });
  });
});
